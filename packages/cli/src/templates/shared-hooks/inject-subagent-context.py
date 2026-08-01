#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Multi-Platform Sub-Agent Context Injection Hook

Injects task-specific context when sub-agents (implement, check, research) are spawned.

Core Design Philosophy:
- Hook is responsible for injecting all context, subagent works autonomously with complete info
- Each agent has a dedicated jsonl file defining its context
- No resume needed, no segmentation, behavior controlled by code not prompt

Trigger: PreToolUse (before Task tool call)

Context Source: Suncode active task resolver points to task directory
- implement.jsonl - Implement agent dedicated context
- check.jsonl     - Check agent dedicated context
- prd.md          - Requirements document
- design.md       - Technical design for complex tasks
- implement.md    - Execution plan for complex tasks
- codex-review-output.txt - Code Review results
"""
from __future__ import annotations

# IMPORTANT: Suppress all warnings FIRST
import warnings
warnings.filterwarnings("ignore")

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

# Hook hosts send UTF-8 JSON regardless of the process locale.
_stdin_reconfigure = getattr(sys.stdin, "reconfigure", None)
if callable(_stdin_reconfigure):
    try:
        _stdin_reconfigure(encoding="utf-8", errors="replace")
    except (OSError, ValueError):
        pass

# IMPORTANT: Force stdout to use UTF-8 on Windows
# This fixes UnicodeEncodeError when outputting non-ASCII characters
if sys.platform.startswith("win"):
    import io as _io
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    elif hasattr(sys.stdout, "detach"):
        sys.stdout = _io.TextIOWrapper(sys.stdout.detach(), encoding="utf-8", errors="replace")  # type: ignore[union-attr]


# =============================================================================
# Path Constants (change here to rename directories)
# =============================================================================

DIR_WORKFLOW = ".suncode"
DIR_SPEC = "spec"
FILE_TASK_JSON = "task.json"

# =============================================================================
# Subagent Constants (change here to rename subagent types)
# =============================================================================

AGENT_IMPLEMENT = "suncode-implement"
AGENT_CHECK = "suncode-check"
AGENT_RESEARCH = "suncode-research"

# Agents that require a task directory
AGENTS_REQUIRE_TASK = (AGENT_IMPLEMENT, AGENT_CHECK)
# All supported agents
AGENTS_ALL = (AGENT_IMPLEMENT, AGENT_CHECK, AGENT_RESEARCH)

_CONTEXT_MANIFEST_HINT_RE = re.compile(
    r"^\s*Suncode context manifest:\s*(\S+)\s*$",
    re.MULTILINE,
)
_MANIFEST_ROLES_BY_AGENT = {
    AGENT_IMPLEMENT: ("implement", "fix", "integration"),
    AGENT_CHECK: ("check",),
    AGENT_RESEARCH: ("research",),
}


def find_repo_root(start_path: str) -> str | None:
    """
    Find git repo root from start_path upwards

    Returns:
        Repo root path, or None if not found
    """
    current = Path(start_path).resolve()
    while current != current.parent:
        if (current / ".git").exists():
            return str(current)
        current = current.parent
    return None


def _detect_platform(input_data: dict) -> str | None:
    if _hook_event_name(input_data) == "SubagentStart":
        return "codex"
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
    }
    for env_name, platform in env_map.items():
        if os.environ.get(env_name):
            return platform
    script_parts = set(Path(sys.argv[0]).parts)
    if ".claude" in script_parts:
        return "claude"
    if ".cursor" in script_parts:
        return "cursor"
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
    return None


def get_current_task(
    repo_root: str,
    input_data: dict,
    *,
    platform: str | None = None,
    allow_single_session_fallback: bool = True,
    allow_environment_context: bool = True,
    require_existing: bool = False,
) -> str | None:
    """Resolve current task directory through the unified active task resolver."""
    scripts_dir = Path(repo_root) / DIR_WORKFLOW / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    try:
        from common.active_task import resolve_active_task  # type: ignore[import-not-found]
    except Exception:
        return None

    active = resolve_active_task(
        Path(repo_root),
        input_data,
        platform=platform or _detect_platform(input_data),
        allow_single_session_fallback=allow_single_session_fallback,
        allow_environment_context=allow_environment_context,
    )
    if require_existing and active.stale:
        return None
    return active.task_path


# =============================================================================
# Context Injection Limits
#
# Notice wording is mirrored by the Pi and OpenCode implementations. Keep the
# three adapters aligned whenever this contract changes.
# =============================================================================

DEFAULT_MAX_FILE_BYTES = 32768
DEFAULT_MAX_ARTIFACT_BYTES = 65536
DEFAULT_MAX_TOTAL_BYTES = 131072

DEFAULT_LIMITS: dict[str, int] = {
    "max_file_bytes": DEFAULT_MAX_FILE_BYTES,
    "max_artifact_bytes": DEFAULT_MAX_ARTIFACT_BYTES,
    "max_total_bytes": DEFAULT_MAX_TOTAL_BYTES,
}


def _get_limits(repo_root: str) -> dict[str, int]:
    """Load context-injection limits with a fail-open default."""
    scripts_dir = Path(repo_root) / DIR_WORKFLOW / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    try:
        from common.config import get_context_injection_limits  # type: ignore[import-not-found]

        return get_context_injection_limits(Path(repo_root))
    except Exception:
        return dict(DEFAULT_LIMITS)


def truncate_utf8(data: bytes, cap: int) -> bytes:
    """Truncate bytes without splitting a UTF-8 code point.

    ``cap <= 0`` disables the limit.
    """
    if cap <= 0 or len(data) <= cap:
        return data

    truncated = data[:cap]
    end = len(truncated)
    while end > 0 and (truncated[end - 1] & 0xC0) == 0x80:
        end -= 1
    if end == 0:
        return b""

    lead = truncated[end - 1]
    if lead & 0x80:
        if (lead & 0xE0) == 0xC0:
            sequence_length = 2
        elif (lead & 0xF0) == 0xE0:
            sequence_length = 3
        elif (lead & 0xF8) == 0xF0:
            sequence_length = 4
        else:
            sequence_length = 1
        if (end - 1) + sequence_length > len(truncated):
            end -= 1
    return truncated[:end]


class _Budget:
    """Track emitted UTF-8 bytes across one injected context."""

    def __init__(self, max_total_bytes: int) -> None:
        self.max_total_bytes = max_total_bytes
        self.used = 0
        self.exhausted = False

    def has_room(self, size: int) -> bool:
        return self.max_total_bytes <= 0 or self.used + size <= self.max_total_bytes

    def add(self, size: int) -> None:
        self.used += size


def _read_file_bytes(base_path: str, file_path: str) -> bytes | None:
    """Read raw bytes, returning ``None`` when the path is unavailable."""
    full_path = os.path.join(base_path, file_path)
    if not os.path.isfile(full_path):
        return None
    try:
        with open(full_path, "rb") as file_handle:
            return file_handle.read()
    except Exception:
        return None


def _truncate_notice(path: str, cap: int) -> str:
    return f"\n[Suncode: truncated at {cap} bytes — read {path} for the full content]"


def _is_binary_content(data: bytes) -> bool:
    """Return whether raw bytes must not be decoded into model context."""
    if b"\x00" in data:
        return True
    try:
        data.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        return True
    return False


def _binary_notice(path: str, size: int, reason: str) -> str:
    return f"[Suncode: not inlined (binary file) — {path} ({size} bytes): {reason}]"


def _index_notice(path: str, size: int, reason: str) -> str:
    return (
        "[Suncode: not inlined (total context limit reached) — "
        f"{path} ({size} bytes): {reason}]"
    )


_TOTAL_LIMIT_EXHAUSTED_NOTICE = (
    "[Suncode: total context limit reached — remaining context entries omitted]"
)


def _budgeted_notice(budget: _Budget, notice: str) -> str | None:
    """Add a detailed notice, or emit one bounded terminal notice."""
    if budget.exhausted:
        return None
    notice_size = len(notice.encode("utf-8"))
    if budget.has_room(notice_size):
        budget.add(notice_size)
        return notice
    budget.exhausted = True
    budget.add(len(_TOTAL_LIMIT_EXHAUSTED_NOTICE.encode("utf-8")))
    return _TOTAL_LIMIT_EXHAUSTED_NOTICE


def _budgeted_block(
    budget: _Budget,
    header: str,
    plain_path: str,
    content: str,
    reason: str,
    size_for_index: int,
) -> str | None:
    if budget.exhausted:
        return None
    block = f"=== {header} ===\n{content}"
    block_size = len(block.encode("utf-8"))
    if not budget.has_room(block_size):
        notice = _index_notice(plain_path, size_for_index, reason)
        return _budgeted_notice(budget, notice)
    budget.add(block_size)
    return block


def _materialize_file(
    base_path: str,
    file_path: str,
    reason: str,
    limits: dict[str, int],
    budget: _Budget,
) -> str | None:
    if budget.exhausted:
        return None
    data = _read_file_bytes(base_path, file_path)
    if data is None:
        return None

    size = len(data)
    if _is_binary_content(data):
        notice = _binary_notice(file_path, size, reason)
        return _budgeted_notice(budget, notice)

    cap = limits["max_file_bytes"]
    truncated = truncate_utf8(data, cap)
    content = truncated.decode("utf-8", errors="strict")
    if len(truncated) < size:
        content += _truncate_notice(file_path, cap)
    return _budgeted_block(budget, file_path, file_path, content, reason, size)


def _materialize_directory(
    base_path: str,
    dir_path: str,
    reason: str,
    limits: dict[str, int],
    budget: _Budget,
    max_files: int = 20,
) -> list[str]:
    full_path = os.path.join(base_path, dir_path)
    if not os.path.isdir(full_path):
        return []
    try:
        names = sorted(
            name
            for name in os.listdir(full_path)
            if name.endswith(".md") and os.path.isfile(os.path.join(full_path, name))
        )
    except Exception:
        return []

    blocks: list[str] = []
    for name in names[:max_files]:
        if budget.exhausted:
            break
        relative_path = os.path.join(dir_path, name)
        block = _materialize_file(base_path, relative_path, reason, limits, budget)
        if block:
            blocks.append(block)
    return blocks


def read_jsonl_entries(base_path: str, jsonl_path: str) -> list[dict]:
    """Parse file/directory entries from a JSONL context manifest."""
    full_path = os.path.join(base_path, jsonl_path)
    if not os.path.exists(full_path):
        print(
            f"[inject-subagent-context] WARN: {jsonl_path} not found — "
            "sub-agent will receive only task artifacts",
            file=sys.stderr,
        )
        return []

    entries: list[dict] = []
    saw_real_entry = False
    try:
        with open(full_path, "r", encoding="utf-8") as file_handle:
            for raw_line in file_handle:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue
                file_path = item.get("file") or item.get("path")
                if not file_path:
                    continue
                saw_real_entry = True
                entries.append(
                    {
                        "file": file_path,
                        "type": item.get("type", "file"),
                        "reason": item.get("reason") or "-",
                    }
                )
    except Exception:
        pass

    if not saw_real_entry:
        print(
            f"[inject-subagent-context] WARN: {jsonl_path} has no curated "
            "entries (only seed / empty) — sub-agent will receive only "
            "task artifacts. See workflow.md planning artifact guidance.",
            file=sys.stderr,
        )
    return entries


def _materialize_jsonl_entries(
    base_path: str,
    jsonl_path: str,
    limits: dict[str, int],
    budget: _Budget,
) -> list[str]:
    blocks: list[str] = []
    for entry in read_jsonl_entries(base_path, jsonl_path):
        if budget.exhausted:
            break
        if entry["type"] == "directory":
            blocks.extend(
                _materialize_directory(
                    base_path,
                    entry["file"],
                    entry["reason"],
                    limits,
                    budget,
                )
            )
        else:
            block = _materialize_file(
                base_path,
                entry["file"],
                entry["reason"],
                limits,
                budget,
            )
            if block:
                blocks.append(block)
    return blocks


def get_agent_context(
    repo_root: str,
    task_dir: str,
    agent_type: str,
    limits: dict[str, int],
    budget: _Budget,
) -> str:
    blocks = _materialize_jsonl_entries(
        repo_root,
        f"{task_dir}/{agent_type}.jsonl",
        limits,
        budget,
    )
    return "\n\n".join(blocks)


def _materialize_artifact(
    base_path: str,
    file_path: str,
    header_label: str,
    reason: str,
    limits: dict[str, int],
    budget: _Budget,
) -> str | None:
    if budget.exhausted:
        return None
    data = _read_file_bytes(base_path, file_path)
    if data is None:
        return None

    size = len(data)
    if _is_binary_content(data):
        notice = _binary_notice(file_path, size, reason)
        return _budgeted_notice(budget, notice)

    cap = limits["max_artifact_bytes"]
    truncated = truncate_utf8(data, cap)
    content = truncated.decode("utf-8", errors="strict")
    if len(truncated) < size:
        content += _truncate_notice(file_path, cap)
    return _budgeted_block(
        budget,
        header_label,
        file_path,
        content,
        reason,
        size,
    )


def _task_context(repo_root: str, task_dir: str, agent_type: str) -> str:
    limits = _get_limits(repo_root)
    budget = _Budget(limits["max_total_bytes"])
    parts: list[str] = []

    base_context = get_agent_context(
        repo_root,
        task_dir,
        agent_type,
        limits,
        budget,
    )
    if base_context:
        parts.append(base_context)

    artifacts = (
        ("prd.md", "Requirements", "Requirements document"),
        ("design.md", "Technical Design", "Technical design document"),
        ("implement.md", "Execution Plan", "Execution plan document"),
    )
    for name, label, reason in artifacts:
        if budget.exhausted:
            break
        file_path = f"{task_dir}/{name}"
        block = _materialize_artifact(
            repo_root,
            file_path,
            f"{file_path} ({label})",
            reason,
            limits,
            budget,
        )
        if block:
            parts.append(block)
    return "\n\n".join(parts)


def get_implement_context(repo_root: str, task_dir: str) -> str:
    """Return implement JSONL context followed by task artifacts."""
    return _task_context(repo_root, task_dir, "implement")


def get_check_context(repo_root: str, task_dir: str) -> str:
    """Return check JSONL context followed by task artifacts."""
    return _task_context(repo_root, task_dir, "check")


def get_finish_context(repo_root: str, task_dir: str) -> str:
    """
    Context for Finish phase: reuses check.jsonl + prd.md
    (Finish is a final check, same context source.)
    """
    return get_check_context(repo_root, task_dir)


def _context_manifest_hint(input_data: dict, prompt: str = "") -> str:
    for key in ("context_manifest", "contextManifest"):
        value = _string_value(input_data.get(key))
        if value:
            return value
    match = _CONTEXT_MANIFEST_HINT_RE.search(prompt)
    return match.group(1).strip() if match else ""


def get_execution_manifest_context(
    repo_root: str,
    input_data: dict,
    prompt: str,
    subagent_type: str,
) -> tuple[str, str] | None:
    """Load the canonical node manifest when a dispatch explicitly references it."""
    manifest_ref = _context_manifest_hint(input_data, prompt)
    if not manifest_ref:
        return None
    scripts_dir = Path(repo_root) / DIR_WORKFLOW / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    try:
        from common.execution_context import (  # type: ignore[import-not-found]
            read_node_context_manifest,
        )

        manifest, content = read_node_context_manifest(
            Path(repo_root),
            manifest_ref,
        )
    except Exception as exc:
        print(
            f"[inject-subagent-context] WARN: invalid execution manifest: {exc}",
            file=sys.stderr,
        )
        return None
    role = manifest.get("role")
    if role not in _MANIFEST_ROLES_BY_AGENT.get(subagent_type, ()):
        print(
            f"[inject-subagent-context] WARN: manifest role {role!r} does not match {subagent_type}",
            file=sys.stderr,
        )
        return None
    task = manifest.get("task")
    task_path = task.get("path") if isinstance(task, dict) else None
    if not isinstance(task_path, str) or not task_path:
        return None
    run = manifest.get("run")
    parent_session = run.get("parentSession") if isinstance(run, dict) else None
    event_parent_session = _string_value(
        input_data.get("session_id") or input_data.get("sessionId")
    )
    if parent_session and event_parent_session and parent_session != event_parent_session:
        print(
            "[inject-subagent-context] WARN: manifest parent session does not match hook event",
            file=sys.stderr,
        )
        return None
    return task_path, content



def build_implement_prompt(original_prompt: str, context: str) -> str:
    """Build complete prompt for Implement"""
    return f"""<!-- suncode-hook-injected -->
