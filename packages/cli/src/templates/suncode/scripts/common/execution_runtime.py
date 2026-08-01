"""Persistent scheduler state for Suncode execution DAGs.

This module is intentionally executor-neutral.  It computes safe fan-out sets,
persists transitions, and emits manifest references.  Native subagents,
channels, and inline agents remain adapters around the same state machine.
"""

from __future__ import annotations

import json
import os
import re
import secrets
from fnmatch import fnmatchcase
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .execution_context import ContextBuildError, build_node_context
from .execution_model import (
    EXECUTOR_KINDS,
    ISOLATION_KINDS,
    NODE_ROLES,
    ExecutionNode,
    ExecutionPlan,
    ExecutionPlanError,
    load_execution_plan,
    normalize_execution_scope,
    topological_nodes,
)
from .io import read_json, write_json
from .paths import DIR_WORKFLOW


RUNTIME_VERSION = 1
RESULT_VERSION = 1
RESULT_STATUSES = frozenset(("succeeded", "failed", "blocked", "cancelled"))
VALIDATION_STATUSES = frozenset(("passed", "failed", "skipped"))
ACTIVE_NODE_STATUSES = frozenset(("dispatched", "running"))
TERMINAL_NODE_STATUSES = frozenset(
    ("succeeded", "failed", "blocked", "cancelled", "orphaned")
)
RETRYABLE_NODE_STATUSES = frozenset(("failed", "cancelled", "orphaned"))

_RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_RESULT_FIELDS = frozenset(
    (
        "version",
        "taskId",
        "runId",
        "nodeId",
        "attempt",
        "status",
        "summary",
        "changes",
        "findings",
        "validation",
        "artifacts",
        "risks",
    )
)
_PRIORITY_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
_GLOBAL_WRITE_NAMES = frozenset(
    (
        "cargo.lock",
        "composer.lock",
        "gradle.lockfile",
        "package-lock.json",
        "pipfile.lock",
        "pnpm-lock.yaml",
        "poetry.lock",
        "uv.lock",
        "yarn.lock",
        "bun.lock",
        "bun.lockb",
        "migration-registry.json",
    )
)


class ExecutionRuntimeError(RuntimeError):
    """Raised when a runtime transition or executor request is invalid."""


@dataclass(frozen=True)
class ExecutorCapabilities:
    """Platform-independent executor capability declaration."""

    kind: str
    max_concurrency: int
    roles: tuple[str, ...]
    supports_wait_any: bool
    supports_cancellation: bool
    supports_clean_context: bool
    isolation: str
    result_protocol_version: int = RESULT_VERSION

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "maxConcurrency": self.max_concurrency,
            "roles": list(self.roles),
            "supportsWaitAny": self.supports_wait_any,
            "supportsCancellation": self.supports_cancellation,
            "supportsCleanContext": self.supports_clean_context,
            "isolation": self.isolation,
            "resultProtocolVersion": self.result_protocol_version,
        }


def make_capabilities(
    *,
    kind: str,
    max_concurrency: int,
    roles: tuple[str, ...] = tuple(sorted(NODE_ROLES)),
    supports_wait_any: bool = True,
    supports_cancellation: bool = False,
    supports_clean_context: bool = True,
    isolation: str = "shared-worktree",
) -> ExecutorCapabilities:
    """Validate CLI capability input and apply inline invariants."""
    if kind not in EXECUTOR_KINDS:
        raise ExecutionRuntimeError(f"executor kind must be one of {sorted(EXECUTOR_KINDS)}")
    if type(max_concurrency) is not int or max_concurrency <= 0:
        raise ExecutionRuntimeError("max concurrency must be a positive integer")
    unknown_roles = sorted(set(roles) - NODE_ROLES)
    if unknown_roles:
        raise ExecutionRuntimeError(f"unknown executor role(s): {', '.join(unknown_roles)}")
    if not roles:
        raise ExecutionRuntimeError("executor must support at least one role")
    if isolation not in ISOLATION_KINDS:
        raise ExecutionRuntimeError(f"isolation must be one of {sorted(ISOLATION_KINDS)}")
    if kind == "inline":
        max_concurrency = 1
        supports_wait_any = False
    return ExecutorCapabilities(
        kind=kind,
        max_concurrency=max_concurrency,
        roles=roles,
        supports_wait_any=supports_wait_any,
        supports_cancellation=supports_cancellation,
        supports_clean_context=supports_clean_context,
        isolation=isolation,
    )


