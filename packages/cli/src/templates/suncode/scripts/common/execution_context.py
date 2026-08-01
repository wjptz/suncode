"""Deterministic, bounded context packages for execution DAG nodes.

The builder writes a small immutable directory for every dispatch attempt.  A
manifest records exactly which sources were considered, how much was retained,
and whether redaction or truncation occurred.  Adapters pass the manifest path
instead of duplicating context assembly rules in hooks, agents, or channels.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .execution_model import (
    EXECUTOR_KINDS,
    ISOLATION_KINDS,
    PLAN_VERSION,
    ExecutionNode,
    ExecutionPlan,
)
from .io import write_json


CONTEXT_VERSION = 1
MAX_DIRECTORY_FILES = 64
ALLOWED_CONTEXT_SUFFIXES = frozenset(
    (".md", ".mdx", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".py", ".ts", ".tsx", ".js", ".jsx")
)

_DENIED_PARTS = frozenset((".git", ".ssh", "node_modules"))
_DENIED_NAMES = frozenset(
    (
        ".env",
        "credentials",
        "credentials.json",
        "id_dsa",
        "id_ed25519",
        "id_rsa",
        "known_hosts",
    )
)
_SECRET_ASSIGNMENT_RE = re.compile(
    r'''(?im)(["']?\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|secret|token)\b["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)'''
)
_BEARER_RE = re.compile(r"(?i)(authorization\s*:\s*bearer\s+)[^\s]+")
_PEM_RE = re.compile(
    r"-----BEGIN [^-\r\n]+-----.*?-----END [^-\r\n]+-----",
    re.DOTALL,
)


class ContextBuildError(RuntimeError):
    """Raised when a complete, safe node context cannot be built."""


@dataclass(frozen=True)
class _SourceCandidate:
    label: str
    path: Path
    relative_path: str
    reason: str


def build_node_context(
    *,
    repo_root: Path,
    task_dir: Path,
    run_dir: Path,
    plan: ExecutionPlan,
    node: ExecutionNode,
    attempt: int,
    state: dict[str, Any],
    parent_session: str | None = None,
) -> tuple[Path, dict[str, Any]]:
    """Build and persist one node context manifest plus its rendered content."""
    context_dir = run_dir / "contexts" / node.id / str(attempt)
    context_dir.mkdir(parents=True, exist_ok=True)

    source_candidates, discovery_truncations = _discover_sources(
        repo_root=repo_root,
        task_dir=task_dir,
        include=node.context.include,
    )
    source_records: list[dict[str, Any]] = []
    truncations = list(discovery_truncations)
    rendered_sections: list[str] = [_render_contract(plan, node)]
    used_bytes = len(rendered_sections[0].encode("utf-8"))
    if used_bytes > node.context.max_bytes:
        raise ContextBuildError(
            f"node {node.id!r}: maxBytes={node.context.max_bytes} cannot hold the mandatory dispatch contract ({used_bytes} bytes)"
        )

    for order, candidate in enumerate(source_candidates, start=1):
        record, content, source_truncations = _read_source(
            candidate,
            repo_root=repo_root,
            order=order,
            per_source_bytes=node.context.per_source_bytes,
            remaining_bytes=node.context.max_bytes - used_bytes,
        )
        source_records.append(record)
        truncations.extend(source_truncations)
        if content:
            rendered = f"\n## Context source: {candidate.relative_path}\n\n{content}\n"
            rendered_bytes = len(rendered.encode("utf-8"))
            if rendered_bytes <= node.context.max_bytes - used_bytes:
                rendered_sections.append(rendered)
                used_bytes += rendered_bytes
            else:
                # _read_source reserves room by raw content bytes, while the heading is
                # part of the total context contract. Keep deterministic accounting.
                allowed = max(0, node.context.max_bytes - used_bytes)
                clipped = _truncate_utf8(rendered, allowed)
                rendered_sections.append(clipped)
                kept = len(clipped.encode("utf-8"))
                used_bytes += kept
                record["includedBytes"] = max(
                    0,
                    int(record["includedBytes"]) - (rendered_bytes - kept),
                )
                record["truncated"] = True
                truncations.append(
                    {
                        "source": candidate.relative_path,
                        "originalBytes": rendered_bytes,
                        "includedBytes": kept,
                        "reason": "total context budget",
                    }
                )

    dependency_records, dependency_sections, dependency_truncations = _dependency_context(
        run_dir=run_dir,
        node=node,
        state=state,
        remaining_bytes=node.context.max_bytes - used_bytes,
        per_source_bytes=node.context.per_source_bytes,
    )
    truncations.extend(dependency_truncations)
    for section in dependency_sections:
        rendered_sections.append(section)
        used_bytes += len(section.encode("utf-8"))

    content = "".join(rendered_sections)
    content_bytes = len(content.encode("utf-8"))
    if content_bytes > node.context.max_bytes:
        raise ContextBuildError(
            f"node {node.id!r}: context builder exceeded maxBytes ({content_bytes} > {node.context.max_bytes})"
        )

    content_path = context_dir / "content.md"
    _write_text_atomic(content_path, content)
    task_path = _relative_posix(task_dir, repo_root)
    manifest: dict[str, Any] = {
        "version": CONTEXT_VERSION,
        "task": {
            "id": plan.task,
            "path": task_path,
            "planVersion": plan.version,
            "planHash": plan.plan_hash,
        },
        "run": {
            "id": run_dir.name,
            "nodeId": node.id,
            "attempt": attempt,
            **({"parentSession": parent_session} if parent_session else {}),
        },
        "role": node.role,
        "objective": node.description,
        "execution": {
            "allowed": list(node.execution.allowed),
            "isolation": node.execution.isolation,
            "timeoutSeconds": node.execution.timeout_seconds,
            "maxAttempts": node.execution.max_attempts,
            "idempotent": node.execution.idempotent,
        },
        "boundaries": {
            "reads": list(node.reads),
            "writes": list(node.writes),
            "forbidden": [
                "Do not read credentials, secrets, or files outside the repository",
                "Do not modify paths outside declared writes",
                "Do not treat natural-language transcripts as dependency results",
            ],
            "resources": list(node.resources),
        },
        "validation": list(node.validation),
        "sources": source_records,
        "dependencies": dependency_records,
        "budget": {
            "perSourceBytes": node.context.per_source_bytes,
            "totalBytes": node.context.max_bytes,
            "usedBytes": content_bytes,
        },
        "truncations": truncations,
        "content": {
            "path": "content.md",
            "sha256": _sha256_bytes(content.encode("utf-8")),
        },
    }
    manifest["manifestHash"] = _canonical_hash(manifest)
    manifest_path = context_dir / "manifest.json"
    if not write_json(manifest_path, manifest):
        raise ContextBuildError(f"could not write context manifest: {manifest_path}")
    return manifest_path, manifest


def read_node_context_manifest(
    repo_root: Path,
    manifest_ref: str,
) -> tuple[dict[str, Any], str]:
    """Read and integrity-check a runtime manifest and its content artifact."""
    raw_path = Path(manifest_ref)
    manifest_path = raw_path if raw_path.is_absolute() else repo_root / raw_path
    manifest_path = _safe_source_path(repo_root, manifest_path)
    runtime_root = (repo_root / ".suncode" / ".runtime" / "execution").resolve()
    try:
        manifest_path.relative_to(runtime_root)
    except ValueError as exc:
        raise ContextBuildError(
            f"context manifest is outside the execution runtime: {manifest_ref}"
        ) from exc
    if manifest_path.name != "manifest.json":
        raise ContextBuildError("context manifest path must end with manifest.json")
    try:
        parsed = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContextBuildError(f"could not read context manifest: {manifest_ref}") from exc
    if (
        not isinstance(parsed, dict)
        or type(parsed.get("version")) is not int
        or parsed.get("version") != CONTEXT_VERSION
    ):
        raise ContextBuildError("context manifest version must equal 1")
    manifest = dict(parsed)
    manifest_hash = manifest.pop("manifestHash", None)
    if not isinstance(manifest_hash, str) or manifest_hash != _canonical_hash(manifest):
        raise ContextBuildError("context manifest hash mismatch")
    manifest["manifestHash"] = manifest_hash

    task_record = manifest.get("task")
    task_ref = task_record.get("path") if isinstance(task_record, dict) else None
    if not isinstance(task_ref, str) or not task_ref:
        raise ContextBuildError("context manifest task.path is invalid")
    task_path = _safe_source_path(repo_root, repo_root / task_ref)
    tasks_root = (repo_root / ".suncode" / "tasks").resolve()
    try:
        task_path.relative_to(tasks_root)
    except ValueError as exc:
        raise ContextBuildError("context manifest task.path is outside .suncode/tasks") from exc
    task_id = task_record.get("id") if isinstance(task_record, dict) else None
    plan_version = task_record.get("planVersion") if isinstance(task_record, dict) else None
    plan_hash = task_record.get("planHash") if isinstance(task_record, dict) else None
    if (
        not isinstance(task_id, str)
        or task_id != task_path.name
        or type(plan_version) is not int
        or plan_version != PLAN_VERSION
        or not isinstance(plan_hash, str)
        or not plan_hash
    ):
        raise ContextBuildError("context manifest task identity is invalid")

    run_record = manifest.get("run")
    run_id = run_record.get("id") if isinstance(run_record, dict) else None
    node_id = run_record.get("nodeId") if isinstance(run_record, dict) else None
    attempt = run_record.get("attempt") if isinstance(run_record, dict) else None
    if (
        not isinstance(run_id, str)
        or not run_id
        or not isinstance(node_id, str)
        or not node_id
        or type(attempt) is not int
        or attempt <= 0
    ):
        raise ContextBuildError("context manifest run identity is invalid")

    execution = manifest.get("execution")
    allowed = execution.get("allowed") if isinstance(execution, dict) else None
    isolation = execution.get("isolation") if isinstance(execution, dict) else None
    timeout_seconds = (
        execution.get("timeoutSeconds") if isinstance(execution, dict) else None
    )
    max_attempts = execution.get("maxAttempts") if isinstance(execution, dict) else None
    idempotent = execution.get("idempotent") if isinstance(execution, dict) else None
    if (
        not isinstance(allowed, list)
        or not allowed
        or any(not isinstance(item, str) or item not in EXECUTOR_KINDS for item in allowed)
        or len(set(allowed)) != len(allowed)
        or isolation not in ISOLATION_KINDS
        or type(timeout_seconds) is not int
        or timeout_seconds <= 0
        or type(max_attempts) is not int
        or max_attempts <= 0
        or type(idempotent) is not bool
    ):
        raise ContextBuildError("context manifest execution policy is invalid")

    content_record = manifest.get("content")
    if not isinstance(content_record, dict):
        raise ContextBuildError("context manifest content record is missing")
    content_ref = content_record.get("path")
    content_hash = content_record.get("sha256")
    if not isinstance(content_ref, str) or not content_ref:
        raise ContextBuildError("context manifest content.path is invalid")
    content_path = _safe_source_path(repo_root, manifest_path.parent / content_ref)
    try:
        content_path.relative_to(manifest_path.parent)
    except ValueError as exc:
        raise ContextBuildError("context manifest content path escapes its attempt directory") from exc
    try:
        content_bytes = content_path.read_bytes()
    except OSError as exc:
        raise ContextBuildError("context manifest content artifact is unavailable") from exc
    if not isinstance(content_hash, str) or content_hash != _sha256_bytes(content_bytes):
        raise ContextBuildError("context content hash mismatch")

    budget = manifest.get("budget")
    if not isinstance(budget, dict):
        raise ContextBuildError("context manifest budget record is missing")
    total_bytes = budget.get("totalBytes")
    used_bytes = budget.get("usedBytes")
    if (
        type(total_bytes) is not int
        or type(used_bytes) is not int
        or used_bytes != len(content_bytes)
        or used_bytes > total_bytes
    ):
        raise ContextBuildError("context manifest budget does not match its content artifact")
    return manifest, content_bytes.decode("utf-8")


def _render_contract(plan: ExecutionPlan, node: ExecutionNode) -> str:
    dependencies = ", ".join(node.depends_on) if node.depends_on else "none"
    reads = "\n".join(f"- {item}" for item in node.reads) or "- none"
    writes = "\n".join(f"- {item}" for item in node.writes) or "- none (read-only)"
    validation = "\n".join(f"- {item}" for item in node.validation)
    allowed_executors = ", ".join(node.execution.allowed)
    idempotent = "yes" if node.execution.idempotent else "no"
    return (
        "# Suncode execution node\n\n"
        f"Task: {plan.task}\n"
        f"Execution plan version: {plan.version}\n"
        f"Node: {node.id} ({node.role}, {node.priority})\n"
        f"Name: {node.name}\n"
        f"Objective: {node.description}\n"
        f"Direct dependencies: {dependencies}\n\n"
        "## Non-negotiable boundaries\n\n"
        "Read only repository-local inputs. Never expose credentials or secrets. "
        "Modify only declared write scopes. Preserve unrelated user changes. "
        "Return the structured NodeResult v1 object; transcript text does not unlock dependents.\n\n"
        f"Reads:\n{reads}\n\n"
        f"Writes:\n{writes}\n\n"
        "## Execution policy\n\n"
        f"Allowed executors: {allowed_executors}\n"
        f"Isolation: {node.execution.isolation}\n"
        f"Timeout: {node.execution.timeout_seconds} seconds\n"
        f"Maximum attempts: {node.execution.max_attempts}\n"
        f"Idempotent: {idempotent}\n\n"
        f"Validation:\n{validation}\n"
    )


def _discover_sources(
    *,
    repo_root: Path,
    task_dir: Path,
    include: tuple[str, ...],
) -> tuple[list[_SourceCandidate], list[dict[str, Any]]]:
    result: list[_SourceCandidate] = []
    truncations: list[dict[str, Any]] = []
    seen: set[str] = set()
    reserved = {
        "prd": task_dir / "prd.md",
        "design": task_dir / "design.md",
        "implement": task_dir / "implement.md",
        "implement-jsonl": task_dir / "implement.jsonl",
        "check-jsonl": task_dir / "check.jsonl",
    }

    for item in include:
        path = reserved.get(item)
        reason = f"declared context include: {item}"
        if path is None:
            path = _safe_repo_path(repo_root, item)
        _add_source(result, seen, repo_root, path, item, reason)
        if item in ("implement-jsonl", "check-jsonl") and path.is_file():
            for entry_path, entry_reason, entry_type in _read_jsonl_entries(path):
                resolved = _safe_repo_path(repo_root, entry_path)
                if entry_type == "directory" or resolved.is_dir():
                    files = _expand_directory(resolved)
                    if len(files) >= MAX_DIRECTORY_FILES:
                        truncations.append(
                            {
                                "source": _relative_posix(resolved, repo_root),
                                "originalBytes": 0,
                                "includedBytes": 0,
                                "reason": f"directory expansion limited to {MAX_DIRECTORY_FILES} files",
                            }
                        )
                    for child in files:
                        _add_source(
                            result,
                            seen,
                            repo_root,
                            child,
                            child.name,
                            entry_reason,
                        )
                else:
                    _add_source(
                        result,
                        seen,
                        repo_root,
                        resolved,
                        Path(entry_path).name,
                        entry_reason,
                    )
    return result, truncations


def _add_source(
    result: list[_SourceCandidate],
    seen: set[str],
    repo_root: Path,
    path: Path,
    label: str,
    reason: str,
) -> None:
    safe_path = _safe_source_path(repo_root, path)
    relative = _relative_posix(safe_path, repo_root)
    if relative in seen:
        return
    seen.add(relative)
    result.append(
        _SourceCandidate(
            label=label,
            path=safe_path,
            relative_path=relative,
            reason=reason,
        )
    )


def _read_jsonl_entries(path: Path) -> list[tuple[str, str, str]]:
    entries: list[tuple[str, str, str]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return entries
    for line in lines:
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(value, dict) or not isinstance(value.get("file"), str):
            continue
        file_path = str(value["file"]).strip()
        if not file_path:
            continue
        reason_value = value.get("reason")
        reason = reason_value if isinstance(reason_value, str) else "JSONL context entry"
        entry_type = value.get("type") if value.get("type") in ("file", "directory") else "file"
        entries.append((file_path, reason, str(entry_type)))
    return entries


def _expand_directory(path: Path) -> list[Path]:
    if not path.is_dir() or _is_sensitive_path(path):
        return []
    files = [
        child
        for child in sorted(path.rglob("*"), key=lambda value: value.as_posix())
        if child.is_file()
        and child.suffix.lower() in ALLOWED_CONTEXT_SUFFIXES
        and not _is_sensitive_path(child)
    ]
    return files[:MAX_DIRECTORY_FILES]


def _read_source(
    candidate: _SourceCandidate,
    *,
    repo_root: Path,
    order: int,
    per_source_bytes: int,
    remaining_bytes: int,
) -> tuple[dict[str, Any], str, list[dict[str, Any]]]:
    record: dict[str, Any] = {
        "label": candidate.label,
        "path": candidate.relative_path,
        "reason": candidate.reason,
        "order": order,
        "sha256": None,
        "originalBytes": 0,
        "includedBytes": 0,
        "truncated": False,
        "missing": False,
        "redacted": False,
    }
    truncations: list[dict[str, Any]] = []
    safe_path = _safe_source_path(repo_root, candidate.path)
    if _is_sensitive_path(safe_path):
        record["redacted"] = True
        truncations.append(
            {
                "source": candidate.relative_path,
                "originalBytes": 0,
                "includedBytes": 0,
                "reason": "sensitive path denied",
            }
        )
        return record, "", truncations
    try:
        raw = safe_path.read_bytes()
    except OSError:
        record["missing"] = True
        return record, "", truncations

    record["sha256"] = _sha256_bytes(raw)
    record["originalBytes"] = len(raw)
    text = raw.decode("utf-8", errors="replace")
    redacted, changed = _redact_secrets(text)
    record["redacted"] = changed
    limit = max(0, min(per_source_bytes, remaining_bytes))
    retained = _truncate_utf8(redacted, limit)
    included_bytes = len(retained.encode("utf-8"))
    record["includedBytes"] = included_bytes
    record["truncated"] = included_bytes < len(redacted.encode("utf-8"))
    if record["truncated"]:
        reason = "per-source budget" if per_source_bytes <= remaining_bytes else "total context budget"
        truncations.append(
            {
                "source": candidate.relative_path,
                "originalBytes": len(raw),
                "includedBytes": included_bytes,
                "reason": reason,
            }
        )
    return record, retained, truncations


def _dependency_context(
    *,
    run_dir: Path,
    node: ExecutionNode,
    state: dict[str, Any],
    remaining_bytes: int,
    per_source_bytes: int,
) -> tuple[list[dict[str, Any]], list[str], list[dict[str, Any]]]:
    if node.context.dependency_results == "none":
        return [], [], []
    records: list[dict[str, Any]] = []
    sections: list[str] = []
    truncations: list[dict[str, Any]] = []
    budget = remaining_bytes
    node_states = state.get("nodes") if isinstance(state.get("nodes"), dict) else {}
    for dependency in node.depends_on:
        dependency_state = node_states.get(dependency) if isinstance(node_states, dict) else None
        dependency_status = (
            dependency_state.get("status") if isinstance(dependency_state, dict) else None
        )
        if dependency_status != "succeeded":
            raise ContextBuildError(
                f"node {node.id!r}: dependency {dependency!r} is not succeeded (status: {dependency_status!r})"
            )
        attempt = dependency_state.get("attempt") if isinstance(dependency_state, dict) else None
        if not isinstance(attempt, int) or attempt <= 0:
            raise ContextBuildError(
                f"node {node.id!r}: dependency {dependency!r} has no completed result attempt"
            )
        result_path = run_dir / "results" / dependency / f"{attempt}.json"
        try:
            raw = result_path.read_bytes()
            parsed = json.loads(raw)
        except (OSError, json.JSONDecodeError) as exc:
            raise ContextBuildError(
                f"node {node.id!r}: dependency result is unavailable: {result_path}"
            ) from exc
        sanitized, structurally_redacted = _redact_json_value(parsed)
        serialized = json.dumps(sanitized, indent=2, ensure_ascii=False, sort_keys=True)
        serialized, text_redacted = _redact_secrets(serialized)
        prefix = f"\n## Direct dependency result: {dependency}\n\n```json\n"
        suffix = "\n```\n"
        source_limit = max(0, min(per_source_bytes, budget))
        wrapper_bytes = len((prefix + suffix).encode("utf-8"))
        payload_limit = max(0, source_limit - wrapper_bytes)
        retained = _truncate_utf8(serialized, payload_limit)
        section = f"{prefix}{retained}{suffix}" if source_limit >= wrapper_bytes else ""
        used = len(section.encode("utf-8"))
        truncated = len(retained.encode("utf-8")) < len(serialized.encode("utf-8"))
        records.append(
            {
                "nodeId": dependency,
                "attempt": attempt,
                "path": _relative_posix(result_path, run_dir),
                "sha256": _sha256_bytes(raw),
                "status": parsed.get("status") if isinstance(parsed, dict) else None,
                "includedBytes": used,
                "truncated": truncated,
                "redacted": structurally_redacted or text_redacted,
            }
        )
        sections.append(section)
        budget -= used
        if truncated:
            truncations.append(
                {
                    "source": f"dependency:{dependency}",
                    "originalBytes": len(serialized.encode("utf-8")),
                    "includedBytes": used,
                    "reason": "dependency result context budget",
                }
            )
    return records, sections, truncations


def _safe_repo_path(repo_root: Path, relative: str) -> Path:
    candidate = (repo_root / relative).resolve()
    try:
        candidate.relative_to(repo_root.resolve())
    except ValueError as exc:
        raise ContextBuildError(f"context path escapes repository: {relative}") from exc
    return candidate


def _safe_source_path(repo_root: Path, path: Path) -> Path:
    """Resolve symlinks and reject every context source outside the repository."""
    candidate = path.resolve()
    try:
        candidate.relative_to(repo_root.resolve())
    except ValueError as exc:
        raise ContextBuildError(f"context source escapes repository: {path}") from exc
    return candidate


def _relative_posix(path: Path, base: Path) -> str:
    try:
        return path.resolve().relative_to(base.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def _is_sensitive_path(path: Path) -> bool:
    lowered_parts = tuple(part.lower() for part in path.parts)
    name = path.name.lower()
    return (
        any(part in _DENIED_PARTS for part in lowered_parts)
        or name in _DENIED_NAMES
        or name.startswith(".env.")
        or name.endswith((".pem", ".key", ".p12", ".pfx"))
    )


def _redact_secrets(value: str) -> tuple[str, bool]:
    redacted = _PEM_RE.sub("[REDACTED PRIVATE KEY]", value)
    redacted = _BEARER_RE.sub(r"\1[REDACTED]", redacted)
    redacted = _SECRET_ASSIGNMENT_RE.sub(r"\1[REDACTED]", redacted)
    return redacted, redacted != value


def _redact_json_value(value: object, key: str = "") -> tuple[object, bool]:
    """Recursively redact secret-bearing structured result fields."""
    sensitive_key = bool(
        re.search(
            r"(?i)(?:api.?key|authorization|credential|password|secret|token)",
            key,
        )
    )
    if sensitive_key and value is not None:
        return "[REDACTED]", True
    if isinstance(value, dict):
        result: dict[str, object] = {}
        changed = False
        for child_key, child_value in value.items():
            key_text = str(child_key)
            redacted, child_changed = _redact_json_value(child_value, key_text)
            result[key_text] = redacted
            changed = changed or child_changed
        return result, changed
    if isinstance(value, list):
        result_items: list[object] = []
        changed = False
        for item in value:
            redacted, child_changed = _redact_json_value(item)
            result_items.append(redacted)
            changed = changed or child_changed
        return result_items, changed
    return value, False


def _truncate_utf8(value: str, limit: int) -> str:
    if limit <= 0:
        return ""
    raw = value.encode("utf-8")
    if len(raw) <= limit:
        return value
    return raw[:limit].decode("utf-8", errors="ignore")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _canonical_hash(value: dict[str, Any]) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return _sha256_bytes(payload.encode("utf-8"))


def _write_text_atomic(path: Path, value: str) -> None:
    try:
        fd, temporary = tempfile.mkstemp(
            dir=str(path.parent),
            prefix=f".{path.name}.",
            suffix=".tmp",
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(value)
            os.replace(temporary, path)
        except BaseException:
            try:
                os.unlink(temporary)
            except OSError:
                pass
            raise
    except OSError as exc:
        raise ContextBuildError(f"could not write context content: {path}: {exc}") from exc