# Implement Agent Task

You are the Implement Agent in the Multi-Agent Pipeline.

## Your Context

All the information you need has been prepared for you:

{context}

---

## Your Task

{original_prompt}

---

## Workflow

1. **Understand specs** - All dev specs are injected above, understand them
    2. **Understand task artifacts** - Read requirements, technical design if present, and execution plan if present
    3. **Implement feature** - Implement following specs and task artifacts
4. **Self-check** - Ensure code quality against check specs

## Important Constraints

- Do NOT execute git commit, only code modifications
- Follow all dev specs injected above
- Report list of modified/created files when done"""


def build_execution_prompt(original_prompt: str, context: str) -> str:
    """Build a role-neutral prompt around the canonical execution-node contract."""
    return f"""<!-- suncode-hook-injected -->
# Suncode Execution Node

The immutable, budgeted node context is below. Its objective, boundaries,
validation, and result protocol override legacy role defaults.

{context}

---

## Dispatch Request

{original_prompt}"""


def build_check_prompt(original_prompt: str, context: str) -> str:
    """Build complete prompt for Check"""
    return f"""<!-- suncode-hook-injected -->
# Check Agent Task

You are the Check Agent in the Multi-Agent Pipeline (code and cross-layer checker).

## Your Context

All check specs and dev specs you need:

{context}

---

## Your Task

{original_prompt}

---

## Workflow

1. **Get changes** - Run `git diff --name-only` and `git diff` to get code changes
2. **Check against specs** - Check item by item against specs above
3. **Self-fix** - Fix issues directly, don't just report
4. **Run verification** - Run project's lint and typecheck commands

## Important Constraints

- Fix issues yourself, don't just report
- Must execute complete checklist in check specs
- Pay special attention to impact radius analysis (L1-L5)"""


def build_finish_prompt(original_prompt: str, context: str) -> str:
    """Build complete prompt for Finish (final check before PR)"""
    return f"""<!-- suncode-hook-injected -->
# Finish Agent Task

You are performing the final check before creating a PR.

## Your Context

Finish checklist and requirements:

{context}

---

## Your Task

{original_prompt}

---

## Workflow

1. **Review changes** - Run `git diff --name-only` to see all changed files
	2. **Verify task artifacts** - Check requirements in prd.md and, when present, design.md / implement.md
3. **Spec sync** - Analyze whether changes introduce new patterns, contracts, or conventions
   - If new pattern/convention found: read target spec file → update it → update index.md if needed
   - If infra/cross-layer change: follow the 7-section mandatory template from update-spec.md
   - If pure code fix with no new patterns: skip this step