def start_execution_run(
    *,
    repo_root: Path,
    task_dir: Path,
    capabilities: ExecutorCapabilities,
    run_id: str | None = None,
    parent_session: str | None = None,
) -> tuple[Path, dict[str, Any]]:
    """Freeze a plan hash and create a new recoverable scheduler run."""
    _validate_task_location(repo_root, task_dir)
    task_data = read_json(task_dir / "task.json")
    task_status = task_data.get("status") if isinstance(task_data, dict) else None
    if task_status != "in_progress":
        raise ExecutionRuntimeError(
            "execution runs require task.json.status == 'in_progress'; "
            "start the task through task.py start before execution start-run"
        )
    plan = load_execution_plan(task_dir, allow_legacy=True)
    _validate_capabilities(plan, capabilities)
    actual_run_id = run_id or _new_run_id()
    if not _RUN_ID_RE.fullmatch(actual_run_id):
        raise ExecutionRuntimeError(
            "run id must contain only letters, numbers, dot, underscore, and dash"
        )
    runtime_root = _task_runtime_root(repo_root, task_dir)
    run_dir = runtime_root / actual_run_id
    try:
        run_dir.mkdir(parents=True, exist_ok=False)
        (run_dir / "contexts").mkdir()
        (run_dir / "results").mkdir()
        (run_dir / "artifacts").mkdir()
    except FileExistsError as exc:
        raise ExecutionRuntimeError(f"execution run already exists: {actual_run_id}") from exc
    except OSError as exc:
        raise ExecutionRuntimeError(f"could not create execution runtime: {exc}") from exc

    now = _utc_now()
    warnings: list[str] = []
    if not capabilities.supports_clean_context:
        warnings.append(
            "Executor cannot guarantee clean context; adapters must use the generated minimal manifest and disclose this degradation."
        )
    if not capabilities.supports_wait_any and capabilities.max_concurrency > 1:
        warnings.append(
            "Executor lacks wait-any; adapter must simulate wait-any without serializing dispatch."
        )
    state: dict[str, Any] = {
        "version": RUNTIME_VERSION,
        "taskId": plan.task,
        "taskPath": _relative_posix(task_dir, repo_root),
        "runId": actual_run_id,
        "planHash": plan.plan_hash,
        "planSource": plan.source,
        "status": "planned",
        "executor": capabilities.to_dict(),
        "parentSession": parent_session,
        "createdAt": now,
        "updatedAt": now,
        "warnings": warnings,
        "nodes": {
            node.id: {
                "status": "pending",
                "attempt": 0,
                "maxAttempts": node.execution.max_attempts,
                "blockedBy": [],
                "contextManifest": None,
                "result": None,
                "executorRef": None,
                "updatedAt": now,
            }
            for node in plan.nodes
        },
    }
    _refresh_state(plan, state)
    _write_state(run_dir, state)
    _append_event(
        run_dir,
        "run.started",
        {
            "planHash": plan.plan_hash,
            "executor": capabilities.to_dict(),
            "warnings": warnings,
        },
    )
    if not write_json(runtime_root / "latest.json", {"runId": actual_run_id}):
        raise ExecutionRuntimeError("could not update latest execution run pointer")
    return run_dir, state


def get_execution_status(
    *,
    repo_root: Path,
    task_dir: Path,
    run_id: str | None = None,
) -> tuple[Path, dict[str, Any]]:
    """Load status without mutating scheduler state."""
    return _load_run(repo_root=repo_root, task_dir=task_dir, run_id=run_id)


def get_ready_nodes(
    *,
    repo_root: Path,
    task_dir: Path,
    run_id: str | None = None,
) -> tuple[Path, dict[str, Any], list[ExecutionNode]]:
    """Return the maximal safe fan-out set before an adapter waits."""
    run_dir, state = _load_run(repo_root=repo_root, task_dir=task_dir, run_id=run_id)
    with _runtime_lock(run_dir):
        plan = _load_matching_plan(task_dir, state)
        state = _read_state(run_dir)
        _refresh_state(plan, state)
        selected = _select_ready(plan, state)
        _write_state(run_dir, state)
    return run_dir, state, selected


def claim_execution_node(
    *,
    repo_root: Path,
    task_dir: Path,
    node_id: str,
    run_id: str | None = None,
    executor_ref: str | None = None,
) -> tuple[Path, dict[str, Any], dict[str, Any]]:
    """Atomically claim a ready node and build its immutable context package."""
    run_dir, state = _load_run(repo_root=repo_root, task_dir=task_dir, run_id=run_id)
    with _runtime_lock(run_dir):
        plan = _load_matching_plan(task_dir, state)
        state = _read_state(run_dir)
        _refresh_state(plan, state)
        node = plan.node_map.get(node_id)
        if node is None:
            raise ExecutionRuntimeError(f"unknown execution node: {node_id}")
        selected = _select_ready(plan, state)
        if node_id not in {candidate.id for candidate in selected}:
            node_state = _node_state(state, node_id)
            raise ExecutionRuntimeError(
                f"node {node_id!r} is not claimable (status: {node_state['status']}); run 'execution ready' to inspect the safe fan-out set"
            )
        node_state = _node_state(state, node_id)
        attempt = int(node_state["attempt"]) + 1
        try:
            manifest_path, manifest = build_node_context(
                repo_root=repo_root,
                task_dir=task_dir,
                run_dir=run_dir,
                plan=plan,
                node=node,
                attempt=attempt,
                state=state,
                parent_session=_optional_string(state.get("parentSession")),
            )
        except ContextBuildError as exc:
            raise ExecutionRuntimeError(str(exc)) from exc

        now = _utc_now()
        node_state.update(
            {
                "status": "dispatched",
                "attempt": attempt,
                "blockedBy": [],
                "contextManifest": _relative_posix(manifest_path, run_dir),
                "result": None,
                "executorRef": executor_ref,
                "dispatchedAt": now,
                "updatedAt": now,
            }
        )
        _refresh_state(plan, state)
        _write_state(run_dir, state)
        _append_event(
            run_dir,
            "node.dispatched",
            {
                "nodeId": node.id,
                "attempt": attempt,
                "contextManifest": node_state["contextManifest"],
                "manifestHash": manifest["manifestHash"],
                "executorRef": executor_ref,
            },
        )
        dispatch = _dispatch_envelope(
            repo_root,
            plan,
            state,
            node,
            attempt,
            manifest_path,
            manifest,
        )
    return run_dir, state, dispatch


