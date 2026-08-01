"""Execution DAG plan model, validation, and legacy normalization.

The stable plan lives in ``execution.json`` inside a task directory. Runtime
state is deliberately owned by ``execution_runtime.py`` so executing a plan
never rewrites the reviewed plan artifact.
"""

from __future__ import annotations

import hashlib
import json
import posixpath
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, NoReturn, cast


PLAN_FILE = "execution.json"
PLAN_VERSION = 1

NODE_ROLES = frozenset(("implement", "check", "fix", "integration", "research"))
PRIORITIES = frozenset(("P0", "P1", "P2", "P3"))
EXECUTOR_KINDS = frozenset(("inline", "native-subagent", "channel"))
ISOLATION_KINDS = frozenset(("shared-worktree", "worktree", "sandbox"))
CONTEXT_PROFILES = frozenset(("implement", "check", "research", "integration"))
DEPENDENCY_RESULT_MODES = frozenset(("none", "direct"))

DEFAULT_TIMEOUT_SECONDS = 1800
DEFAULT_MAX_ATTEMPTS = 2
DEFAULT_CONTEXT_PROFILE = "implement"
DEFAULT_CONTEXT_MAX_BYTES = 262_144
DEFAULT_CONTEXT_PER_SOURCE_BYTES = 65_536

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
_RESOURCE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]*$")
_CHECKLIST_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s+(.+?)\s*$")
_PRIORITY_RE = re.compile(r"^\[?(P[0-3])\]?(?:\s*[:：-])?\s+", re.IGNORECASE)

_TOP_LEVEL_FIELDS = frozenset(("version", "task", "defaults", "nodes", "barriers", "metadata"))
_DEFAULT_FIELDS = frozenset(("timeoutSeconds", "maxAttempts", "contextProfile"))
_NODE_FIELDS = frozenset(
    (
        "id",
        "name",
        "description",
        "priority",
        "role",
        "dependsOn",
        "reads",
        "writes",
        "resources",
        "context",
        "validation",
        "execution",
        "metadata",
    )
)
_CONTEXT_FIELDS = frozenset(
    ("profile", "include", "dependencyResults", "maxBytes", "perSourceBytes")
)
_EXECUTION_FIELDS = frozenset(
    ("isolation", "allowed", "timeoutSeconds", "maxAttempts", "idempotent")
)
_BARRIER_FIELDS = frozenset(("final",))


class ExecutionPlanError(ValueError):
    """Raised when an explicit execution plan violates the v1 contract."""


@dataclass(frozen=True)
class NodeContextConfig:
    """Deterministic context inputs and budgets for one node."""

    profile: str
    include: tuple[str, ...]
    dependency_results: str
    max_bytes: int
    per_source_bytes: int


@dataclass(frozen=True)
class NodeExecutionConfig:
    """Executor constraints for one node."""

    isolation: str
    allowed: tuple[str, ...]
    timeout_seconds: int
    max_attempts: int
    idempotent: bool


@dataclass(frozen=True)
class ExecutionNode:
    """One independently dispatchable execution unit."""

    id: str
    name: str
    description: str
    priority: str
    role: str
    depends_on: tuple[str, ...]
    reads: tuple[str, ...]
    writes: tuple[str, ...]
    resources: tuple[str, ...]
    context: NodeContextConfig
    validation: tuple[str, ...]
    execution: NodeExecutionConfig
    metadata: dict[str, Any]