4. **Run final checks** - Execute lint and typecheck
5. **Confirm ready** - Ensure code is ready for PR

## Important Constraints

- You MAY update spec files when gaps are detected (use update-spec.md as guide)
- MUST read the target spec file BEFORE editing (avoid duplicating existing content)
- Do NOT update specs for trivial changes (typos, formatting, obvious fixes)
- If critical CODE issues found, report them clearly (fix specs, not code)
- Verify all acceptance criteria in prd.md are met
- Verify design.md and implement.md constraints when those files are present"""



def get_research_context(repo_root: str, task_dir: str | None) -> str:
    """
    Context for Research Agent — project structure overview for spec directories.

    `task_dir` kept for signature parity with get_implement_context / get_check_context
    so the dispatcher can call them uniformly.
    """
    _ = task_dir
    context_parts = []

    # 1. Project structure overview (dynamically discover spec directories)
    spec_path = f"{DIR_WORKFLOW}/{DIR_SPEC}"
    spec_root = Path(repo_root) / DIR_WORKFLOW / DIR_SPEC

    # Build spec tree dynamically
    tree_lines = [f"{spec_path}/"]
    if spec_root.is_dir():
        pkg_dirs = sorted(d for d in spec_root.iterdir() if d.is_dir())
        for i, pkg_dir in enumerate(pkg_dirs):
            is_last = i == len(pkg_dirs) - 1
            prefix = "└── " if is_last else "├── "
            layers = sorted(d.name for d in pkg_dir.iterdir() if d.is_dir())
            layer_info = f" ({', '.join(layers)})" if layers else ""
            tree_lines.append(f"{prefix}{pkg_dir.name}/{layer_info}")

    spec_tree = "\n".join(tree_lines)

    project_structure = f"""## Project Spec Directory Structure