def mark_execution_node_running(
    *,
    repo_root: Path,
    task_dir: Path,
    node_id: str,
    run_id: str | None = None,
    executor_ref: str | None = None,
) -> tuple[Path, dict[str, Any]]:
    """Mark a dispatched node as acknowledged by its executor."""
    run_dir, state = _load_run(repo_root=repo_root, task_dir=task_dir, run_id=run_id)
    with _runtime_lock(run_dir):
        plan = _load_matching_plan(task_dir, state)
        state = _read_state(run_dir)
        node_state = _node_state(state, node_id)
        if node_state["status"] != "dispatched":
            raise ExecutionRuntimeError(
                f"node {node_id!r} must be dispatched before running (status: {node_state['status']})"
            )
        now = _utc_now()
        node_state["status"] = "running"
        node_state["runningAt"] = now
        node_state["updatedAt"] = now
        if executor_ref:
            node_state["executorRef"] = executor_ref
        _refresh_state(plan, state)
        _write_state(run_dir, state)
        _append_event(
            run_dir,
            "node.running",
            {
                "nodeId": node_id,
                "attempt": node_state["attempt"],
                "executorRef": node_state.get("executorRef"),
            },
        )
    return run_dir, state


def complete_execution_node(
    *,
    repo_root: Path,
    task_dir: Path,
    node_id: str,
    result_value: object,
    run_id: str | None = None,
) -> tuple[Path, dict[str, Any], dict[str, Any]]:
    """Validate and record NodeResult v1, then unlock successors."""
    run_dir, state = _load_run(repo_root=repo_root, task_dir=task_dir, run_id=run_id)
    with _runtime_lock(run_dir):
        plan = _load_matching_plan(task_dir, state)
        state = _read_state(run_dir)
        node_state = _node_state(state, node_id)
        if node_state["status"] not in ACTIVE_NODE_STATUSES:
            raise ExecutionRuntimeError(
                f"node {node_id!r} is not active (status: {node_state['status']})"
            )
        result = validate_node_result(
            result_value,
            plan=plan,
            state=state,
            node_id=node_id,
            attempt=int(node_state["attempt"]),
        )
        _persist_result(run_dir, result)
        _apply_result(plan, state, node_id, result)
        _refresh_state(plan, state)
        _write_state(run_dir, state)
        _append_event(
            run_dir,
            "node.completed",
            {
                "nodeId": node_id,
                "attempt": result["attempt"],
                "status": result["status"],
                "result": _node_state(state, node_id)["result"],
            },
        )
    return run_dir, state, result


def cancel_execution_node(
    *,
    repo_root: Path,
    task_dir: Path,
    node_id: str,
    run_id: str | None = None,
    reason: str = "cancelled by coordinator",
) -> tuple[Path, dict[str, Any]]:
    """Cancel a non-terminal node when executor capabilities permit it."""
    run_dir, state = _load_run(repo_root=repo_root, task_dir=task_dir, run_id=run_id)
    with _runtime_lock(run_dir):
        plan = _load_matching_plan(task_dir, state)
        state = _read_state(run_dir)
        node_state = _node_state(state, node_id)
        if node_state["status"] in TERMINAL_NODE_STATUSES:
            raise ExecutionRuntimeError(
                f"node {node_id!r} is already terminal (status: {node_state['status']})"
            )
        executor = state.get("executor")
        if node_state["status"] in ACTIVE_NODE_STATUSES and not (
            isinstance(executor, dict) and executor.get("supportsCancellation") is True
        ):
            raise ExecutionRuntimeError("executor does not support cancellation of active nodes")
        node_state["status"] = "cancelled"
        node_state["cancelReason"] = reason
        node_state["updatedAt"] = _utc_now()
        _refresh_state(plan, state)
        _write_state(run_dir, state)
        _append_event(
            run_dir,
            "node.cancelled",
            {"nodeId": node_id, "attempt": node_state["attempt"], "reason": reason},
        )
    return run_dir, state


