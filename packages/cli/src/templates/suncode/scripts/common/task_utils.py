#!/usr/bin/env python3
"""
Task utility functions.

Provides:
    is_safe_task_path   - Validate task path is safe to operate on
    find_task_by_name   - Find task directory by name
    resolve_task_dir    - Resolve task directory from name, relative, or absolute path
    archive_task_dir    - Archive task to monthly directory
    run_task_hooks      - Run lifecycle hooks for task events
"""

from __future__ import annotations

import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

from .paths import get_repo_root, get_tasks_dir


# =============================================================================
# Path Safety
# =============================================================================

def is_safe_task_path(task_path: str, repo_root: Path | None = None) -> bool:
    """Check if a relative task path is safe to operate on.

    Args:
        task_path: Task path (relative to repo_root).
        repo_root: Repository root path. Defaults to auto-detected.

    Returns:
        True if safe, False if dangerous.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    normalized = task_path.replace("\\", "/")

    # Check empty or null
    if not normalized or normalized == "null":
        print("Error: empty or null task path", file=sys.stderr)
        return False

    # Reject absolute paths
    if Path(task_path).is_absolute():
        print(f"Error: absolute path not allowed: {task_path}", file=sys.stderr)
        return False

    # Reject ".", "..", paths starting with "./" or "../", or containing ".."
    if normalized in (".", "..") or normalized.startswith("./") or normalized.startswith("../") or ".." in normalized:
        print(f"Error: path traversal not allowed: {task_path}", file=sys.stderr)
        return False

    # Final check: ensure resolved path is not the repo root
    abs_path = repo_root / Path(normalized)
    if abs_path.exists():
        try:
            resolved = abs_path.resolve()
            root_resolved = repo_root.resolve()
            if resolved == root_resolved:
                print(f"Error: path resolves to repo root: {task_path}", file=sys.stderr)
                return False
        except (OSError, IOError):
            pass

    return True


# =============================================================================
# Task Lookup
# =============================================================================

def find_task_by_name(task_name: str, tasks_dir: Path) -> Path | None:
    """Find task directory by name (exact or suffix match).

    Args:
        task_name: Task name to find.
        tasks_dir: Tasks directory path.

    Returns:
        Absolute path to task directory, or None if not found.
    """
    if not task_name or not tasks_dir or not tasks_dir.is_dir():
        return None

    # Try exact match first
    exact_match = tasks_dir / task_name
    if exact_match.is_dir():
        return exact_match

    # Try suffix match (e.g., "my-task" matches "01-21-my-task")
    for d in tasks_dir.iterdir():
        if d.is_dir() and d.name.endswith(f"-{task_name}"):
            return d

    return None


# =============================================================================
# Archive Operations
# =============================================================================

def archive_task_dir(task_dir_abs: Path, repo_root: Path | None = None) -> Path | None:
    """Archive a task directory to archive/{YYYY-MM}/.

    Args:
        task_dir_abs: Absolute path to task directory.
        repo_root: Repository root path. Defaults to auto-detected.

    Returns:
        Path to archived directory, or None on error.
    """
    if not task_dir_abs.is_dir():
        print(f"Error: task directory not found: {task_dir_abs}", file=sys.stderr)
        return None

    # Get tasks directory (parent of the task)
    tasks_dir = task_dir_abs.parent
    archive_dir = tasks_dir / "archive"
    year_month = datetime.now().strftime("%Y-%m")
    month_dir = archive_dir / year_month

    # Create archive directory
    try:
        month_dir.mkdir(parents=True, exist_ok=True)
    except (OSError, IOError) as e:
        print(f"Error: Failed to create archive directory: {e}", file=sys.stderr)
        return None

    # Move task to archive
    task_name = task_dir_abs.name
    dest = month_dir / task_name

    try:
        shutil.move(str(task_dir_abs), str(dest))
    except (OSError, IOError, shutil.Error) as e:
        print(f"Error: Failed to move task to archive: {e}", file=sys.stderr)
        return None

    return dest


def archive_task_complete(
    task_dir_abs: Path,
    repo_root: Path | None = None
) -> dict[str, str]:
    """Complete archive workflow: archive directory.

    Args:
        task_dir_abs: Absolute path to task directory.
        repo_root: Repository root path. Defaults to auto-detected.

    Returns:
        Dict with archive result info.
    """
    if not task_dir_abs.is_dir():
        print(f"Error: task directory not found: {task_dir_abs}", file=sys.stderr)
        return {}

    archive_dest = archive_task_dir(task_dir_abs, repo_root)
    if archive_dest:
        return {"archived_to": str(archive_dest)}

    return {}


# =============================================================================
# Task Directory Resolution
# =============================================================================

def resolve_task_dir(target_dir: str, repo_root: Path) -> Path:
    """Resolve task directory to absolute path.

    Supports:
    - Absolute path: /path/to/task
    - Relative path: .suncode/tasks/01-31-my-task
    - Task name: my-task (uses find_task_by_name for lookup)

    Args:
        target_dir: Task directory specification.
        repo_root: Repository root path.

    Returns:
        Resolved absolute path.
    """
    if not target_dir:
        return Path()

    normalized = target_dir.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]

    # Absolute path
    if Path(target_dir).is_absolute():
        return Path(target_dir)

    # Relative path (contains path separator or starts with .suncode)
    if "/" in normalized or normalized.startswith(".suncode"):
        return repo_root / Path(normalized)

    # Task name - try to find in tasks directory
    tasks_dir = get_tasks_dir(repo_root)
    found = find_task_by_name(target_dir, tasks_dir)
    if found:
        return found

    # Fallback to treating as relative path
    return repo_root / Path(normalized)


# =============================================================================
# Lifecycle Hooks
# =============================================================================

def _is_hub_preflight_command(command: str) -> bool:
    return command.strip().startswith("suncode hub preflight-start ")


def _is_hub_bound_task(task_json_path: Path) -> bool:
    try:
        task = json.loads(task_json_path.read_text(encoding="utf-8"))
    except (OSError, IOError, json.JSONDecodeError):
        return False

    meta = task.get("meta")
    if not isinstance(meta, dict):
        return False
    hub = meta.get("hub")
    if not isinstance(hub, dict):
        return False

    remote_task_id = str(hub.get("remoteTaskId") or "").strip()
    if not remote_task_id:
        return False

    binding_status = str(hub.get("bindingStatus") or "bound").strip().lower()
    return binding_status not in ("pending", "failed", "unbound", "local-only", "local_only")


def _should_skip_hook_command(event: str, command: str, task_json_path: Path) -> bool:
    if event == "before_start" and _is_hub_preflight_command(command):
        return not _is_hub_bound_task(task_json_path)
    return False


def _is_hub_sync_command(command: str) -> bool:
    return command.strip().startswith("suncode hub ")


def _record_hub_sync_failure(
    repo_root: Path,
    event: str,
    task_json_path: Path,
    command: str,
    error: str,
) -> None:
    try:
        runtime_dir = repo_root / ".suncode" / ".runtime"
        runtime_dir.mkdir(parents=True, exist_ok=True)
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        entry = {
            "taskJsonPath": str(task_json_path),
            "event": event,
            "command": command,
            "error": error.strip() or "hook failed",
            "attempt": 1,
            "firstFailedAt": now,
            "lastFailedAt": now,
            "nextRetryAt": now,
        }
        queue_path = runtime_dir / "hub-sync-queue.jsonl"
        with queue_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


def run_task_hooks(
    event: str,
    task_json_path: Path,
    repo_root: Path,
    *,
    stop_on_failure: bool = False,
) -> bool:
    """Run lifecycle hooks for a task event.

    Args:
        event: Event name (e.g. "after_create").
        task_json_path: Absolute path to the task's task.json.
        repo_root: Repository root for cwd and config lookup.
        stop_on_failure: Return False on the first hook failure.

    Returns:
        True if all non-skipped hooks succeeded, False if a blocking hook failed.
    """
    import os
    import subprocess

    from .config import get_hooks
    from .log import Colors, colored

    commands = get_hooks(event, repo_root)
    if not commands:
        return True

    env = {**os.environ, "TASK_JSON_PATH": str(task_json_path)}

    for cmd in commands:
        if _should_skip_hook_command(event, cmd, task_json_path):
            continue
        try:
            result = subprocess.run(
                cmd,
                shell=True,
                cwd=repo_root,
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            if result.returncode != 0:
                level = "[ERROR]" if stop_on_failure else "[WARN]"
                print(
                    colored(f"{level} Hook failed ({event}): {cmd}", Colors.YELLOW),
                    file=sys.stderr,
                )
                if result.stderr.strip():
                    print(f"  {result.stderr.strip()}", file=sys.stderr)
                if stop_on_failure:
                    return False
                if _is_hub_sync_command(cmd):
                    _record_hub_sync_failure(
                        repo_root,
                        event,
                        task_json_path,
                        cmd,
                        result.stderr.strip() or result.stdout.strip(),
                    )
        except Exception as e:
            level = "[ERROR]" if stop_on_failure else "[WARN]"
            print(
                colored(f"{level} Hook error ({event}): {cmd} — {e}", Colors.YELLOW),
                file=sys.stderr,
            )
            if stop_on_failure:
                return False
            if _is_hub_sync_command(cmd):
                _record_hub_sync_failure(
                    repo_root,
                    event,
                    task_json_path,
                    cmd,
                    str(e),
                )

    return True


# =============================================================================
# Main Entry (for testing)
# =============================================================================

if __name__ == "__main__":
    repo = get_repo_root()
    tasks = get_tasks_dir(repo)

    print(f"Tasks dir: {tasks}")
    print(f"is_safe_task_path('.suncode/tasks/test'): {is_safe_task_path('.suncode/tasks/test', repo)}")
    print(f"is_safe_task_path('../test'): {is_safe_task_path('../test', repo)}")