```
{spec_tree}
```

To get structured package info, run: `python3 ./{DIR_WORKFLOW}/scripts/get_context.py --mode packages`

## Search Tips

- Spec files: `{spec_path}/**/*.md`
- Code search: Use Glob and Grep tools
- Tech solutions: Use mcp__exa__web_search_exa or mcp__exa__get_code_context_exa"""

    context_parts.append(project_structure)

    return "\n\n".join(context_parts)


def build_research_prompt(original_prompt: str, context: str) -> str:
    """Build complete prompt for Research"""
    return f"""# Research Agent Task

You are the Research Agent in the Multi-Agent Pipeline (search researcher).

## Core Principle

**You do one thing: find and explain information.**

You are a documenter, not a reviewer.

## Project Info

{context}

---

## Your Task

{original_prompt}

---

## Workflow

1. **Understand query** - Determine search type (internal/external) and scope
2. **Plan search** - List search steps for complex queries
3. **Execute search** - Execute multiple independent searches in parallel
4. **Organize results** - Output structured report

## Search Tools

| Tool | Purpose |
|------|---------|
| Glob | Search by filename pattern |
| Grep | Search by content |
| Read | Read file content |
| mcp__exa__web_search_exa | External web search |
| mcp__exa__get_code_context_exa | External code/doc search |

