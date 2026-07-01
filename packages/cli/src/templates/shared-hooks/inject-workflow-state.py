#!/usr/bin/env python3
"""Suncode per-turn breadcrumb hook (UserPromptSubmit / BeforeAgent equivalent).

Runs on every user prompt. Resolves the active task through Suncode'
session-aware active task resolver and emits a short <workflow-state>
block reminding the main AI what task is active and its expected flow.

The emitted ``hookEventName`` field is platform-aware: most hosts expect
``UserPromptSubmit`` (Claude Code naming, also accepted by Cursor / Qoder /
CodeBuddy / Droid / Codex / Copilot wiring), but Gemini CLI 0.40.x renamed
its per-turn event to ``BeforeAgent`` and its schema validator rejects the
legacy name. ``_detect_platform`` picks the right value at runtime.
Breadcrumb text is pulled exclusively from workflow.md
[workflow-state:STATUS] tag blocks — workflow.md is the single source of
truth. There are no fallback dicts in this script: when workflow.md is
missing or a tag is absent, the breadcrumb degrades to a generic
"Refer to workflow.md for current step." line so users see (and fix)
the broken state instead of the hook silently masking it.

Shared across all hook-capable platforms (Claude, Cursor, Codex, Qoder,
CodeBuddy, Droid, Gemini, Copilot, Kiro). Kiro wires this via the CLI
custom agent's ``hooks.userPromptSubmit`` and the IDE ``.kiro.hook``
``promptSubmit`` event; its output branch emits a plain-text breadcrumb
(Kiro adds hook stdout directly to the conversation context). Written to
each platform's hooks directory via writeSharedHooks() at init time.

Silent exit 0 cases (no output):
  - No .suncode/ directory found (not a Suncode project)
  - task.json malformed or missing status
"""
from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import queue
import threading
from pathlib import Path
from datetime import datetime, timezone

# Force UTF-8 on stdin/stdout/stderr on Windows. Default codepage there is
# cp936 / cp1252 / etc. — non-ASCII content (Chinese task names, prd snippets)
# both in stdin (hook payload from host CLI) and stdout (our emitted blocks)
# raises UnicodeDecodeError / UnicodeEncodeError. Equivalent to `python -X utf8`
# but applied per-stream so we don't depend on host CLI's command wiring.
if sys.platform.startswith("win"):
    import io as _io
    for _stream_name in ("stdin", "stdout", "stderr"):
        _stream = getattr(sys, _stream_name, None)
        if _stream is None:
            continue
        if hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
            except Exception:
                pass
        elif hasattr(_stream, "detach"):
            try:
                setattr(sys, _stream_name, _io.TextIOWrapper(_stream.detach(), encoding="utf-8", errors="replace"))
            except Exception:
                pass
from typing import Optional


# Bootstrap notice for Codex while the session has no active task. Codex does not
# get the full SessionStart overview; this short reminder points the main session
# at the start skill once and leaves the per-turn state block compact.
CODEX_NO_TASK_BOOTSTRAP_NOTICE = """<suncode-bootstrap>
If you have not already loaded Suncode context this session, read the `suncode-start` skill once.
</suncode-bootstrap>"""


# ---------------------------------------------------------------------------
# CWD-robust Suncode root discovery (fixes hook-path-robustness for this hook)
# ---------------------------------------------------------------------------

def find_suncode_root(start: Path) -> Optional[Path]:
    """Walk up from start to find directory containing .suncode/.

    Handles CWD drift: subdirectory launches, monorepo packages, etc.
    Returns None if no .suncode/ found (silent no-op).
    """
    cur = start.resolve()
    while cur != cur.parent:
        if (cur / ".suncode").is_dir():
            return cur
        cur = cur.parent
    return None


# ---------------------------------------------------------------------------
# Active task discovery
# ---------------------------------------------------------------------------

def _detect_platform(input_data: dict) -> str | None:
    if isinstance(input_data.get("cursor_version"), str):
        return "cursor"
    env_map = {
        "CLAUDE_PROJECT_DIR": "claude",
        "CURSOR_PROJECT_DIR": "cursor",
        "CODEBUDDY_PROJECT_DIR": "codebuddy",
        "FACTORY_PROJECT_DIR": "droid",
        "GEMINI_PROJECT_DIR": "gemini",
        "QODER_PROJECT_DIR": "qoder",
        "KIRO_PROJECT_DIR": "kiro",
        "COPILOT_PROJECT_DIR": "copilot",
        "TRAE_PROJECT_DIR": "trae",
    }
    for env_name, platform in env_map.items():
        if os.environ.get(env_name):
            return platform
    script_parts = set(Path(sys.argv[0]).parts)
    if ".claude" in script_parts:
        return "claude"
    if ".cursor" in script_parts:
        return "cursor"
    if ".codex" in script_parts:
        return "codex"
    if ".gemini" in script_parts:
        return "gemini"
    if ".qoder" in script_parts:
        return "qoder"
    if ".codebuddy" in script_parts:
        return "codebuddy"
    if ".factory" in script_parts:
        return "droid"
    if ".kiro" in script_parts:
        return "kiro"
    if ".trae" in script_parts:
        return "trae"
    return None


def _resolve_active_task(root: Path, input_data: dict):
    scripts_dir = root / ".suncode" / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    from common.active_task import resolve_active_task  # type: ignore[import-not-found]

    return resolve_active_task(root, input_data, platform=_detect_platform(input_data))


def get_active_task(root: Path, input_data: dict) -> Optional[tuple[str, str, str]]:
    """Return (task_id, status, source) from the current active task."""
    active = _resolve_active_task(root, input_data)
    if not active.task_path:
        return None

    task_dir = Path(active.task_path)
    if not task_dir.is_absolute():
        task_dir = root / task_dir
    if active.stale:
        return task_dir.name, f"stale_{active.source_type}", active.source

    task_json = task_dir / "task.json"
    if not task_json.is_file():
        return None
    try:
        data = json.loads(task_json.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None

    task_id = data.get("id") or task_dir.name
    status = data.get("status", "")
    if not isinstance(status, str) or not status:
        return None
    return task_id, status, active.source


# ---------------------------------------------------------------------------
# Breadcrumb loading: parse workflow.md, fall back to hardcoded defaults
# ---------------------------------------------------------------------------

# Supports STATUS values with letters, digits, underscores, hyphens
# (so "in-review" / "blocked-by-team" work alongside "in_progress").
_TAG_RE = re.compile(
    r"\[workflow-state:([A-Za-z0-9_-]+)\]\s*\n(.*?)\n\s*\[/workflow-state:\1\]",
    re.DOTALL,
)

def load_breadcrumbs(root: Path) -> dict[str, str]:
    """Parse workflow.md for [workflow-state:STATUS] blocks.

    Returns {status: body_text}. workflow.md is the single source of
    truth — there are no fallback dicts in this script. Missing tags
    (or a missing/unreadable workflow.md) fall back to a generic line
    in build_breadcrumb so users see the broken state and fix
    workflow.md, rather than the hook silently masking the issue.
    """
    workflow = root / ".suncode" / "workflow.md"
    if not workflow.is_file():
        return {}
    try:
        content = workflow.read_text(encoding="utf-8")
    except OSError:
        return {}

    result: dict[str, str] = {}
    for match in _TAG_RE.finditer(content):
        status = match.group(1)
        body = match.group(2).strip()
        if body:
            result[status] = body
    return result


def _read_suncode_config(root: Path) -> dict:
    """Load .suncode/config.yaml via the bundled suncode_config helper.

    The helper lives in .suncode/scripts/common; the hook lives outside the
    scripts tree, so we extend sys.path before importing.
    """
    scripts_dir = root / ".suncode" / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    try:
        from common.suncode_config import read_suncode_config  # type: ignore[import-not-found]
    except Exception:
        return {}
    try:
        return read_suncode_config(root)
    except Exception:
        return {}


def _codex_mode_banner(config: dict) -> str:
    """Emit a `<codex-mode>` banner for the additionalContext payload.

    Reads `codex.dispatch_mode` from .suncode/config.yaml; defaults to
    `inline` when missing or invalid because Codex sub-agents run with
    `fork_turns="none"` isolation and can't inherit the parent session's
    task context. The banner makes the active mode explicit to Codex AI
    per turn, complementing the workflow-state body which is per-status.
    Mode tells AI which dispatch protocol to follow; workflow-state tells
    AI what step it's at.
    """
    mode = "inline"
    if isinstance(config, dict):
        codex_cfg = config.get("codex")
        if isinstance(codex_cfg, dict):
            cfg_mode = codex_cfg.get("dispatch_mode")
            if cfg_mode in ("inline", "sub-agent"):
                mode = cfg_mode
    if mode == "sub-agent":
        meaning = (
            "sub-agent: implement/check work defaults to Suncode sub-agents; "
            "the main session still coordinates, clarifies, updates specs, commits, and finishes."
        )
    else:
        meaning = (
            "inline: the main session implements/checks directly; "
            "do not dispatch implement/check sub-agents."
        )
    return f"<codex-mode>{meaning}</codex-mode>"


def resolve_breadcrumb_key(
    status: str, platform: str | None, config: dict
) -> str:
    """Pick the breadcrumb tag key based on Codex dispatch_mode.

    Codex defaults to ``inline`` because sub-agents run with ``fork_turns="none"``
    isolation and can't inherit the parent session's task context. Users can
    opt into ``codex.dispatch_mode: sub-agent`` in ``.suncode/config.yaml``
    to use the parallel ``<status>-inline`` tag → ``<status>`` flip. Invalid
    or missing values fall back to inline.

    Non-codex platforms return the plain status unchanged.
    """
    if platform == "codex":
        mode = "inline"
        if isinstance(config, dict):
            codex_cfg = config.get("codex")
            if isinstance(codex_cfg, dict):
                cfg_mode = codex_cfg.get("dispatch_mode")
                if cfg_mode in ("inline", "sub-agent"):
                    mode = cfg_mode
        return f"{status}-inline" if mode == "inline" else status
    return status


def build_breadcrumb(
    task_id: Optional[str],
    status: str,
    templates: dict[str, str],
    source: str | None = None,
    breadcrumb_key: str | None = None,
) -> str:
    """Build the <workflow-state>...</workflow-state> block.

    - Known status (tag present in workflow.md) → detailed template body
    - Unknown status (no tag, or workflow.md missing) → generic
      "Refer to workflow.md for current step." line
    - `no_task` pseudo-status (task_id is None) → header omits task info
    """
    lookup_key = breadcrumb_key or status
    body = templates.get(lookup_key)
    if body is None and lookup_key != status:
        body = templates.get(status)
    if body is None:
        body = "Refer to workflow.md for current step."
    header = f"Status: {status}" if task_id is None else f"Task: {task_id} ({status})"
    return f"<workflow-state>\n{header}\n{body}\n</workflow-state>"


# ---------------------------------------------------------------------------
# Hub state loading: CLI-backed live refresh, no secrets
# ---------------------------------------------------------------------------

def build_hub_state(root: Path, config: dict, input_data: dict) -> str:
    """Build a compact <hub-state> block.

    Hub-off / incomplete local state returns without network. Once a project is
    configured and logged in, the hook asks the local CLI for authoritative
    state with a short timeout. Refresh failures are fail-closed as unavailable;
    stale cache must not make Hub look usable.
    """
    current_task = _current_hub_task_state(root, input_data)
    hub = config.get("hub") if isinstance(config, dict) else None
    if not isinstance(hub, dict) or not _yaml_bool_true(hub.get("enabled")):
        return "\n".join([
            "<hub-state>",
            "Hub: off",
            "Reason: hub.enabled is not true or .suncode/config.yaml is missing",
            f"Current task: {current_task}",
            "AI: use the local Suncode workflow; do not run Hub-specific commands.",
            "</hub-state>",
        ])

    project_id = _string_value(hub.get("projectId"))
    if not project_id:
        return _hub_state_block([
            "Hub: on",
            "Config: invalid (hub.projectId missing)",
            f"Current task: {current_task}",
            "AI: ask the user to run `suncode hub init` before using Hub workflows.",
        ])

    project_api_base_url = _normalize_api_base_url(_string_value(hub.get("apiBaseUrl")))
    global_api_base_url = _global_api_base_url()
    api_base_url = project_api_base_url or global_api_base_url
    if not api_base_url:
        return _hub_state_block([
            "Hub: on",
            f"Project: {project_id}",
            "Config: missing global apiBaseUrl",
            f"Current task: {current_task}",
            "AI: ask the user to run `suncode hub init` to set Hub apiBaseUrl.",
        ])

    session = _hub_auth_session(api_base_url)
    if session is None:
        return _hub_state_block([
            "Hub: on",
            f"Project: {project_id}",
            f"Login: missing for {api_base_url}",
            f"Current task: {current_task}",
            "AI: ask the user to run `suncode hub login` before using Hub workflows.",
        ])
    if _hub_session_expired(session):
        return _hub_state_block([
            "Hub: on",
            f"Project: {project_id}",
            f"Login: expired for {api_base_url}",
            f"Current task: {current_task}",
            "AI: ask the user to run `suncode hub login` before using Hub workflows.",
        ])

    live_state, refresh_error = _refresh_hub_state_via_cli(root, input_data)
    if live_state is None:
        return _hub_unavailable_block(
            project_id,
            current_task,
            refresh_error or "Hub state refresh failed",
        )

    return _format_live_hub_state(live_state, project_id, current_task)


def _format_live_hub_state(
    state: dict, fallback_project_id: str, fallback_current_task: str
) -> str:
    summary = state.get("summary") if isinstance(state.get("summary"), dict) else {}
    project = state.get("project") if isinstance(state.get("project"), dict) else {}
    current = state.get("currentTask") if isinstance(state.get("currentTask"), dict) else {}
    hub = _string_value(summary.get("hub")) or "unknown"
    project_id = _string_value(project.get("projectId")) or fallback_project_id
    config = _string_value(summary.get("config")) or "unknown"
    login = _string_value(summary.get("login")) or "unknown"
    service = _string_value(summary.get("service")) or "unknown"
    work = _string_value(summary.get("work")) or "unknown"
    current_task = (
        _string_value(current.get("state"))
        or _string_value(summary.get("currentTask"))
        or fallback_current_task
    )
    lines = [
        f"Hub: {hub}",
        "Source: live (`suncode hub state --json`)",
        f"Project: {project_id}",
        f"Config: {config}",
        f"Login: {login}",
        f"Service: {service}",
        f"Work: {_work_line(state, work)}",
        f"Current task: {current_task}",
    ]
    next_action = _string_value(state.get("nextAction"))
    if next_action:
        lines.append(f"AI: {next_action}")
    elif service == "unavailable":
        lines.append("AI: Hub service is currently unavailable; do not use Hub-specific workflows.")
    elif current_task == "local-only":
        lines.append(
            "AI: 当前任务未绑定 Hub；不要运行 submit-plan、submit-completion、mark-started 等 Hub 任务命令，除非用户明确要求绑定 Hub 需求。"
        )
    elif work == "available":
        lines.append("AI: ask the user whether to pull/select Hub work with `suncode hub pull`.")
    else:
        lines.append("AI: use Hub commands only for Hub-bound tasks.")
    return _hub_state_block(lines)


def _hub_unavailable_block(project_id: str, current_task: str, reason: str) -> str:
    return _hub_state_block([
        "Hub: on",
        "Source: live refresh failed",
        f"Project: {project_id}",
        "Service: unavailable",
        f"Reason: {reason}",
        f"Current task: {current_task}",
        "AI: Hub state refresh failed or timed out; treat Hub as currently unavailable and do not use Hub-specific workflows.",
    ])


def _refresh_hub_state_via_cli(
    root: Path, input_data: dict
) -> tuple[dict | None, str | None]:
    command = _suncode_cli_command()
    if command is None:
        return None, "Hub state refresh failed: suncode command not found"
    try:
        completed = subprocess.run(
            [*command, "hub", "state", "--json"],
            cwd=str(root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=_hub_state_hook_timeout_seconds(),
            env=_hub_state_subprocess_env(root, input_data),
        )
    except subprocess.TimeoutExpired:
        return None, "Hub state refresh timed out"
    except Exception:
        return None, "Hub state refresh failed"
    if completed.returncode != 0:
        return None, "Hub state refresh failed"
    try:
        parsed = json.loads(completed.stdout)
    except (json.JSONDecodeError, ValueError):
        return None, "Hub state refresh failed"
    if not isinstance(parsed, dict):
        return None, "Hub state refresh failed"
    return parsed, None


def _hub_state_hook_timeout_seconds() -> float:
    raw = os.environ.get("SUNCODE_HUB_STATE_HOOK_TIMEOUT_MS")
    try:
        timeout_ms = int(raw) if raw else 1500
    except ValueError:
        timeout_ms = 1500
    timeout_ms = min(max(timeout_ms, 50), 10000)
    return timeout_ms / 1000


def _suncode_cli_command() -> list[str] | None:
    override = _string_value(os.environ.get("SUNCODE_CLI"))
    if override:
        try:
            parsed = shlex.split(override, posix=(os.name != "nt"))
        except ValueError:
            parsed = [override]
        return parsed or None
    found = shutil.which("suncode") or shutil.which("suncode.cmd")
    if found:
        return [found]
    fallback = Path.home() / ".local" / "share" / "pnpm" / "suncode"
    return [str(fallback)] if fallback.exists() else None


def _hub_state_subprocess_env(root: Path, input_data: dict) -> dict[str, str]:
    env = os.environ.copy()
    env["SUNCODE_HOOKS"] = "0"
    try:
        active = _resolve_active_task(root, input_data)
        context_key = getattr(active, "context_key", None)
        if isinstance(context_key, str) and context_key:
            env["SUNCODE_CONTEXT_ID"] = context_key
    except Exception:
        pass
    return env


def _hub_state_block(lines: list[str]) -> str:
    return "\n".join(["<hub-state>", *lines, "</hub-state>"])


def _global_api_base_url() -> str | None:
    config = _read_json(Path.home() / ".suncode" / "hub" / "config.json")
    if not isinstance(config, dict):
        return None
    return _normalize_api_base_url(_string_value(config.get("defaultApiBaseUrl")))


def _hub_auth_session(api_base_url: str) -> dict | None:
    auth = _read_json(Path.home() / ".suncode" / "hub" / "auth.json")
    if not isinstance(auth, dict):
        return None
    sessions = auth.get("sessions")
    if not isinstance(sessions, dict):
        return None
    session = sessions.get(api_base_url)
    return session if isinstance(session, dict) else None


def _hub_session_expired(session: dict) -> bool:
    expires_at = _string_value(session.get("expiresAt"))
    if not expires_at:
        return False
    try:
        parsed = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed <= datetime.now(timezone.utc)


def _current_hub_task_state(root: Path, input_data: dict) -> str:
    try:
        active = _resolve_active_task(root, input_data)
    except Exception:
        return "unknown"
    if not active.task_path:
        return "none"
    task_dir = Path(active.task_path)
    if not task_dir.is_absolute():
        task_dir = root / task_dir
    task_json = task_dir / "task.json"
    data = _read_json(task_json)
    if not isinstance(data, dict):
        return "unknown"
    meta = data.get("meta")
    hub = meta.get("hub") if isinstance(meta, dict) else None
    if not isinstance(hub, dict):
        return "local-only"
    if _string_value(hub.get("remoteTaskId")) or hub.get("bindingStatus") == "bound":
        return "hub-bound"
    if _string_value(hub.get("requirementId")) or hub.get("bindingStatus") in (
        "pending",
        "pending_parent",
        "failed",
    ):
        return "hub-pending"
    return "local-only"


def _work_line(state: object, fallback: str) -> str:
    if isinstance(state, dict):
        work = state.get("work")
        if isinstance(work, dict):
            count = work.get("availableCount")
            if isinstance(count, int):
                return f"{count} available requirements" if count > 0 else "none"
    return fallback


def _read_json(path: Path) -> object | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _normalize_api_base_url(value: str | None) -> str | None:
    if not value:
        return None
    return value.strip().rstrip("/")


def _string_value(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _yaml_bool_true(value: object) -> bool:
    if value is True:
        return True
    if isinstance(value, str):
        return value.strip().lower() in ("true", "yes", "1", "on")
    return False


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------

def _load_hook_input() -> dict:
    """Read hook JSON without trusting host runners to close stdin.

    Kiro IDE `runCommand` and similar hook runners can leave stdin open while
    sending no payload. A plain `json.load(sys.stdin)` then blocks forever.
    Normal hook runners write the complete JSON payload and close stdin, so the
    short daemon read preserves that path while failing closed to `{}` for
    non-piping hosts.
    """
    result_queue: "queue.Queue[str | BaseException]" = queue.Queue(maxsize=1)

    def _read() -> None:
        try:
            result_queue.put(sys.stdin.read())
        except BaseException as exc:
            result_queue.put(exc)

    reader = threading.Thread(target=_read, daemon=True)
    reader.start()
    try:
        raw = result_queue.get(timeout=0.2)
    except queue.Empty:
        return {}

    if isinstance(raw, BaseException):
        return {}
    try:
        data = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def main() -> int:
    if os.environ.get("SUNCODE_HOOKS") == "0" or os.environ.get("SUNCODE_DISABLE_HOOKS") == "1":
        return 0

    data = _load_hook_input()

    cwd_str = data.get("cwd") or os.getcwd()
    cwd = Path(cwd_str)

    root = find_suncode_root(cwd)
    if root is None:
        return 0  # not a Suncode project

    templates = load_breadcrumbs(root)
    platform = _detect_platform(data)
    config = _read_suncode_config(root)
    task = get_active_task(root, data)
    if task is None:
        # No active task — still emit a breadcrumb nudging AI toward
        # suncode-brainstorm + task.py create when user describes real work.
        no_task_key = resolve_breadcrumb_key("no_task", platform, config)
        breadcrumb = build_breadcrumb(
            None, "no_task", templates, breadcrumb_key=no_task_key
        )
    else:
        task_id, status, source = task
        status_key = resolve_breadcrumb_key(status, platform, config)
        source_for_breadcrumb = None if platform == "codex" else source
        breadcrumb = build_breadcrumb(
            task_id, status, templates, source_for_breadcrumb, breadcrumb_key=status_key
        )
    if platform == "codex":
        parts: list[str] = []
        if task is None:
            parts.append(CODEX_NO_TASK_BOOTSTRAP_NOTICE)
        parts.append(_codex_mode_banner(config))
        parts.append(breadcrumb)
        breadcrumb = "\n\n".join(parts)
    breadcrumb = f"{breadcrumb}\n\n{build_hub_state(root, config, data)}"

    # Kiro (CLI userPromptSubmit / IDE promptSubmit) adds a hook's stdout
    # directly to the conversation context — no JSON envelope. Emit the bare
    # breadcrumb text. Conditionally isolated: all other platforms keep the
    # hookSpecificOutput JSON path below unchanged.
    if platform == "kiro":
        print(breadcrumb)
        return 0

    # Gemini CLI 0.40.x rejects "UserPromptSubmit" — its per-turn event is
    # named "BeforeAgent". Other platforms (Claude/Cursor/Qoder/CodeBuddy/
    # Droid/Codex/Copilot) accept the original Claude-style name.
    hook_event_name = (
        "BeforeAgent" if platform == "gemini" else "UserPromptSubmit"
    )

    output = {
        "hookSpecificOutput": {
            "hookEventName": hook_event_name,
            "additionalContext": breadcrumb,
        }
    }
    print(json.dumps(output))
    return 0


if __name__ == "__main__":
    sys.exit(main())