def recover_execution_run(
    *,
    repo_root: Path,
    task_dir: Path,
    run_id: str | None = None,
    retry_nodes: tuple[str, ...] = (),
    force_orphan_nodes: tuple[str, ...] = (),
) -> tuple[Path, dict[str, Any], list[str]]:
    """Reconcile results without guessing whether active executors are dead."""
    run_dir, state = _load_run(repo_root=repo_root, task_dir=task_dir, run_id=run_id)
    actions: list[str] = []
    with _runtime_lock(run_dir):
        plan = _load_matching_plan(task_dir, state)
        state = _read_state(run_dir)
        duplicate_force = sorted(
            node_id
            for node_id in set(force_orphan_nodes)
            if force_orphan_nodes.count(node_id) > 1
        )
        if duplicate_force:
            raise ExecutionRuntimeError(
                "duplicate --force-orphan node(s): " + ", ".join(duplicate_force)
            )
        overlapping_requests = sorted(set(retry_nodes) & set(force_orphan_nodes))
        if overlapping_requests:
            raise ExecutionRuntimeError(
                "a node cannot be both --force-orphan and --retry in one recovery: "
                + ", ".join(overlapping_requests)
            )
        unknown_force = sorted(set(force_orphan_nodes) - set(plan.node_map))
        if unknown_force:
            raise ExecutionRuntimeError(
                "unknown execution node(s) for --force-orphan: "
                + ", ".join(unknown_force)
            )
        handled_force: set[str] = set()
        for node in plan.nodes:
            node_state = _node_state(state, node.id)
            if node_state["status"] not in ACTIVE_NODE_STATUSES:
                continue
            attempt = int(node_state["attempt"])
            result_path = run_dir / "results" / node.id / f"{attempt}.json"
            persisted = read_json(result_path)
            if persisted is not None:
                result = validate_node_result(
                    persisted,
                    plan=plan,
                    state=state,
                    node_id=node.id,
                    attempt=attempt,
                )
                _apply_result(plan, state, node.id, result)
                actions.append(f"reconciled result for {node.id} attempt {attempt}")
                if node.id in force_orphan_nodes:
                    handled_force.add(node.id)
                continue
            if node.id not in force_orphan_nodes:
                actions.append(
                    f"left {node.id} attempt {attempt} active; executor liveness is unconfirmed"
                )
                continue
            handled_force.add(node.id)
            node_state["status"] = "orphaned"
            node_state["orphanedAt"] = _utc_now()
            node_state["updatedAt"] = node_state["orphanedAt"]
            actions.append(f"marked {node.id} attempt {attempt} orphaned")
            if node.execution.idempotent and attempt < node.execution.max_attempts:
                node_state["status"] = "retrying"
                actions.append(f"scheduled idempotent retry for {node.id}")

        unavailable_force = sorted(set(force_orphan_nodes) - handled_force)
        if unavailable_force:
            details = ", ".join(
                f"{node_id}={_node_state(state, node_id)['status']}"
                for node_id in unavailable_force
            )
            raise ExecutionRuntimeError(
                "--force-orphan requires an active dispatched/running node; found " + details
            )

        for node_id in retry_nodes:
            node = plan.node_map.get(node_id)
            if node is None:
                raise ExecutionRuntimeError(f"unknown execution node: {node_id}")
            node_state = _node_state(state, node_id)
            if node_state["status"] not in RETRYABLE_NODE_STATUSES:
                raise ExecutionRuntimeError(
                    f"node {node_id!r} cannot be retried from status {node_state['status']!r}"
                )
            if int(node_state["attempt"]) >= node.execution.max_attempts:
                raise ExecutionRuntimeError(
                    f"node {node_id!r} exhausted maxAttempts={node.execution.max_attempts}"
                )
            node_state["status"] = "retrying"
            node_state["result"] = None
            node_state["updatedAt"] = _utc_now()
            actions.append(f"explicitly scheduled retry for {node_id}")

        _refresh_state(plan, state)
        _write_state(run_dir, state)
        _append_event(run_dir, "run.recovered", {"actions": actions})
    return run_dir, state, actions


def validate_node_result(
    value: object,
    *,
    plan: ExecutionPlan,
    state: dict[str, Any],
    node_id: str,
    attempt: int,
) -> dict[str, Any]:
    """Strictly validate the transport-neutral NodeResult v1 contract."""
    if not isinstance(value, dict):
        raise ExecutionRuntimeError("node result must be a JSON object")
    unknown = sorted(set(value) - _RESULT_FIELDS)
    if unknown:
        raise ExecutionRuntimeError(f"node result has unknown field(s): {', '.join(unknown)}")
    integer_identity = {
        "version": RESULT_VERSION,
        "attempt": attempt,
    }
    for field, expected in integer_identity.items():
        actual = value.get(field)
        if type(actual) is not int or actual != expected:
            raise ExecutionRuntimeError(
                f"node result {field} must equal {expected!r}, got {actual!r}"
            )
    string_identity = {
        "taskId": plan.task,
        "runId": state.get("runId"),
        "nodeId": node_id,
    }
    for field, expected in string_identity.items():
        actual = value.get(field)
        if not isinstance(expected, str) or not isinstance(actual, str) or actual != expected:
            raise ExecutionRuntimeError(
                f"node result {field} must equal {expected!r}, got {actual!r}"
            )
    status = value.get("status")
    if not isinstance(status, str) or status not in RESULT_STATUSES:
        raise ExecutionRuntimeError(f"node result status must be one of {sorted(RESULT_STATUSES)}")
    summary = value.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        raise ExecutionRuntimeError("node result summary must be a non-empty string")
    changes = _object_list(
        value.get("changes"),
        "changes",
        required=("path", "kind"),
    )
    findings = _object_list(
        value.get("findings"),
        "findings",
        required=("severity", "message"),
        optional=("location",),
    )
    validation = _object_list(
        value.get("validation"),
        "validation",
        required=("command", "status"),
        optional=("evidence",),
    )
    artifacts = _object_list(
        value.get("artifacts"),
        "artifacts",
        required=("name", "path"),
        optional=("hash",),
    )
    risks_value = value.get("risks")
    if not isinstance(risks_value, list) or any(not isinstance(item, str) for item in risks_value):
        raise ExecutionRuntimeError("node result risks must be an array of strings")
    node = plan.node_map[node_id]
    normalized_changes = _validate_result_changes(changes, node)
    normalized_validation = _validate_result_validation(validation, node, status)
    normalized_artifacts = _validate_result_artifacts(artifacts)
    return {
        "version": RESULT_VERSION,
        "taskId": plan.task,
        "runId": state["runId"],
        "nodeId": node_id,
        "attempt": attempt,
        "status": status,
        "summary": summary.strip(),
        "changes": normalized_changes,
        "findings": findings,
        "validation": normalized_validation,
        "artifacts": normalized_artifacts,
        "risks": list(risks_value),
    }