## Strict Boundaries

**Only allowed**: Describe what exists, where it is, how it works

**Forbidden** (unless explicitly asked):
- Suggest improvements
- Criticize implementation
- Recommend refactoring
- Modify any files

## Report Format

Provide structured search results including:
- List of files found (with paths)
- Code pattern analysis (if applicable)
- Related spec documents
- External references (if any)"""


def _string_value(value: Any) -> str:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped
    return ""


def _hook_event_name(input_data: dict) -> str:
    """Return a hook event name from the documented snake/camel-case fields."""
    return _string_value(
        input_data.get("hook_event_name") or input_data.get("hookEventName")
    )


def _codex_subagent_type(input_data: dict) -> str:
    """Return a Suncode Codex agent type only for a native start event."""
    if _hook_event_name(input_data) != "SubagentStart":
        return ""
    agent_type = _string_value(
        input_data.get("agent_type") or input_data.get("agentType")
    )
    return agent_type if agent_type in AGENTS_ALL else ""


def build_codex_subagent_context(
    subagent_type: str,
    task_dir: str,
    context: str,
) -> str:
    """Build developer context for a native, already-dispatched Codex role."""
    role = subagent_type.removeprefix("suncode-")
    return f"""<!-- suncode-hook-injected -->
# Suncode Native {role.title()} Subagent

You are the dispatched `{subagent_type}` role for this task. Perform that role
directly; do not follow main-session dispatch or wait instructions, and do not
spawn another Suncode subagent.

Active task: {task_dir}

## Curated Context

