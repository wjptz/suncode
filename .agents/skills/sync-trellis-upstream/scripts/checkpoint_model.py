"""Typed schema for the Trellis-upstream synchronization checkpoint."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path, PurePosixPath
from typing import cast


SCHEMA_VERSION = 1
OFFICIAL_REPOSITORY = "https://github.com/mindfold-ai/Trellis.git"
OFFICIAL_REMOTE = "upstream"
RELEASE_REF_NAMESPACE = "refs/remotes/upstream/releases"
FORK_BASELINE_VERSION = "v0.6.5"
FORK_BASELINE_COMMIT = "01ec8d6503b2338194e9bd2e9dbbcf22054c1bba"

COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
VERSION_RE = re.compile(r"^v[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$")
LEDGER_ENTRY_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")


class CheckpointError(Exception):
    """A user-actionable checkpoint or Git validation failure."""


def _require_object(value: object, context: str) -> dict[str, object]:
    if not isinstance(value, dict) or not all(
        isinstance(key, str) for key in value.keys()
    ):
        raise CheckpointError(f"{context} must be a JSON object")
    return cast(dict[str, object], value)


def _require_list(value: object, context: str) -> list[object]:
    if not isinstance(value, list):
        raise CheckpointError(f"{context} must be a JSON array")
    return cast(list[object], value)


def _require_exact_keys(
    raw: dict[str, object], expected: set[str], context: str
) -> None:
    actual = set(raw)
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    if not missing and not extra:
        return
    details: list[str] = []
    if missing:
        details.append(f"missing {', '.join(missing)}")
    if extra:
        details.append(f"unknown {', '.join(extra)}")
    raise CheckpointError(f"{context} has invalid fields: {'; '.join(details)}")


def _require_string(value: object, context: str) -> str:
    if not isinstance(value, str) or not value:
        raise CheckpointError(f"{context} must be a non-empty string")
    return value


def parse_commit(value: object, context: str) -> str:
    """Return a validated full lowercase Git commit ID."""
    commit = _require_string(value, context)
    if not COMMIT_RE.fullmatch(commit):
        raise CheckpointError(
            f"{context} must be a full 40-character lowercase commit ID"
        )
    return commit


def parse_version(value: object, context: str) -> str:
    """Return a validated v-prefixed SemVer release tag."""
    version = _require_string(value, context)
    if not VERSION_RE.fullmatch(version):
        raise CheckpointError(f"{context} must be a v-prefixed SemVer tag")
    return version


def parse_iso_date(value: object, context: str) -> str:
    """Return a canonical ISO calendar date."""
    raw = _require_string(value, context)
    try:
        parsed = date.fromisoformat(raw)
    except ValueError as error:
        raise CheckpointError(f"{context} must be an ISO date (YYYY-MM-DD)") from error
    if parsed.isoformat() != raw:
        raise CheckpointError(f"{context} must be an ISO date (YYYY-MM-DD)")
    return raw


def parse_ledger_entry(value: object, context: str) -> str:
    """Return a safe ledger marker identifier."""
    entry = _require_string(value, context)
    if not LEDGER_ENTRY_RE.fullmatch(entry):
        raise CheckpointError(
            f"{context} must contain lowercase letters, digits, dot, underscore, or dash"
        )
    return entry


def _parse_safe_posix_path(value: object, context: str) -> str:
    raw = _require_string(value, context)
    if "\\" in raw or "\x00" in raw:
        raise CheckpointError(f"{context} must use safe POSIX separators")
    path = PurePosixPath(raw)
    if (
        path.is_absolute()
        or path.as_posix() != raw
        or any(part in ("", ".", "..") for part in path.parts)
        or (path.parts and ":" in path.parts[0])
    ):
        raise CheckpointError(f"{context} must be a safe repository-relative path")
    return path.as_posix()


def parse_repo_path(value: object, context: str) -> str:
    """Return a safe repository-relative path to a related worktree."""
    path = _parse_safe_posix_path(value, context)
    if path.startswith(".git/") or path == ".git":
        raise CheckpointError(f"{context} cannot point into .git")
    return path


def parse_task_path(value: object, context: str) -> str:
    """Return a safe repository-relative Trellis task path."""
    path = _parse_safe_posix_path(value, context)
    if not path.startswith(".trellis/tasks/"):
        raise CheckpointError(f"{context} must be under .trellis/tasks/")
    return path


@dataclass(frozen=True)
class CommitPoint:
    """An official release tag and its full commit identity."""

    version: str
    commit: str

    @classmethod
    def from_raw(cls, value: object, context: str) -> CommitPoint:
        raw = _require_object(value, context)
        _require_exact_keys(raw, {"version", "commit"}, context)
        return cls(
            version=parse_version(raw["version"], f"{context}.version"),
            commit=parse_commit(raw["commit"], f"{context}.commit"),
        )

    def to_dict(self) -> dict[str, object]:
        return {"version": self.version, "commit": self.commit}


@dataclass(frozen=True)
class ReviewCursor:
    """The last official release whose commits have all been classified."""

    point: CommitPoint
    reviewed_on: str
    ledger_entry: str
    task: str

    @classmethod
    def from_raw(cls, value: object, context: str) -> ReviewCursor:
        raw = _require_object(value, context)
        _require_exact_keys(
            raw,
            {"version", "commit", "date", "ledger_entry", "task"},
            context,
        )
        return cls(
            point=CommitPoint.from_raw(
                {"version": raw["version"], "commit": raw["commit"]}, context
            ),
            reviewed_on=parse_iso_date(raw["date"], f"{context}.date"),
            ledger_entry=parse_ledger_entry(
                raw["ledger_entry"], f"{context}.ledger_entry"
            ),
            task=parse_task_path(raw["task"], f"{context}.task"),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "version": self.point.version,
            "commit": self.point.commit,
            "date": self.reviewed_on,
            "ledger_entry": self.ledger_entry,
            "task": self.task,
        }


@dataclass(frozen=True)
class RelatedCommit:
    """A commit in a repository nested below the Suncode root."""

    repository: str
    commit: str

    @classmethod
    def from_raw(cls, value: object, context: str) -> RelatedCommit:
        raw = _require_object(value, context)
        _require_exact_keys(raw, {"repository", "commit"}, context)
        return cls(
            repository=parse_repo_path(raw["repository"], f"{context}.repository"),
            commit=parse_commit(raw["commit"], f"{context}.commit"),
        )

    def to_dict(self) -> dict[str, object]:
        return {"repository": self.repository, "commit": self.commit}


def ensure_unique_repositories(
    related: tuple[RelatedCommit, ...], context: str
) -> None:
    """Reject duplicate related-repository entries."""
    repositories = [item.repository for item in related]
    if len(repositories) != len(set(repositories)):
        raise CheckpointError(f"{context} contains duplicate repository paths")


@dataclass(frozen=True)
class AdoptionRecord:
    """The most recent reviewed range that produced a Suncode commit."""

    from_upstream_exclusive: CommitPoint
    through_upstream_inclusive: CommitPoint
    local_commit: str
    related_commits: tuple[RelatedCommit, ...]
    adopted_on: str
    ledger_entry: str

    @classmethod
    def from_raw(cls, value: object, context: str) -> AdoptionRecord:
        raw = _require_object(value, context)
        _require_exact_keys(
            raw,
            {
                "from_upstream_exclusive",
                "through_upstream_inclusive",
                "local_commit",
                "related_commits",
                "date",
                "ledger_entry",
            },
            context,
        )
        related_raw = _require_list(
            raw["related_commits"], f"{context}.related_commits"
        )
        related = tuple(
            RelatedCommit.from_raw(item, f"{context}.related_commits[{index}]")
            for index, item in enumerate(related_raw)
        )
        ensure_unique_repositories(related, f"{context}.related_commits")
        return cls(
            from_upstream_exclusive=CommitPoint.from_raw(
                raw["from_upstream_exclusive"],
                f"{context}.from_upstream_exclusive",
            ),
            through_upstream_inclusive=CommitPoint.from_raw(
                raw["through_upstream_inclusive"],
                f"{context}.through_upstream_inclusive",
            ),
            local_commit=parse_commit(raw["local_commit"], f"{context}.local_commit"),
            related_commits=related,
            adopted_on=parse_iso_date(raw["date"], f"{context}.date"),
            ledger_entry=parse_ledger_entry(
                raw["ledger_entry"], f"{context}.ledger_entry"
            ),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "from_upstream_exclusive": self.from_upstream_exclusive.to_dict(),
            "through_upstream_inclusive": self.through_upstream_inclusive.to_dict(),
            "local_commit": self.local_commit,
            "related_commits": [item.to_dict() for item in self.related_commits],
            "date": self.adopted_on,
            "ledger_entry": self.ledger_entry,
        }


@dataclass(frozen=True)
class UpstreamConfig:
    """Immutable official-repository configuration."""

    repository: str
    remote: str
    release_ref_namespace: str

    @classmethod
    def from_raw(cls, value: object, context: str) -> UpstreamConfig:
        raw = _require_object(value, context)
        _require_exact_keys(
            raw, {"repository", "remote", "release_ref_namespace"}, context
        )
        return cls(
            repository=_require_string(raw["repository"], f"{context}.repository"),
            remote=_require_string(raw["remote"], f"{context}.remote"),
            release_ref_namespace=_require_string(
                raw["release_ref_namespace"], f"{context}.release_ref_namespace"
            ),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "repository": self.repository,
            "remote": self.remote,
            "release_ref_namespace": self.release_ref_namespace,
        }


@dataclass(frozen=True)
class SyncState:
    """The complete versioned checkpoint state."""

    upstream: UpstreamConfig
    fork_baseline: CommitPoint
    last_reviewed: ReviewCursor
    latest_adoption: AdoptionRecord

    @classmethod
    def from_raw(cls, value: object) -> SyncState:
        raw = _require_object(value, "state")
        _require_exact_keys(
            raw,
            {
                "schema_version",
                "upstream",
                "fork_baseline",
                "last_reviewed",
                "latest_adoption",
            },
            "state",
        )
        schema_version = raw["schema_version"]
        if (
            not isinstance(schema_version, int)
            or isinstance(schema_version, bool)
            or schema_version != SCHEMA_VERSION
        ):
            raise CheckpointError(
                "state.schema_version must be "
                f"{SCHEMA_VERSION}, got {schema_version!r}"
            )
        return cls(
            upstream=UpstreamConfig.from_raw(raw["upstream"], "state.upstream"),
            fork_baseline=CommitPoint.from_raw(
                raw["fork_baseline"], "state.fork_baseline"
            ),
            last_reviewed=ReviewCursor.from_raw(
                raw["last_reviewed"], "state.last_reviewed"
            ),
            latest_adoption=AdoptionRecord.from_raw(
                raw["latest_adoption"], "state.latest_adoption"
            ),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "schema_version": SCHEMA_VERSION,
            "upstream": self.upstream.to_dict(),
            "fork_baseline": self.fork_baseline.to_dict(),
            "last_reviewed": self.last_reviewed.to_dict(),
            "latest_adoption": self.latest_adoption.to_dict(),
        }


def load_state(path: Path) -> SyncState:
    """Load and structurally validate a checkpoint JSON file."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise CheckpointError(f"checkpoint state does not exist: {path}") from error
    except json.JSONDecodeError as error:
        raise CheckpointError(f"checkpoint state is invalid JSON: {error}") from error
    except OSError as error:
        raise CheckpointError(f"could not read checkpoint state {path}: {error}") from error
    return SyncState.from_raw(raw)