def _validate_result_changes(
    changes: list[dict[str, Any]],
    node: ExecutionNode,
) -> list[dict[str, Any]]:
    normalized_changes: list[dict[str, Any]] = []
    for index, change in enumerate(changes):
        normalized_path = _normalize_result_path(
            str(change["path"]),
            f"node result changes[{index}].path",
        )
        if not any(_scope_matches_path(scope, normalized_path) for scope in node.writes):
            raise ExecutionRuntimeError(
                f"node result changes[{index}].path {normalized_path!r} "
                f"is outside node {node.id!r} writes"
            )
        normalized_change = dict(change)
        normalized_change["path"] = normalized_path
        normalized_changes.append(normalized_change)
    return normalized_changes


def _validate_result_validation(
    validation: list[dict[str, Any]],
    node: ExecutionNode,
    result_status: object,
) -> list[dict[str, Any]]:
    reported_commands: list[str] = []
    normalized_validation: list[dict[str, Any]] = []
    for index, item in enumerate(validation):
        command = str(item["command"]).strip()
        validation_status = str(item["status"]).strip()
        if validation_status not in VALIDATION_STATUSES:
            raise ExecutionRuntimeError(
                f"node result validation[{index}].status must be one of "
                f"{sorted(VALIDATION_STATUSES)}"
            )
        if command in reported_commands:
            raise ExecutionRuntimeError(
                f"node result validation[{index}].command duplicates {command!r}"
            )
        reported_commands.append(command)
        normalized_item = dict(item)
        normalized_item["command"] = command
        normalized_item["status"] = validation_status
        normalized_validation.append(normalized_item)

    if result_status != "succeeded":
        return normalized_validation
    if not normalized_validation:
        raise ExecutionRuntimeError(
            "succeeded node result validation must contain declared validation evidence"
        )
    missing = [command for command in node.validation if command not in reported_commands]
    extra = [command for command in reported_commands if command not in node.validation]
    if missing or extra:
        details: list[str] = []
        if missing:
            details.append("missing: " + ", ".join(missing))
        if extra:
            details.append("undeclared: " + ", ".join(extra))
        raise ExecutionRuntimeError(
            "succeeded node result validation must exactly cover node.validation; "
            + "; ".join(details)
        )
    for index, item in enumerate(normalized_validation):
        if item["status"] != "passed":
            raise ExecutionRuntimeError(
                f"succeeded node result validation[{index}].status must be 'passed'"
            )
        evidence = item.get("evidence")
        if not isinstance(evidence, str) or not evidence.strip():
            raise ExecutionRuntimeError(
                f"succeeded node result validation[{index}].evidence must be a non-empty string"
            )
        item["evidence"] = evidence.strip()
    return normalized_validation


def _validate_result_artifacts(
    artifacts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    normalized_artifacts: list[dict[str, Any]] = []
    for index, artifact in enumerate(artifacts):
        normalized_path = _normalize_result_path(
            str(artifact["path"]),
            f"node result artifacts[{index}].path",
        )
        if not normalized_path.startswith("artifacts/"):
            raise ExecutionRuntimeError(
                f"node result artifacts[{index}].path must be inside the current run artifacts/ namespace"
            )
        normalized_artifact = dict(artifact)
        normalized_artifact["path"] = normalized_path
        normalized_artifacts.append(normalized_artifact)
    return normalized_artifacts


def _normalize_result_path(value: str, path: str) -> str:
    try:
        normalized = normalize_execution_scope(value, path, allow_glob=False)
    except ExecutionPlanError as exc:
        raise ExecutionRuntimeError(str(exc)) from exc
    if normalized == ".":
        raise ExecutionRuntimeError(f"{path}: must identify a concrete file path")
    return normalized


def _validate_capabilities(plan: ExecutionPlan, capabilities: ExecutorCapabilities) -> None:
    if type(capabilities.max_concurrency) is not int or capabilities.max_concurrency <= 0:
        raise ExecutionRuntimeError(
            "executor max concurrency must be a positive integer"
        )
    if (
        type(capabilities.result_protocol_version) is not int
        or capabilities.result_protocol_version != RESULT_VERSION
    ):
        raise ExecutionRuntimeError(
            f"executor result protocol must equal {RESULT_VERSION}"
        )
    failures: list[str] = []
    for node in plan.nodes:
        if capabilities.kind not in node.execution.allowed:
            failures.append(f"{node.id}: executor {capabilities.kind!r} is not allowed")
        if node.role not in capabilities.roles:
            failures.append(f"{node.id}: role {node.role!r} is unsupported")
        if node.execution.isolation != capabilities.isolation:
            failures.append(
                f"{node.id}: requires isolation {node.execution.isolation!r}, executor provides {capabilities.isolation!r}"
            )
    if failures:
        raise ExecutionRuntimeError("executor cannot run this plan: " + "; ".join(failures))


def _select_ready(plan: ExecutionPlan, state: dict[str, Any]) -> list[ExecutionNode]:
    executor = state.get("executor")
    if not isinstance(executor, dict):
        raise ExecutionRuntimeError("runtime state has no executor capabilities")
    max_concurrency = executor.get("maxConcurrency")
    if type(max_concurrency) is not int or max_concurrency <= 0:
        raise ExecutionRuntimeError("runtime executor maxConcurrency is invalid")
    active_ids = [
        node.id
        for node in plan.nodes
        if _node_state(state, node.id)["status"] in ACTIVE_NODE_STATUSES
    ]
    capacity = max(0, max_concurrency - len(active_ids))
    if capacity == 0:
        return []
    critical_paths = _critical_path_lengths(plan)
    order_index = {node.id: index for index, node in enumerate(plan.nodes)}
    candidates = sorted(
        (
            node
            for node in plan.nodes
            if _node_state(state, node.id)["status"] == "ready"
        ),
        key=lambda node: (
            _PRIORITY_ORDER[node.priority],
            -critical_paths[node.id],
            order_index[node.id],
            node.id,
        ),
    )
    active_nodes = [plan.node_map[node_id] for node_id in active_ids]
    selected: list[ExecutionNode] = []
    for node in candidates:
        if any(_nodes_conflict(node, other) for other in (*active_nodes, *selected)):
            continue
        selected.append(node)
        if len(selected) >= capacity:
            break
    return selected


def _nodes_conflict(left: ExecutionNode, right: ExecutionNode) -> bool:
    if set(left.resources) & set(right.resources):
        return True
    if left.execution.isolation != "shared-worktree" or right.execution.isolation != "shared-worktree":
        return False
    if (_requires_global_write_lock(left) and right.writes) or (
        _requires_global_write_lock(right) and left.writes
    ):
        return True
    return (
        _scope_sets_overlap(left.writes, right.writes)
        or _scope_sets_overlap(left.writes, right.reads)
        or _scope_sets_overlap(right.writes, left.reads)
    )


def _scope_sets_overlap(left: tuple[str, ...], right: tuple[str, ...]) -> bool:
    return any(_scopes_may_overlap(one, two) for one in left for two in right)


def _scopes_may_overlap(left: str, right: str) -> bool:
    left_parts = _literal_prefix(left)
    right_parts = _literal_prefix(right)
    if not left_parts or not right_parts:
        return True
    for left_part, right_part in zip(left_parts, right_parts):
        if left_part != right_part:
            return False
    # One literal prefix contains the other, so overlap cannot be disproven.
    return True


def _literal_prefix(scope: str) -> tuple[str, ...]:
    if scope == ".":
        return ()
    result: list[str] = []
    for part in scope.split("/"):
        if not part:
            continue
        if any(character in part for character in "*?["):
            break
        result.append(part.casefold())
    return tuple(result)


def _scope_matches_path(scope: str, path: str) -> bool:
    if scope == ".":
        return True
    patterns = scope.split("/")
    parts = path.split("/")
    # Conflict checks case-fold separately; result containment preserves the
    # exact logical path case and uses iteration so deep paths cannot overflow.
    reachable = [False] * (len(patterns) + 1)
    reachable[0] = True
    for pattern_index, pattern in enumerate(patterns):
        if pattern == "**" and reachable[pattern_index]:
            reachable[pattern_index + 1] = True

    for part in parts:
        next_reachable = [False] * (len(patterns) + 1)
        for pattern_index, pattern in enumerate(patterns):
            if not reachable[pattern_index]:
                continue
            if pattern == "**":
                next_reachable[pattern_index] = True
            elif fnmatchcase(part, pattern):
                next_reachable[pattern_index + 1] = True
        for pattern_index, pattern in enumerate(patterns):
            if pattern == "**" and next_reachable[pattern_index]:
                next_reachable[pattern_index + 1] = True
        reachable = next_reachable

    return reachable[-1]


def _requires_global_write_lock(node: ExecutionNode) -> bool:
    for scope in node.writes:
        lowered = scope.lower()
        name = lowered.rsplit("/", 1)[-1]
        if name in _GLOBAL_WRITE_NAMES or "migration" in lowered or "version" in lowered:
            return True
    return False


def _critical_path_lengths(plan: ExecutionPlan) -> dict[str, int]:
    followers: dict[str, list[str]] = {node.id: [] for node in plan.nodes}
    for node in plan.nodes:
        for dependency in node.depends_on:
            followers[dependency].append(node.id)
    lengths: dict[str, int] = {}
    for node in reversed(topological_nodes(plan)):
        lengths[node.id] = 1 + max((lengths[item] for item in followers[node.id]), default=0)
    return lengths


def _refresh_state(plan: ExecutionPlan, state: dict[str, Any]) -> None:
    now = _utc_now()
    for node in topological_nodes(plan):
        node_state = _node_state(state, node.id)
        is_derived_block = (
            node_state["status"] == "blocked" and node_state.get("result") is None
        )
        if (
            node_state["status"] not in ("pending", "ready", "retrying")
            and not is_derived_block
        ):
            continue
        dependency_states = {
            dependency: _node_state(state, dependency)["status"]
            for dependency in node.depends_on
        }
        blockers = [
            dependency
            for dependency, status in dependency_states.items()
            if status in ("failed", "blocked", "cancelled", "orphaned")
        ]
        if blockers:
            node_state["status"] = "blocked"
            node_state["blockedBy"] = blockers
            node_state["updatedAt"] = now
        elif all(status == "succeeded" for status in dependency_states.values()):
            node_state["status"] = "ready"
            node_state["blockedBy"] = []
            node_state["updatedAt"] = now
        else:
            node_state["status"] = "pending"
            node_state["blockedBy"] = []
            node_state["updatedAt"] = now

    final_statuses = [_node_state(state, node_id)["status"] for node_id in plan.final_barrier]
    all_statuses = [_node_state(state, node.id)["status"] for node in plan.nodes]
    if all(status == "succeeded" for status in final_statuses):
        task_status = "succeeded"
    elif any(status == "failed" for status in final_statuses):
        task_status = "failed"
    elif any(status in ("blocked", "orphaned", "cancelled") for status in final_statuses):
        task_status = "blocked"
    elif any(status in ACTIVE_NODE_STATUSES for status in all_statuses):
        task_status = "running"
    elif any(status == "ready" for status in final_statuses):
        task_status = "integrating"
    elif any(status == "ready" for status in all_statuses):
        task_status = "planned"
    elif any(status in ("failed", "blocked", "orphaned", "cancelled") for status in all_statuses):
        task_status = "blocked"
    else:
        task_status = "planned"
    state["status"] = task_status
    state["updatedAt"] = now


def _apply_result(
    plan: ExecutionPlan,
    state: dict[str, Any],
    node_id: str,
    result: dict[str, Any],
) -> None:
    node = plan.node_map[node_id]
    node_state = _node_state(state, node_id)
    result_status = str(result["status"])
    node_state["status"] = result_status
    node_state["result"] = f"results/{node_id}/{result['attempt']}.json"
    node_state["completedAt"] = _utc_now()
    node_state["updatedAt"] = node_state["completedAt"]
    if (
        result_status == "failed"
        and node.execution.idempotent
        and int(node_state["attempt"]) < node.execution.max_attempts
    ):
        node_state["status"] = "retrying"


def _persist_result(run_dir: Path, result: dict[str, Any]) -> None:
    result_path = run_dir / "results" / str(result["nodeId"]) / f"{result['attempt']}.json"
    try:
        result_path.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise ExecutionRuntimeError(f"could not create result directory: {exc}") from exc
    if result_path.exists():
        raise ExecutionRuntimeError(f"node result already exists: {result_path}")
    if not write_json(result_path, result):
        raise ExecutionRuntimeError(f"could not persist node result: {result_path}")


def _dispatch_envelope(
    repo_root: Path,
    plan: ExecutionPlan,
    state: dict[str, Any],
    node: ExecutionNode,
    attempt: int,
    manifest_path: Path,
    manifest: dict[str, Any],
) -> dict[str, Any]:
    executor = state["executor"]
    result_path = f"results/{node.id}/{attempt}.json"
    manifest_ref = _relative_posix(manifest_path, repo_root)
    content_ref = _relative_posix(manifest_path.parent / "content.md", repo_root)
    return {
        "version": 1,
        "taskId": plan.task,
        "runId": state["runId"],
        "nodeId": node.id,
        "name": node.name,
        "role": node.role,
        "attempt": attempt,
        "executor": executor["kind"],
        "contextProfile": node.context.profile,
        "isolation": node.execution.isolation,
        "manifestPath": str(manifest_path),
        "manifestRef": manifest_ref,
        "manifestHash": manifest["manifestHash"],
        "contentPath": str(manifest_path.parent / "content.md"),
        "contentRef": content_ref,
        "resultPath": result_path,
        "timeoutSeconds": node.execution.timeout_seconds,
        "forkTurns": "none" if executor["kind"] == "native-subagent" else None,
        "channelArgs": (
            [
                "--context-file",
                str(manifest_path),
                "--context-file",
                str(manifest_path.parent / "content.md"),
            ]
            if executor["kind"] == "channel"
            else None
        ),
        "prompt": (
            f"Active task: {state['taskPath']}\n"
            f"Suncode context manifest: {manifest_ref}\n"
            f"Suncode execution: run={state['runId']} node={node.id} attempt={attempt}\n\n"
            "Read and verify the immutable manifest and its content artifact before doing any work. "
            f"Return NodeResult v1 for task {plan.task!r}, run {state['runId']!r}, "
            f"node {node.id!r}, attempt {attempt}."
        ),
    }


def _load_matching_plan(task_dir: Path, state: dict[str, Any]) -> ExecutionPlan:
    try:
        plan = load_execution_plan(task_dir, allow_legacy=True)
    except ExecutionPlanError as exc:
        raise ExecutionRuntimeError(str(exc)) from exc
    if plan.plan_hash != state.get("planHash"):
        raise ExecutionRuntimeError(
            "execution plan changed after the run started; automatic resume is disabled. Start a new run or explicitly migrate the runtime."
        )
    return plan


def _load_run(
    *,
    repo_root: Path,
    task_dir: Path,
    run_id: str | None,
) -> tuple[Path, dict[str, Any]]:
    _validate_task_location(repo_root, task_dir)
    runtime_root = _task_runtime_root(repo_root, task_dir)
    actual_run_id = run_id
    if actual_run_id is None:
        latest = read_json(runtime_root / "latest.json")
        actual_run_id = latest.get("runId") if isinstance(latest, dict) else None
    if not isinstance(actual_run_id, str) or not actual_run_id:
        raise ExecutionRuntimeError("no execution run found; start one first")
    if not _RUN_ID_RE.fullmatch(actual_run_id):
        raise ExecutionRuntimeError("runtime run id is invalid")
    run_dir = runtime_root / actual_run_id
    state = _read_state(run_dir)
    _validate_runtime_identity(
        repo_root=repo_root,
        task_dir=task_dir,
        run_id=actual_run_id,
        state=state,
    )
    return run_dir, state


def _read_state(run_dir: Path) -> dict[str, Any]:
    state = read_json(run_dir / "state.json")
    if not isinstance(state, dict):
        raise ExecutionRuntimeError(f"runtime state not found or invalid: {run_dir / 'state.json'}")
    version = state.get("version")
    if type(version) is not int or version != RUNTIME_VERSION:
        raise ExecutionRuntimeError(f"unsupported runtime state version: {version!r}")
    return state


def _validate_runtime_identity(
    *,
    repo_root: Path,
    task_dir: Path,
    run_id: str,
    state: dict[str, Any],
) -> None:
    expected_task_id = task_dir.name
    expected_task_path = _relative_posix(task_dir, repo_root)
    if state.get("taskId") != expected_task_id:
        raise ExecutionRuntimeError(
            f"runtime state taskId does not match task directory {expected_task_id!r}"
        )
    if state.get("taskPath") != expected_task_path:
        raise ExecutionRuntimeError(
            f"runtime state taskPath does not match task directory {expected_task_path!r}"
        )
    if state.get("runId") != run_id:
        raise ExecutionRuntimeError(
            f"runtime state runId does not match runtime directory {run_id!r}"
        )
    executor = state.get("executor")
    max_concurrency = executor.get("maxConcurrency") if isinstance(executor, dict) else None
    if type(max_concurrency) is not int or max_concurrency <= 0:
        raise ExecutionRuntimeError("runtime executor maxConcurrency is invalid")


def _write_state(run_dir: Path, state: dict[str, Any]) -> None:
    if not write_json(run_dir / "state.json", state):
        raise ExecutionRuntimeError(f"could not write runtime state: {run_dir / 'state.json'}")


def _node_state(state: dict[str, Any], node_id: str) -> dict[str, Any]:
    nodes = state.get("nodes")
    if not isinstance(nodes, dict) or not isinstance(nodes.get(node_id), dict):
        raise ExecutionRuntimeError(f"runtime state is missing node {node_id!r}")
    return nodes[node_id]


def _task_runtime_root(repo_root: Path, task_dir: Path) -> Path:
    return repo_root / DIR_WORKFLOW / ".runtime" / "execution" / task_dir.name


def _validate_task_location(repo_root: Path, task_dir: Path) -> None:
    try:
        task_dir.resolve().relative_to(repo_root.resolve())
    except ValueError as exc:
        raise ExecutionRuntimeError(
            f"task directory must be inside the repository: {task_dir}"
        ) from exc


@contextmanager
def _runtime_lock(run_dir: Path) -> Iterator[None]:
    lock_path = run_dir / ".state.lock"
    descriptor = _acquire_runtime_lock(lock_path)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(json.dumps({"pid": os.getpid(), "createdAt": _utc_now()}))
        yield
    finally:
        try:
            lock_path.unlink()
        except OSError:
            pass


def _acquire_runtime_lock(lock_path: Path) -> int:
    """Acquire an exclusive lock, reclaiming only a proven-dead owner."""
    for attempt in range(2):
        try:
            return os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError as exc:
            owner = read_json(lock_path)
            owner_pid = owner.get("pid") if isinstance(owner, dict) else None
            if attempt == 0 and isinstance(owner_pid, int) and not _process_is_alive(owner_pid):
                try:
                    lock_path.unlink()
                except OSError as unlink_error:
                    raise ExecutionRuntimeError(
                        f"could not reclaim stale execution lock: {lock_path}: {unlink_error}"
                    ) from unlink_error
                continue
            owner_text = f" (owner pid: {owner_pid})" if isinstance(owner_pid, int) else ""
            raise ExecutionRuntimeError(
                f"execution runtime is busy or has an unverifiable stale lock: {lock_path}{owner_text}"
            ) from exc
    raise ExecutionRuntimeError(f"could not acquire execution runtime lock: {lock_path}")


def _process_is_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        # Cross-platform implementations may not expose ProcessLookupError.
        return False
    return True


def _append_event(run_dir: Path, event_type: str, payload: dict[str, Any]) -> None:
    event = {
        "version": 1,
        "time": _utc_now(),
        "type": event_type,
        **payload,
    }
    try:
        with (run_dir / "events.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
    except OSError as exc:
        raise ExecutionRuntimeError(f"could not append runtime event: {exc}") from exc


def _object_list(
    value: object,
    field: str,
    *,
    required: tuple[str, ...],
    optional: tuple[str, ...] = (),
) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise ExecutionRuntimeError(f"node result {field} must be an array")
    result: list[dict[str, Any]] = []
    allowed_fields = set(required) | set(optional)
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise ExecutionRuntimeError(f"node result {field}[{index}] must be an object")
        unknown = sorted(set(item) - allowed_fields)
        if unknown:
            raise ExecutionRuntimeError(
                f"node result {field}[{index}] has unknown field(s): {', '.join(unknown)}"
            )
        for required_field in required:
            required_value = item.get(required_field)
            if not isinstance(required_value, str) or not required_value.strip():
                raise ExecutionRuntimeError(
                    f"node result {field}[{index}].{required_field} must be a non-empty string"
                )
        for optional_field in optional:
            if optional_field in item and not isinstance(item[optional_field], str):
                raise ExecutionRuntimeError(
                    f"node result {field}[{index}].{optional_field} must be a string"
                )
        result.append(dict(item))
    return result


def _new_run_id() -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{timestamp}-{secrets.token_hex(4)}"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _relative_posix(path: Path, base: Path) -> str:
    try:
        return path.resolve().relative_to(base.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def _optional_string(value: object) -> str | None:
    return value if isinstance(value, str) and value else None