{context}"""


def _handle_codex_subagent_start(input_data: dict) -> None:
    """Emit Codex developer context for a recognised native Suncode subagent.

    The event supplies the parent session id. Disabling the generic
    single-session and environment fallbacks is essential here: native starts
    must never borrow a task from another Codex window when that parent id is
    absent or stale.
    """
    subagent_type = _codex_subagent_type(input_data)
    parent_session_id = _string_value(
        input_data.get("session_id") or input_data.get("sessionId")
    )
    if not subagent_type or not parent_session_id:
        return

    cwd = _string_value(input_data.get("cwd")) or os.getcwd()
    repo_root = find_repo_root(cwd)
    if not repo_root:
        return

    manifest_ref = _context_manifest_hint(input_data)
    manifest_context = get_execution_manifest_context(
        repo_root,
        input_data,
        "",
        subagent_type,
    )
    if manifest_ref and manifest_context is None:
        return
    if manifest_context is not None:
        task_dir, context = manifest_context
        output = {
            "hookSpecificOutput": {
                "hookEventName": "SubagentStart",
                "additionalContext": build_codex_subagent_context(
                    subagent_type,
                    task_dir,
                    context,
                ),
            }
        }
        print(json.dumps(output, ensure_ascii=False))
        return

    task_dir = get_current_task(
        repo_root,
        {"session_id": parent_session_id},
        platform="codex",
        allow_single_session_fallback=False,
        allow_environment_context=False,
        require_existing=True,
    )
    if not task_dir:
        return

    if subagent_type in AGENTS_REQUIRE_TASK:
        task_dir_full = Path(repo_root) / task_dir
        if not task_dir_full.is_dir():
            return

    if subagent_type == AGENT_IMPLEMENT:
        context = get_implement_context(repo_root, task_dir)
    elif subagent_type == AGENT_CHECK:
        context = get_check_context(repo_root, task_dir)
    else:
        context = get_research_context(repo_root, task_dir)

    if not context:
        return

    output = {
        "hookSpecificOutput": {
            "hookEventName": "SubagentStart",
            "additionalContext": build_codex_subagent_context(
                subagent_type, task_dir, context
            ),
        }
    }
    print(json.dumps(output, ensure_ascii=False))


def _extract_subagent_name(value: Any) -> str:
    """Extract a sub-agent name from common platform encodings.

    Cursor's native Task args encode custom sub-agents as a protobuf oneof,
    which can appear in hook JSON as either ``{"custom": {"name": "..."}}``
    or ``{"type": {"case": "custom", "value": {"name": "..."}}}``.
    """
    direct = _string_value(value)
    if direct:
        return direct

    if not isinstance(value, dict):
        return ""

    for key in ("name", "subagent_type_name", "subagentTypeName"):
        direct = _string_value(value.get(key))
        if direct:
            return direct

    custom = value.get("custom")
    if isinstance(custom, dict):
        custom_name = _string_value(custom.get("name"))
        if custom_name:
            return custom_name

    oneof = value.get("type")
    if isinstance(oneof, dict):
        case_name = _string_value(oneof.get("case"))
        if case_name == "custom":
            nested_value = oneof.get("value")
            if isinstance(nested_value, dict):
                custom_name = _string_value(nested_value.get("name"))
                if custom_name:
                    return custom_name
        if case_name:
            return case_name

    case_name = _string_value(value.get("case"))
    if case_name == "custom":
        nested_value = value.get("value")
        if isinstance(nested_value, dict):
            custom_name = _string_value(nested_value.get("name"))
            if custom_name:
                return custom_name
    if case_name:
        return case_name

    for agent_name in AGENTS_ALL:
        if agent_name in value:
            return agent_name

    return ""


def _extract_subagent_type(tool_input: dict) -> str:
    for key in (
        "subagent_type",
        "subagentType",
        "subagent_type_name",
        "subagentTypeName",
        "agent_type",
        "agentType",
        "name",
    ):
        agent_name = _extract_subagent_name(tool_input.get(key))
        if agent_name:
            return agent_name
    return ""


def _parse_hook_input(input_data: dict) -> tuple[str, str, dict]:
    """Parse hook input across different platform formats.

    Returns (subagent_type, original_prompt, tool_input).
    Handles:
    - Claude Code / Qoder / CodeBuddy / Droid: tool_name=Task|Agent, tool_input.subagent_type
    - Cursor: tool_name=Task|Subagent, tool_input.subagent_type
    - Copilot CLI: toolName=task (camelCase key, lowercase value)
    - Gemini CLI: tool_name IS the agent name (BeforeTool matcher already filtered)
    - Kiro: agentSpawn hook, agent_name field at top level
    """
    tool_input = input_data.get("tool_input", {})

    # Standard format: Task/Agent tool with subagent_type
    tool_name = input_data.get("tool_name", "") or input_data.get("toolName", "")
    if tool_name.lower() in ("task", "agent", "subagent"):
        return (
            _extract_subagent_type(tool_input),
            tool_input.get("prompt", ""),
            tool_input,
        )

    # Kiro: agentSpawn hook passes agent_name at top level
    agent_name = input_data.get("agent_name", "")
    if agent_name:
        return agent_name, tool_input.get("prompt", input_data.get("prompt", "")), tool_input

    # Gemini CLI: BeforeTool where tool_name IS the agent name
    # (matcher already ensured it's one of our agents)
    if tool_name in AGENTS_ALL:
        return tool_name, tool_input.get("prompt", ""), tool_input

    # Copilot CLI: toolName field (camelCase), value might be the agent name
    tool_name_camel = input_data.get("toolName", "")
    if tool_name_camel in AGENTS_ALL:
        return tool_name_camel, input_data.get("toolArgs", ""), tool_input

    return "", "", tool_input


def main():
    if os.environ.get("SUNCODE_HOOKS") == "0" or os.environ.get("SUNCODE_DISABLE_HOOKS") == "1":
        sys.exit(0)

    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)
    if not isinstance(input_data, dict):
        sys.exit(0)

    if _hook_event_name(input_data) == "SubagentStart":
        try:
            _handle_codex_subagent_start(input_data)
        except Exception:
            # Native context loading must never prevent Codex from spawning a
            # requested child when runtime state is unavailable or stale.
            pass
        sys.exit(0)

    subagent_type, original_prompt, tool_input = _parse_hook_input(input_data)
    cwd = input_data.get("cwd", os.getcwd())

    # Only handle subagent types we care about
    if subagent_type not in AGENTS_ALL:
        sys.exit(0)

    # Find repo root
    repo_root = find_repo_root(cwd)
    if not repo_root:
        sys.exit(0)

    manifest_ref = _context_manifest_hint(input_data, original_prompt)
    manifest_context = get_execution_manifest_context(
        repo_root,
        input_data,
        original_prompt,
        subagent_type,
    )
    if manifest_ref and manifest_context is None:
        sys.exit(0)

    # Get current task directory only when no explicit node manifest is present.
    task_dir = (
        manifest_context[0]
        if manifest_context is not None
        else get_current_task(repo_root, input_data)
    )

    # implement/check need task directory
    if subagent_type in AGENTS_REQUIRE_TASK:
        if not task_dir:
            sys.exit(0)
        # Check if task directory exists
        task_dir_full = os.path.join(repo_root, task_dir)
        if not os.path.exists(task_dir_full):
            sys.exit(0)

    if manifest_context is not None:
        context = manifest_context[1]
        new_prompt = build_execution_prompt(original_prompt, context)
    else:
        context = ""
        new_prompt = ""

    # Check for [finish] marker in prompt (check agent with finish context)
    is_finish_phase = "[finish]" in original_prompt.lower()

    # Get context and build prompt based on subagent type
    if manifest_context is not None:
        pass
    elif subagent_type == AGENT_IMPLEMENT:
        assert task_dir is not None  # validated above
        context = get_implement_context(repo_root, task_dir)
        new_prompt = build_implement_prompt(original_prompt, context)
    elif subagent_type == AGENT_CHECK:
        assert task_dir is not None  # validated above
        if is_finish_phase:
            # Finish phase: use finish context (lighter, focused on final verification)
            context = get_finish_context(repo_root, task_dir)
            new_prompt = build_finish_prompt(original_prompt, context)
        else:
            # Regular check phase: use check context (full specs for self-fix loop)
            context = get_check_context(repo_root, task_dir)
            new_prompt = build_check_prompt(original_prompt, context)
    elif subagent_type == AGENT_RESEARCH:
        # Research can work without task directory
        context = get_research_context(repo_root, task_dir)
        new_prompt = build_research_prompt(original_prompt, context)
    else:
        sys.exit(0)

    if not context:
        sys.exit(0)

    # Return updated input — use a multi-format output that covers all platforms.
    # Most platforms ignore unrecognized fields, so we include multiple formats.
    # The platform picks whichever fields it understands.
    updated = {**tool_input, "prompt": new_prompt}
    output = {
        # Claude Code / Qoder / CodeBuddy / Droid format
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": updated,
        },
        # Cursor format
        "permission": "allow",
        "updated_input": updated,
        # Gemini format
        "updatedInput": updated,
    }

    print(json.dumps(output, ensure_ascii=False))
    sys.exit(0)


if __name__ == "__main__":
    main()
