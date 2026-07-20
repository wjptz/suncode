"""Validate and advance the Suncode Trellis-upstream sync checkpoint.

Use ``python`` on Windows and ``python3`` on macOS/Linux.
"""

from __future__ import annotations

import argparse
import json
import sys
from io import TextIOWrapper
from pathlib import Path

from checkpoint_model import (
    CheckpointError,
    RelatedCommit,
    SyncState,
    load_state,
    parse_commit,
    parse_repo_path,
)
from checkpoint_store import (
    advance_state,
    resolve_paths,
    validate_state,
    write_state_atomic,
)


def _configure_windows_stdio() -> None:
    """Use UTF-8 for the self-contained project skill on Windows."""
    if sys.platform != "win32":
        return
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if isinstance(stream, TextIOWrapper):
            stream.reconfigure(encoding="utf-8", errors="replace")


def _parse_related_commit(value: str) -> RelatedCommit:
    if "=" not in value:
        raise argparse.ArgumentTypeError(
            "related commit must use <repository>=<40-character-commit>"
        )
    repository, commit = value.split("=", 1)
    try:
        return RelatedCommit(
            repository=parse_repo_path(repository, "related repository"),
            commit=parse_commit(commit, "related commit"),
        )
    except CheckpointError as error:
        raise argparse.ArgumentTypeError(str(error)) from error


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate or advance the Trellis-upstream sync checkpoint."
    )
    parser.add_argument("--repo", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--state", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--ledger", type=Path, help=argparse.SUPPRESS)
    subparsers = parser.add_subparsers(dest="command", required=True)

    show_parser = subparsers.add_parser("show", help="Show the current cursor")
    show_parser.add_argument(
        "--json", action="store_true", help="Print the complete state as JSON"
    )

    subparsers.add_parser("validate", help="Validate state, ledger, refs, and Git")

    advance_parser = subparsers.add_parser(
        "advance", help="Advance the reviewed cursor after a completed review"
    )
    advance_parser.add_argument("--reviewed-version", required=True)
    advance_parser.add_argument("--reviewed-commit", required=True)
    advance_parser.add_argument("--date", required=True, dest="reviewed_on")
    advance_parser.add_argument("--ledger-entry", required=True)
    advance_parser.add_argument("--task", required=True)
    advance_parser.add_argument("--local-commit")
    advance_parser.add_argument(
        "--related-commit",
        action="append",
        default=[],
        type=_parse_related_commit,
        dest="related_commits",
        metavar="REPOSITORY=COMMIT",
    )
    advance_parser.add_argument(
        "--dry-run", action="store_true", help="Validate and print without writing"
    )
    return parser


def _print_human_state(state: SyncState) -> None:
    reviewed = state.last_reviewed
    adoption = state.latest_adoption
    print(f"Last reviewed: {reviewed.point.version} {reviewed.point.commit}")
    print(f"Reviewed date: {reviewed.reviewed_on}")
    print(f"Ledger entry: {reviewed.ledger_entry}")
    print(f"Task: {reviewed.task}")
    print(
        "Latest adoption: "
        f"{adoption.from_upstream_exclusive.version}.."
        f"{adoption.through_upstream_inclusive.version} "
        f"-> {adoption.local_commit}"
    )
    print(f"Next review starts after: {reviewed.point.commit}")


def main(argv: list[str] | None = None) -> int:
    """Run the checkpoint CLI and return a process exit code."""
    _configure_windows_stdio()
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        paths = resolve_paths(
            Path(__file__), repo=args.repo, state=args.state, ledger=args.ledger
        )
        current = load_state(paths.state_path)
        validate_state(current, paths)

        if args.command == "show":
            if args.json:
                print(json.dumps(current.to_dict(), indent=2, ensure_ascii=False))
            else:
                _print_human_state(current)
            return 0

        if args.command == "validate":
            print(
                "Checkpoint valid: "
                f"{current.last_reviewed.point.version} "
                f"{current.last_reviewed.point.commit}"
            )
            return 0

        related = tuple(args.related_commits)
        candidate, is_noop = advance_state(
            current,
            paths,
            reviewed_version=args.reviewed_version,
            reviewed_commit=args.reviewed_commit,
            reviewed_on=args.reviewed_on,
            ledger_entry=args.ledger_entry,
            task=args.task,
            local_commit=args.local_commit,
            related_commits=related,
        )
        if args.dry_run:
            print(json.dumps(candidate.to_dict(), indent=2, ensure_ascii=False))
            return 0
        if is_noop:
            print(
                "Checkpoint already recorded: "
                f"{candidate.last_reviewed.point.version} "
                f"{candidate.last_reviewed.point.commit}"
            )
            return 0
        write_state_atomic(paths.state_path, candidate)
        print(
            "Checkpoint advanced: "
            f"{candidate.last_reviewed.point.version} "
            f"{candidate.last_reviewed.point.commit}"
        )
        return 0
    except CheckpointError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