@dataclass(frozen=True)
class ExecutionPlan:
    """Validated execution plan plus its source kind."""

    version: int
    task: str
    nodes: tuple[ExecutionNode, ...]
    final_barrier: tuple[str, ...]
    defaults: dict[str, Any]
    metadata: dict[str, Any]
    source: str

    @property
    def node_map(self) -> dict[str, ExecutionNode]:
        """Return nodes keyed by stable id."""
        return {node.id: node for node in self.nodes}

    @property
    def plan_hash(self) -> str:
        """Return a cross-platform canonical SHA-256 for the normalized plan."""
        payload = json.dumps(
            execution_plan_to_dict(self),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _fail(path: str, message: str) -> NoReturn:
    raise ExecutionPlanError(f"{path}: {message}")


def _record(value: object, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(path, "must be an object")
    return cast(dict[str, Any], value)


def _strict_fields(value: dict[str, Any], allowed: frozenset[str], path: str) -> None:
    unknown = sorted(set(value) - allowed)
    if unknown:
        _fail(path, f"unknown field(s): {', '.join(unknown)}")


def _required_string(value: object, path: str) -> str:
    if not isinstance(value, str):
        _fail(path, "must be a non-empty string")
    stripped = value.strip()
    if not stripped:
        _fail(path, "must be a non-empty string")
    return stripped


def _positive_int(value: object, path: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        _fail(path, "must be a positive integer")
    if value <= 0:
        _fail(path, "must be a positive integer")
    return value


def _string_list(
    value: object,
    path: str,
    *,
    allow_empty: bool = True,
) -> tuple[str, ...]:
    if not isinstance(value, list):
        _fail(path, "must be an array of strings")
    values = cast(list[object], value)
    result: list[str] = []
    for index, item in enumerate(values):
        text = _required_string(item, f"{path}[{index}]")
        if text in result:
            _fail(f"{path}[{index}]", f"duplicate value {text!r}")
        result.append(text)
    if not allow_empty and not result:
        _fail(path, "must contain at least one item")
    return tuple(result)


def normalize_execution_scope(
    value: str,
    path: str,
    *,
    allow_glob: bool = True,
) -> str:
    """Return one canonical repository-relative POSIX logical scope."""
    candidate = value.replace("\\", "/").strip()
    if not candidate:
        _fail(path, "must not be empty")
    if "\x00" in candidate:
        _fail(path, "must not contain NUL bytes")
    if candidate.startswith("/") or re.match(r"^[A-Za-z]:", candidate):
        _fail(path, "must be repository-relative")
    raw_parts = candidate.split("/")
    if ".." in raw_parts:
        _fail(path, "must not escape the repository")
    normalized = posixpath.normpath(candidate)
    if normalized == ".." or normalized.startswith("../"):
        _fail(path, "must not escape the repository")
    if any(character in normalized for character in "{}"):
        _fail(path, "contains unsupported glob syntax")
    for segment in (() if normalized == "." else normalized.split("/")):
        if "**" in segment and segment != "**":
            _fail(path, "recursive glob '**' must occupy a complete path segment")
        if segment.count("[") != segment.count("]"):
            _fail(path, "contains an unterminated character class")
    if not allow_glob and any(character in normalized for character in "*?["):
        _fail(path, "must be a concrete path without glob syntax")
    return normalized


def _normalize_scope(value: str, path: str) -> str:
    return normalize_execution_scope(value, path)


def _scope_list(value: object, path: str) -> tuple[str, ...]:
    raw = _string_list(value, path)
    result: list[str] = []
    normalized_keys: set[str] = set()
    for index, item in enumerate(raw):
        normalized = _normalize_scope(item, f"{path}[{index}]")
        normalized_key = normalized.casefold()
        if normalized_key in normalized_keys:
            _fail(f"{path}[{index}]", f"duplicate normalized scope {normalized!r}")
        result.append(normalized)
        normalized_keys.add(normalized_key)
    return tuple(result)


def _metadata(value: object, path: str) -> dict[str, Any]:
    if value is None:
        return {}
    return dict(_record(value, path))


def _parse_context(
    value: object,
    path: str,
    *,
    role: str,
    default_profile: str,
) -> NodeContextConfig:
    data = _record(value, path)
    _strict_fields(data, _CONTEXT_FIELDS, path)
    profile = _required_string(data.get("profile", default_profile), f"{path}.profile")
    if profile not in CONTEXT_PROFILES:
        _fail(f"{path}.profile", f"must be one of {sorted(CONTEXT_PROFILES)}")

    default_include = ["prd", "design", "implement", f"{profile}-jsonl"]
    if profile == "research":
        default_include = ["prd", "design", "implement"]
    include = _string_list(data.get("include", default_include), f"{path}.include")
    for index, item in enumerate(include):
        if item in ("prd", "design", "implement", "implement-jsonl", "check-jsonl"):
            continue
        _normalize_scope(item, f"{path}.include[{index}]")

    dependency_results = _required_string(
        data.get("dependencyResults", "direct"),
        f"{path}.dependencyResults",
    )
    if dependency_results not in DEPENDENCY_RESULT_MODES:
        _fail(
            f"{path}.dependencyResults",
            f"must be one of {sorted(DEPENDENCY_RESULT_MODES)}",
        )

    max_bytes = _positive_int(
        data.get("maxBytes", DEFAULT_CONTEXT_MAX_BYTES),
        f"{path}.maxBytes",
    )
    per_source_bytes = _positive_int(
        data.get("perSourceBytes", DEFAULT_CONTEXT_PER_SOURCE_BYTES),
        f"{path}.perSourceBytes",
    )
    if per_source_bytes > max_bytes:
        _fail(f"{path}.perSourceBytes", "must not exceed maxBytes")
    if role == "check" and profile == "implement":
        _fail(f"{path}.profile", "check nodes must not use the implement profile")

    return NodeContextConfig(
        profile=profile,
        include=include,
        dependency_results=dependency_results,
        max_bytes=max_bytes,
        per_source_bytes=per_source_bytes,
    )


def _parse_execution(
    value: object,
    path: str,
    *,
    default_timeout: int,
    default_attempts: int,
) -> NodeExecutionConfig:
    data = _record(value, path)
    _strict_fields(data, _EXECUTION_FIELDS, path)
    isolation = _required_string(data.get("isolation"), f"{path}.isolation")
    if isolation not in ISOLATION_KINDS:
        _fail(f"{path}.isolation", f"must be one of {sorted(ISOLATION_KINDS)}")
    allowed = _string_list(data.get("allowed"), f"{path}.allowed", allow_empty=False)
    for index, executor in enumerate(allowed):
        if executor not in EXECUTOR_KINDS:
            _fail(
                f"{path}.allowed[{index}]",
                f"must be one of {sorted(EXECUTOR_KINDS)}",
            )
    timeout_seconds = _positive_int(
        data.get("timeoutSeconds", default_timeout),
        f"{path}.timeoutSeconds",
    )
    max_attempts = _positive_int(
        data.get("maxAttempts", default_attempts),
        f"{path}.maxAttempts",
    )
    idempotent = data.get("idempotent", False)
    if not isinstance(idempotent, bool):
        _fail(f"{path}.idempotent", "must be a boolean")
    return NodeExecutionConfig(
        isolation=isolation,
        allowed=allowed,
        timeout_seconds=timeout_seconds,
        max_attempts=max_attempts,
        idempotent=idempotent,
    )


def _parse_node(
    value: object,
    index: int,
    *,
    default_timeout: int,
    default_attempts: int,
    default_profile: str,
) -> ExecutionNode:
    path = f"execution.json.nodes[{index}]"
    data = _record(value, path)
    _strict_fields(data, _NODE_FIELDS, path)

    node_id = _required_string(data.get("id"), f"{path}.id")
    if not _ID_RE.fullmatch(node_id):
        _fail(f"{path}.id", "must match ^[a-z0-9][a-z0-9._-]*$")
    priority = _required_string(data.get("priority"), f"{path}.priority").upper()
    if priority not in PRIORITIES:
        _fail(f"{path}.priority", f"must be one of {sorted(PRIORITIES)}")
    role = _required_string(data.get("role"), f"{path}.role")
    if role not in NODE_ROLES:
        _fail(f"{path}.role", f"must be one of {sorted(NODE_ROLES)}")

    depends_on = _string_list(data.get("dependsOn"), f"{path}.dependsOn")
    reads = _scope_list(data.get("reads"), f"{path}.reads")
    writes = _scope_list(data.get("writes"), f"{path}.writes")
    resources = _string_list(data.get("resources"), f"{path}.resources")
    for resource_index, resource in enumerate(resources):
        if not _RESOURCE_RE.fullmatch(resource):
            _fail(
                f"{path}.resources[{resource_index}]",
                "must contain only letters, numbers, dot, underscore, colon, slash, or dash",
            )
    validation = _string_list(
        data.get("validation"),
        f"{path}.validation",
        allow_empty=False,
    )
    context = _parse_context(
        data.get("context"),
        f"{path}.context",
        role=role,
        default_profile=default_profile,
    )
    execution = _parse_execution(
        data.get("execution"),
        f"{path}.execution",
        default_timeout=default_timeout,
        default_attempts=default_attempts,
    )
    if role in ("check", "research") and writes and execution.isolation == "shared-worktree":
        _fail(
            f"{path}.writes",
            f"{role} nodes must be read-only in a shared worktree",
        )

    return ExecutionNode(
        id=node_id,
        name=_required_string(data.get("name"), f"{path}.name"),
        description=_required_string(data.get("description"), f"{path}.description"),
        priority=priority,
        role=role,
        depends_on=depends_on,
        reads=reads,
        writes=writes,
        resources=resources,
        context=context,
        validation=validation,
        execution=execution,
        metadata=_metadata(data.get("metadata"), f"{path}.metadata"),
    )


def parse_execution_plan(value: object, *, source: str = "execution.json") -> ExecutionPlan:
    """Validate unknown JSON and return a normalized immutable plan."""
    data = _record(value, "execution.json")
    _strict_fields(data, _TOP_LEVEL_FIELDS, "execution.json")
    version = data.get("version")
    if type(version) is not int or version != PLAN_VERSION:
        _fail("execution.json.version", f"must equal {PLAN_VERSION}")
    task = _required_string(data.get("task"), "execution.json.task")

    defaults_data = _record(data.get("defaults", {}), "execution.json.defaults")
    _strict_fields(defaults_data, _DEFAULT_FIELDS, "execution.json.defaults")
    default_timeout = _positive_int(
        defaults_data.get("timeoutSeconds", DEFAULT_TIMEOUT_SECONDS),
        "execution.json.defaults.timeoutSeconds",
    )
    default_attempts = _positive_int(
        defaults_data.get("maxAttempts", DEFAULT_MAX_ATTEMPTS),
        "execution.json.defaults.maxAttempts",
    )
    default_profile = _required_string(
        defaults_data.get("contextProfile", DEFAULT_CONTEXT_PROFILE),
        "execution.json.defaults.contextProfile",
    )
    if default_profile not in CONTEXT_PROFILES:
        _fail(
            "execution.json.defaults.contextProfile",
            f"must be one of {sorted(CONTEXT_PROFILES)}",
        )

    raw_nodes = data.get("nodes")
    if not isinstance(raw_nodes, list) or not raw_nodes:
        _fail("execution.json.nodes", "must contain at least one node")
    raw_node_values = cast(list[object], raw_nodes)
    nodes = tuple(
        _parse_node(
            value,
            index,
            default_timeout=default_timeout,
            default_attempts=default_attempts,
            default_profile=default_profile,
        )
        for index, value in enumerate(raw_node_values)
    )

    node_ids: set[str] = set()
    for index, node in enumerate(nodes):
        if node.id in node_ids:
            _fail(f"execution.json.nodes[{index}].id", f"duplicate node id {node.id!r}")
        node_ids.add(node.id)
    for index, node in enumerate(nodes):
        for dependency_index, dependency in enumerate(node.depends_on):
            dependency_path = f"execution.json.nodes[{index}].dependsOn[{dependency_index}]"
            if dependency == node.id:
                _fail(dependency_path, "a node cannot depend on itself")
            if dependency not in node_ids:
                _fail(dependency_path, f"unknown node id {dependency!r}")

    barriers = _record(data.get("barriers"), "execution.json.barriers")
    _strict_fields(barriers, _BARRIER_FIELDS, "execution.json.barriers")
    final_barrier = _string_list(
        barriers.get("final"),
        "execution.json.barriers.final",
        allow_empty=False,
    )
    for index, node_id in enumerate(final_barrier):
        if node_id not in node_ids:
            _fail(f"execution.json.barriers.final[{index}]", f"unknown node id {node_id!r}")

    plan = ExecutionPlan(
        version=PLAN_VERSION,
        task=task,
        nodes=nodes,
        final_barrier=final_barrier,
        defaults={
            "timeoutSeconds": default_timeout,
            "maxAttempts": default_attempts,
            "contextProfile": default_profile,
        },
        metadata=_metadata(data.get("metadata"), "execution.json.metadata"),
        source=source,
    )
    topological_nodes(plan)
    _validate_final_barrier_coverage(plan)
    return plan


def read_explicit_execution_plan(task_dir: Path) -> ExecutionPlan | None:
    """Read ``execution.json`` or return None when no explicit plan exists."""
    plan_path = task_dir / PLAN_FILE
    if not plan_path.is_file():
        return None
    try:
        parsed = json.loads(plan_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ExecutionPlanError(
            f"execution.json:{exc.lineno}:{exc.colno}: invalid JSON: {exc.msg}"
        ) from exc
    except OSError as exc:
        raise ExecutionPlanError(f"execution.json: could not be read: {exc}") from exc
    plan = parse_execution_plan(parsed)
    if plan.task != task_dir.name:
        _fail(
            "execution.json.task",
            f"must match task directory {task_dir.name!r}",
        )
    return plan


def load_execution_plan(task_dir: Path, *, allow_legacy: bool = True) -> ExecutionPlan:
    """Load an explicit plan, or conservatively normalize a legacy task."""
    explicit = read_explicit_execution_plan(task_dir)
    if explicit is not None:
        return explicit
    if not allow_legacy:
        raise ExecutionPlanError(f"{PLAN_FILE}: file not found")
    return normalize_legacy_plan(task_dir)


def topological_nodes(plan: ExecutionPlan) -> tuple[ExecutionNode, ...]:
    """Return stable topological order or raise with a concrete cycle path."""
    node_map = plan.node_map
    order_index = {node.id: index for index, node in enumerate(plan.nodes)}
    indegree = {node.id: len(node.depends_on) for node in plan.nodes}
    followers: dict[str, list[str]] = {node.id: [] for node in plan.nodes}
    for node in plan.nodes:
        for dependency in node.depends_on:
            followers[dependency].append(node.id)

    ready = sorted(
        (node_id for node_id, count in indegree.items() if count == 0),
        key=lambda node_id: order_index[node_id],
    )
    ordered: list[ExecutionNode] = []
    while ready:
        node_id = ready.pop(0)
        ordered.append(node_map[node_id])
        for follower in sorted(
            followers[node_id],
            key=lambda follower_id: order_index[follower_id],
        ):
            indegree[follower] -= 1
            if indegree[follower] == 0:
                ready.append(follower)
                ready.sort(key=lambda ready_id: order_index[ready_id])

    if len(ordered) != len(plan.nodes):
        cycle = _find_cycle(plan)
        cycle_text = " -> ".join(cycle) if cycle else "unknown cycle"
        _fail("execution.json.nodes", f"dependency graph contains a cycle: {cycle_text}")
    return tuple(ordered)


def _find_cycle(plan: ExecutionPlan) -> tuple[str, ...]:
    node_map = plan.node_map
    path: list[str] = []
    active_positions: dict[str, int] = {}
    visited: set[str] = set()

    for node in plan.nodes:
        if node.id in visited:
            continue
        stack: list[tuple[str, int]] = [(node.id, 0)]
        while stack:
            node_id, dependency_index = stack[-1]
            if dependency_index == 0 and node_id not in active_positions:
                active_positions[node_id] = len(path)
                path.append(node_id)

            dependencies = node_map[node_id].depends_on
            if dependency_index < len(dependencies):
                dependency = dependencies[dependency_index]
                stack[-1] = (node_id, dependency_index + 1)
                cycle_start = active_positions.get(dependency)
                if cycle_start is not None:
                    return tuple(path[cycle_start:] + [dependency])
                if dependency not in visited:
                    stack.append((dependency, 0))
                continue

            stack.pop()
            active_positions.pop(node_id, None)
            path.pop()
            visited.add(node_id)
    return ()


def _validate_final_barrier_coverage(plan: ExecutionPlan) -> None:
    """Require every final node to be a global integration/check sink."""
    final_ids = set(plan.final_barrier)
    non_final_ids = {node.id for node in plan.nodes if node.id not in final_ids}
    successors: dict[str, list[str]] = {node.id: [] for node in plan.nodes}
    for node in plan.nodes:
        for dependency in node.depends_on:
            successors[dependency].append(node.id)

    for index, node_id in enumerate(plan.final_barrier):
        node = plan.node_map[node_id]
        barrier_path = f"execution.json.barriers.final[{index}]"
        if node.role not in ("integration", "check"):
            _fail(barrier_path, "must reference an integration or check node")
        if node.role == "check" and node.writes:
            _fail(
                barrier_path,
                "must reference a read-only check node without writes",
            )
        if successors[node_id]:
            _fail(
                barrier_path,
                "must reference a sink node without successors; found: "
                + ", ".join(successors[node_id]),
            )

        covered: set[str] = set()
        pending = [node_id]
        while pending:
            dependency_id = pending.pop()
            if dependency_id in covered:
                continue
            covered.add(dependency_id)
            pending.extend(reversed(plan.node_map[dependency_id].depends_on))
        missing = sorted(non_final_ids - covered)
        if missing:
            _fail(
                barrier_path,
                "does not cover every execution branch; missing node(s): "
                + ", ".join(missing),
            )


def execution_plan_to_dict(plan: ExecutionPlan) -> dict[str, Any]:
    """Project an immutable plan into the canonical v1 JSON shape."""
    return {
        "version": PLAN_VERSION,
        "task": plan.task,
        "defaults": dict(plan.defaults),
        "nodes": [
            {
                "id": node.id,
                "name": node.name,
                "description": node.description,
                "priority": node.priority,
                "role": node.role,
                "dependsOn": list(node.depends_on),
                "reads": list(node.reads),
                "writes": list(node.writes),
                "resources": list(node.resources),
                "context": {
                    "profile": node.context.profile,
                    "include": list(node.context.include),
                    "dependencyResults": node.context.dependency_results,
                    "maxBytes": node.context.max_bytes,
                    "perSourceBytes": node.context.per_source_bytes,
                },
                "validation": list(node.validation),
                "execution": {
                    "isolation": node.execution.isolation,
                    "allowed": list(node.execution.allowed),
                    "timeoutSeconds": node.execution.timeout_seconds,
                    "maxAttempts": node.execution.max_attempts,
                    "idempotent": node.execution.idempotent,
                },
                **({"metadata": dict(node.metadata)} if node.metadata else {}),
            }
            for node in plan.nodes
        ],
        "barriers": {"final": list(plan.final_barrier)},
        **({"metadata": dict(plan.metadata)} if plan.metadata else {}),
    }


def write_execution_plan(task_dir: Path, plan: ExecutionPlan) -> Path:
    """Write a validated plan using stable UTF-8 JSON formatting."""
    path = task_dir / PLAN_FILE
    payload = json.dumps(execution_plan_to_dict(plan), indent=2, ensure_ascii=False)
    path.write_text(f"{payload}\n", encoding="utf-8")
    return path


def normalize_legacy_plan(task_dir: Path) -> ExecutionPlan:
    """Convert old planning artifacts into a conservative serial plan."""
    items = _read_implement_items(task_dir / "implement.md")
    source = "implement.md"
    if not items:
        items = _read_structured_subtasks(task_dir / "subtasks.json")
        source = "subtasks.json"
    if not items:
        task_data = _read_json_object(task_dir / "task.json")
        title = _legacy_text(task_data.get("title")) or _legacy_text(task_data.get("name"))
        items = [("P2", title or "Complete task", title or "Complete the current task")]
        source = "implicit"

    raw_nodes: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    previous_id: str | None = None
    for index, (priority, name, description) in enumerate(items, start=1):
        node_id = _unique_legacy_id(name, index, used_ids)
        raw_nodes.append(
            {
                "id": node_id,
                "name": name,
                "description": description,
                "priority": priority if priority in PRIORITIES else "P2",
                "role": "integration" if index == len(items) else "implement",
                "dependsOn": [previous_id] if previous_id else [],
                "reads": ["**/*"],
                "writes": ["**/*"],
                "resources": ["legacy-shared-worktree"],
                "context": {
                    "profile": "integration" if index == len(items) else "implement",
                    "include": ["prd", "design", "implement", "implement-jsonl"],
                    "dependencyResults": "direct",
                    "maxBytes": DEFAULT_CONTEXT_MAX_BYTES,
                    "perSourceBytes": DEFAULT_CONTEXT_PER_SOURCE_BYTES,
                },
                "validation": ["Run the task-appropriate validation before completion"],
                "execution": {
                    "isolation": "shared-worktree",
                    "allowed": ["inline", "native-subagent", "channel"],
                    "timeoutSeconds": DEFAULT_TIMEOUT_SECONDS,
                    "maxAttempts": DEFAULT_MAX_ATTEMPTS,
                    "idempotent": False,
                },
                "metadata": {"legacySource": source},
            }
        )
        previous_id = node_id

    return parse_execution_plan(
        {
            "version": PLAN_VERSION,
            "task": task_dir.name,
            "defaults": {
                "timeoutSeconds": DEFAULT_TIMEOUT_SECONDS,
                "maxAttempts": DEFAULT_MAX_ATTEMPTS,
                "contextProfile": DEFAULT_CONTEXT_PROFILE,
            },
            "nodes": raw_nodes,
            "barriers": {"final": [raw_nodes[-1]["id"]]},
            "metadata": {"normalizedFrom": source, "conservativeSerial": True},
        },
        source=source,
    )


def _read_implement_items(path: Path) -> list[tuple[str, str, str]]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    items: list[tuple[str, str, str]] = []
    for line in lines:
        match = _CHECKLIST_RE.match(line)
        if not match:
            continue
        text = _strip_inline_markdown(match.group(1).strip())
        priority = "P2"
        priority_match = _PRIORITY_RE.match(text)
        if priority_match:
            priority = priority_match.group(1).upper()
            text = text[priority_match.end():].strip()
        if not text:
            continue
        separator_indexes = [index for index in (text.find(":"), text.find("：")) if index > 0]
        separator = min(separator_indexes) if separator_indexes else -1
        name = text[:separator].strip() if separator > 0 else text
        description = text[separator + 1:].strip() if separator > 0 else text
        if name:
            items.append((priority, name, description or name))
    return items


def _strip_inline_markdown(value: str) -> str:
    value = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"\1", value)
    value = re.sub(r"`([^`]+)`", r"\1", value)
    return re.sub(r"\s+", " ", value).strip()


def _read_structured_subtasks(path: Path) -> list[tuple[str, str, str]]:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    raw_items = parsed if isinstance(parsed, list) else parsed.get("subtasks") if isinstance(parsed, dict) else None
    if not isinstance(raw_items, list):
        return []
    items: list[tuple[str, str, str]] = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        name = _legacy_text(raw.get("name"))
        if not name:
            continue
        priority = _legacy_text(raw.get("priority")).upper() or "P2"
        description = _legacy_text(raw.get("description")) or name
        items.append((priority, name, description))
    return items


def _read_json_object(path: Path) -> dict[str, Any]:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _legacy_text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _unique_legacy_id(name: str, index: int, used: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or f"node-{index}"
    candidate = base
    suffix = 2
    while candidate in used:
        candidate = f"{base}-{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate
