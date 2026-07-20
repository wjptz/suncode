"""Git-backed validation and atomic storage for sync checkpoints."""

from __future__ import annotations

import json
import os
import stat
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path, PurePosixPath

from checkpoint_model import (
    FORK_BASELINE_COMMIT,
    FORK_BASELINE_VERSION,
    OFFICIAL_REMOTE,
    OFFICIAL_REPOSITORY,
    RELEASE_REF_NAMESPACE,
    AdoptionRecord,
    CheckpointError,
    CommitPoint,
    RelatedCommit,
    ReviewCursor,
    SyncState,
    UpstreamConfig,
    ensure_unique_repositories,
    parse_commit,
    parse_iso_date,
    parse_ledger_entry,
    parse_task_path,
    parse_version,
)


@dataclass(frozen=True)
class RuntimePaths:
    """Resolved repository and checkpoint files used by one invocation."""

    repo_root: Path
    state_path: Path
    ledger_path: Path


def _run_git(args: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    command = ["git", "-c", "i18n.logOutputEncoding=UTF-8", *args]
    try:
        return subprocess.run(
            command,
            cwd=cwd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except OSError as error:
        raise CheckpointError(f"could not run git in {cwd}: {error}") from error


def _git_output(args: list[str], cwd: Path) -> str:
    result = _run_git(args, cwd)
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "unknown Git error"
        raise CheckpointError(f"git {' '.join(args)} failed in {cwd}: {detail}")
    return result.stdout.strip()


def _discover_repo_root(start: Path) -> Path:
    result = _run_git(["rev-parse", "--show-toplevel"], start)
    if result.returncode != 0:
        raise CheckpointError(f"{start} is not inside a Git repository")
    return Path(result.stdout.strip()).resolve()


def _assert_inside_repo(path: Path, repo_root: Path, context: str) -> None:
    try:
        path.resolve().relative_to(repo_root.resolve())
    except ValueError as error:
        raise CheckpointError(f"{context} must be inside {repo_root}") from error


def resolve_paths(
    script_path: Path,
    *,
    repo: Path | None,
    state: Path | None,
    ledger: Path | None,
) -> RuntimePaths:
    """Resolve default skill paths without depending on the working directory."""
    skill_root = script_path.resolve().parent.parent
    repo_root = (
        repo.expanduser().resolve() if repo is not None else _discover_repo_root(skill_root)
    )
    state_path = (
        state.expanduser().resolve()
        if state is not None
        else skill_root / "references" / "sync-state.json"
    )
    ledger_path = (
        ledger.expanduser().resolve()
        if ledger is not None
        else skill_root / "references" / "sync-ledger.md"
    )
    _assert_inside_repo(state_path, repo_root, "checkpoint state")
    _assert_inside_repo(ledger_path, repo_root, "checkpoint ledger")
    return RuntimePaths(repo_root, state_path, ledger_path)


def _assert_commit(repo: Path, commit: str, context: str) -> None:
    result = _run_git(["cat-file", "-e", f"{commit}^{{commit}}"], repo)
    if result.returncode != 0:
        raise CheckpointError(f"{context} commit does not exist in {repo}: {commit}")


def _assert_ancestor(repo: Path, older: str, newer: str, context: str) -> None:
    result = _run_git(["merge-base", "--is-ancestor", older, newer], repo)
    if result.returncode == 0:
        return
    if result.returncode == 1:
        raise CheckpointError(
            f"{context} is not forward-only: {older} is not an ancestor of {newer}"
        )
    detail = result.stderr.strip() or "unknown Git error"
    raise CheckpointError(f"could not verify {context}: {detail}")


def _assert_release_ref(
    repo: Path, namespace: str, point: CommitPoint, context: str
) -> None:
    ref = f"{namespace.rstrip('/')}/{point.version}^{{commit}}"
    actual = _git_output(["rev-parse", "--verify", ref], repo)
    if actual != point.commit:
        raise CheckpointError(
            f"{context} release ref resolves to {actual}, expected {point.commit}"
        )


def _assert_ledger_marker(ledger_path: Path, entry: str) -> None:
    try:
        content = ledger_path.read_text(encoding="utf-8")
    except OSError as error:
        raise CheckpointError(f"could not read ledger {ledger_path}: {error}") from error
    marker = f"<!-- sync-entry:{entry} -->"
    if content.count(marker) != 1:
        raise CheckpointError(
            f"ledger must contain exactly one marker for {entry}: {marker}"
        )


def _resolve_related_repo(repo_root: Path, relative: str) -> Path:
    repository = (repo_root / PurePosixPath(relative)).resolve()
    _assert_inside_repo(repository, repo_root, f"related repository {relative}")
    if not repository.is_dir():
        raise CheckpointError(f"related repository does not exist: {relative}")
    probe = _run_git(["rev-parse", "--is-inside-work-tree"], repository)
    if probe.returncode != 0 or probe.stdout.strip() != "true":
        raise CheckpointError(f"related repository is not a Git worktree: {relative}")
    return repository


def validate_state(state: SyncState, paths: RuntimePaths) -> None:
    """Validate immutable identity, ledger links, Git objects, and ancestry."""
    expected_upstream = UpstreamConfig(
        OFFICIAL_REPOSITORY, OFFICIAL_REMOTE, RELEASE_REF_NAMESPACE
    )
    if state.upstream != expected_upstream:
        raise CheckpointError("state.upstream differs from the official Trellis identity")
    expected_baseline = CommitPoint(FORK_BASELINE_VERSION, FORK_BASELINE_COMMIT)
    if state.fork_baseline != expected_baseline:
        raise CheckpointError("state.fork_baseline differs from the immutable fork baseline")

    remote_url = _git_output(
        ["remote", "get-url", state.upstream.remote], paths.repo_root
    )
    if remote_url != state.upstream.repository:
        raise CheckpointError(
            f"remote {state.upstream.remote} points to {remote_url}, "
            f"expected {state.upstream.repository}"
        )

    points = (
        (state.fork_baseline, "fork baseline"),
        (state.last_reviewed.point, "last reviewed"),
        (state.latest_adoption.from_upstream_exclusive, "adoption start"),
        (state.latest_adoption.through_upstream_inclusive, "adoption end"),
    )
    for point, context in points:
        _assert_commit(paths.repo_root, point.commit, context)
        _assert_release_ref(
            paths.repo_root, state.upstream.release_ref_namespace, point, context
        )

    _assert_ancestor(
        paths.repo_root,
        state.fork_baseline.commit,
        state.latest_adoption.from_upstream_exclusive.commit,
        "fork baseline to adoption start",
    )
    _assert_ancestor(
        paths.repo_root,
        state.latest_adoption.from_upstream_exclusive.commit,
        state.latest_adoption.through_upstream_inclusive.commit,
        "adoption range",
    )
    _assert_ancestor(
        paths.repo_root,
        state.latest_adoption.through_upstream_inclusive.commit,
        state.last_reviewed.point.commit,
        "adoption end to last reviewed",
    )
    if date.fromisoformat(state.latest_adoption.adopted_on) > date.fromisoformat(
        state.last_reviewed.reviewed_on
    ):
        raise CheckpointError("latest adoption date cannot be after last reviewed date")

    _assert_commit(
        paths.repo_root, state.latest_adoption.local_commit, "latest adoption local"
    )
    for related in state.latest_adoption.related_commits:
        repository = _resolve_related_repo(paths.repo_root, related.repository)
        _assert_commit(repository, related.commit, f"related {related.repository}")

    _assert_ledger_marker(paths.ledger_path, state.last_reviewed.ledger_entry)
    _assert_ledger_marker(paths.ledger_path, state.latest_adoption.ledger_entry)


def write_state_atomic(path: Path, state: SyncState) -> None:
    """Atomically replace the checkpoint while preserving its file mode."""
    payload = json.dumps(state.to_dict(), indent=2, ensure_ascii=False) + "\n"
    mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644
    fd, temporary_name = tempfile.mkstemp(
        dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp"
    )
    temporary = Path(temporary_name)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(fd, mode)
        handle = os.fdopen(fd, "w", encoding="utf-8", newline="\n")
        fd = -1
        with handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException as error:
        if fd >= 0:
            os.close(fd)
        try:
            temporary.unlink()
        except OSError:
            pass
        if isinstance(error, OSError):
            raise CheckpointError(
                f"could not atomically write checkpoint {path}: {error}"
            ) from error
        raise


def advance_state(
    current: SyncState,
    paths: RuntimePaths,
    *,
    reviewed_version: str,
    reviewed_commit: str,
    reviewed_on: str,
    ledger_entry: str,
    task: str,
    local_commit: str | None,
    related_commits: tuple[RelatedCommit, ...],
) -> tuple[SyncState, bool]:
    """Build and validate a forward-only candidate; return (state, is_noop)."""
    target = CommitPoint(
        parse_version(reviewed_version, "reviewed version"),
        parse_commit(reviewed_commit, "reviewed commit"),
    )
    cursor = ReviewCursor(
        point=target,
        reviewed_on=parse_iso_date(reviewed_on, "reviewed date"),
        ledger_entry=parse_ledger_entry(ledger_entry, "ledger entry"),
        task=parse_task_path(task, "task"),
    )
    ensure_unique_repositories(related_commits, "related commits")
    if local_commit is None and related_commits:
        raise CheckpointError("--related-commit requires --local-commit")
    if date.fromisoformat(cursor.reviewed_on) < date.fromisoformat(
        current.last_reviewed.reviewed_on
    ):
        raise CheckpointError("reviewed date cannot move backwards")

    _assert_ledger_marker(paths.ledger_path, cursor.ledger_entry)
    _assert_commit(paths.repo_root, target.commit, "target reviewed")
    _assert_release_ref(
        paths.repo_root,
        current.upstream.release_ref_namespace,
        target,
        "target reviewed",
    )

    if target.commit == current.last_reviewed.point.commit:
        if cursor != current.last_reviewed:
            raise CheckpointError(
                "target commit is already reviewed but its metadata conflicts"
            )
        if local_commit is None:
            return current, True
        parsed_local = parse_commit(local_commit, "local commit")
        latest = current.latest_adoption
        if (
            latest.through_upstream_inclusive == target
            and latest.local_commit == parsed_local
            and latest.related_commits == related_commits
            and latest.adopted_on == cursor.reviewed_on
            and latest.ledger_entry == cursor.ledger_entry
        ):
            return current, True
        raise CheckpointError(
            "target commit is already reviewed but adoption metadata conflicts"
        )

    _assert_ancestor(
        paths.repo_root,
        current.last_reviewed.point.commit,
        target.commit,
        "last reviewed to target",
    )

    latest_adoption = current.latest_adoption
    if local_commit is not None:
        parsed_local = parse_commit(local_commit, "local commit")
        _assert_commit(paths.repo_root, parsed_local, "new adoption local")
        for related in related_commits:
            repository = _resolve_related_repo(paths.repo_root, related.repository)
            _assert_commit(repository, related.commit, f"related {related.repository}")
        latest_adoption = AdoptionRecord(
            from_upstream_exclusive=current.last_reviewed.point,
            through_upstream_inclusive=target,
            local_commit=parsed_local,
            related_commits=related_commits,
            adopted_on=cursor.reviewed_on,
            ledger_entry=cursor.ledger_entry,
        )

    candidate = SyncState(
        upstream=current.upstream,
        fork_baseline=current.fork_baseline,
        last_reviewed=cursor,
        latest_adoption=latest_adoption,
    )
    validate_state(candidate, paths)
    return candidate, False
