"""Network-free tests for the Trellis-upstream sync checkpoint tool."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import checkpoint_store
from checkpoint_model import (
    FORK_BASELINE_COMMIT,
    FORK_BASELINE_VERSION,
    OFFICIAL_REMOTE,
    OFFICIAL_REPOSITORY,
    RELEASE_REF_NAMESPACE,
    CheckpointError,
    load_state,
)
from checkpoint_store import advance_state, validate_state, write_state_atomic


SCRIPTS_DIR = Path(__file__).resolve().parent
SKILL_ROOT = SCRIPTS_DIR.parent
PROJECT_ROOT = SKILL_ROOT.parents[2]
CLI = SCRIPTS_DIR / "sync_checkpoint.py"

REVIEWED_VERSION = "v0.6.7"
REVIEWED_COMMIT = "e7c5ead4d0dfd717d11a40b6bc0c80d8af94c49a"
ADOPTION_COMMIT = "842056c1bc9eae17cae85f3d81df0dceed01ee21"
RELATED_COMMIT = "3619bfedf1a96569db3fe95cc805af0424092007"
INITIAL_ENTRY = "2026-07-20-v0.6.6-v0.6.7"
NEXT_ENTRY = "2026-08-01-v0.6.8"


def run_git(
    repository: Path,
    *args: str,
    input_text: str | None = None,
) -> str:
    """Run Git with deterministic UTF-8 decoding and return stdout."""
    result = subprocess.run(
        ["git", "-c", "i18n.logOutputEncoding=UTF-8", *args],
        cwd=repository,
        input=input_text,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"git {' '.join(args)} failed in {repository}: "
            f"{result.stderr.strip() or result.stdout.strip()}"
        )
    return result.stdout.strip()


class CheckpointFixture:
    """A temporary local clone containing the real immutable baseline objects."""

    def __init__(self, root: Path) -> None:
        self.repo = root / "repo"
        clone = subprocess.run(
            [
                "git",
                "clone",
                "--quiet",
                "--shared",
                "--no-checkout",
                str(PROJECT_ROOT),
                str(self.repo),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        if clone.returncode != 0:
            raise AssertionError(f"could not create temporary clone: {clone.stderr}")
        run_git(self.repo, "config", "user.name", "Sync Checkpoint Tests")
        run_git(self.repo, "config", "user.email", "sync-tests@example.invalid")
        run_git(self.repo, "remote", "add", OFFICIAL_REMOTE, OFFICIAL_REPOSITORY)

        self.related_repo = self.repo / "marketplace"
        related_clone = subprocess.run(
            [
                "git",
                "clone",
                "--quiet",
                "--shared",
                "--no-checkout",
                str(PROJECT_ROOT / "marketplace"),
                str(self.related_repo),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        if related_clone.returncode != 0:
            raise AssertionError(
                f"could not create related temporary clone: {related_clone.stderr}"
            )
        run_git(self.related_repo, "config", "user.name", "Sync Checkpoint Tests")
        run_git(
            self.related_repo,
            "config",
            "user.email",
            "sync-tests@example.invalid",
        )

        self.state_path = self.repo / "checkpoint" / "sync-state.json"
        self.ledger_path = self.repo / "checkpoint" / "sync-ledger.md"
        self.state_path.parent.mkdir(parents=True)
        self.add_ledger_entry(INITIAL_ENTRY)
        self.set_release(FORK_BASELINE_VERSION, FORK_BASELINE_COMMIT)
        self.set_release(REVIEWED_VERSION, REVIEWED_COMMIT)
        self.state_path.write_text(
            json.dumps(self.initial_state(), indent=2) + "\n", encoding="utf-8"
        )

    def initial_state(self) -> dict[str, object]:
        return {
            "schema_version": 1,
            "upstream": {
                "repository": OFFICIAL_REPOSITORY,
                "remote": OFFICIAL_REMOTE,
                "release_ref_namespace": RELEASE_REF_NAMESPACE,
            },
            "fork_baseline": {
                "version": FORK_BASELINE_VERSION,
                "commit": FORK_BASELINE_COMMIT,
            },
            "last_reviewed": {
                "version": REVIEWED_VERSION,
                "commit": REVIEWED_COMMIT,
                "date": "2026-07-20",
                "ledger_entry": INITIAL_ENTRY,
                "task": ".trellis/tasks/archive/2026-07/previous-sync",
            },
            "latest_adoption": {
                "from_upstream_exclusive": {
                    "version": FORK_BASELINE_VERSION,
                    "commit": FORK_BASELINE_COMMIT,
                },
                "through_upstream_inclusive": {
                    "version": REVIEWED_VERSION,
                    "commit": REVIEWED_COMMIT,
                },
                "local_commit": ADOPTION_COMMIT,
                "related_commits": [
                    {"repository": "marketplace", "commit": RELATED_COMMIT}
                ],
                "date": "2026-07-20",
                "ledger_entry": INITIAL_ENTRY,
            },
        }

    def add_ledger_entry(self, entry: str) -> None:
        with self.ledger_path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(f"<!-- sync-entry:{entry} -->\n")

    def set_release(self, version: str, commit: str) -> None:
        run_git(
            self.repo,
            "update-ref",
            f"{RELEASE_REF_NAMESPACE}/{version}",
            commit,
        )

    def create_commit(self, repository: Path, parent: str, message: str) -> str:
        tree = run_git(repository, "rev-parse", f"{parent}^{{tree}}")
        return run_git(
            repository,
            "commit-tree",
            tree,
            "-p",
            parent,
            input_text=f"{message}\n",
        )

    def run_cli(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(CLI),
                "--repo",
                str(self.repo),
                "--state",
                str(self.state_path),
                "--ledger",
                str(self.ledger_path),
                *args,
            ],
            cwd=self.repo,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

    def prepare_target(self, parent: str = REVIEWED_COMMIT) -> str:
        target = self.create_commit(self.repo, parent, f"target from {parent}")
        self.set_release("v0.6.8", target)
        return target

    def advance_args(self, target: str) -> tuple[str, ...]:
        return (
            "advance",
            "--reviewed-version",
            "v0.6.8",
            "--reviewed-commit",
            target,
            "--date",
            "2026-08-01",
            "--ledger-entry",
            NEXT_ENTRY,
            "--task",
            ".trellis/tasks/08-01-sync-v0.6.8",
        )


class SyncCheckpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.fixture = CheckpointFixture(Path(self.temporary.name))

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def assert_cli_error(
        self, result: subprocess.CompletedProcess[str], message: str
    ) -> None:
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn(message, result.stderr)

    def test_validate_accepts_the_initial_checkpoint(self) -> None:
        result = self.fixture.run_cli("validate")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"Checkpoint valid: {REVIEWED_VERSION}", result.stdout)

    def test_adoption_advance_updates_review_and_adoption(self) -> None:
        target = self.fixture.prepare_target()
        local = self.fixture.create_commit(self.fixture.repo, ADOPTION_COMMIT, "local")
        related = self.fixture.create_commit(
            self.fixture.related_repo, RELATED_COMMIT, "related"
        )
        self.fixture.add_ledger_entry(NEXT_ENTRY)

        result = self.fixture.run_cli(
            *self.fixture.advance_args(target),
            "--local-commit",
            local,
            "--related-commit",
            f"marketplace={related}",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        state = load_state(self.fixture.state_path)
        self.assertEqual(state.last_reviewed.point.commit, target)
        self.assertEqual(
            state.latest_adoption.from_upstream_exclusive.commit, REVIEWED_COMMIT
        )
        self.assertEqual(state.latest_adoption.local_commit, local)
        self.assertEqual(state.latest_adoption.related_commits[0].commit, related)

    def test_review_only_advance_preserves_latest_adoption(self) -> None:
        target = self.fixture.prepare_target()
        self.fixture.add_ledger_entry(NEXT_ENTRY)
        before = load_state(self.fixture.state_path).latest_adoption

        result = self.fixture.run_cli(*self.fixture.advance_args(target))

        self.assertEqual(result.returncode, 0, result.stderr)
        after = load_state(self.fixture.state_path)
        self.assertEqual(after.last_reviewed.point.commit, target)
        self.assertEqual(after.latest_adoption, before)

    def test_identical_retry_is_an_idempotent_noop(self) -> None:
        target = self.fixture.prepare_target()
        self.fixture.add_ledger_entry(NEXT_ENTRY)
        args = self.fixture.advance_args(target)
        first = self.fixture.run_cli(*args)
        self.assertEqual(first.returncode, 0, first.stderr)
        after_first = self.fixture.state_path.read_bytes()

        second = self.fixture.run_cli(*args)

        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertIn("Checkpoint already recorded", second.stdout)
        self.assertEqual(self.fixture.state_path.read_bytes(), after_first)

    def test_regression_is_rejected(self) -> None:
        self.fixture.add_ledger_entry("2026-08-01-regression")
        result = self.fixture.run_cli(
            "advance",
            "--reviewed-version",
            FORK_BASELINE_VERSION,
            "--reviewed-commit",
            FORK_BASELINE_COMMIT,
            "--date",
            "2026-08-01",
            "--ledger-entry",
            "2026-08-01-regression",
            "--task",
            ".trellis/tasks/08-01-regression",
        )

        self.assert_cli_error(result, "is not forward-only")

    def test_side_branch_is_rejected(self) -> None:
        target = self.fixture.prepare_target(parent=FORK_BASELINE_COMMIT)
        self.fixture.add_ledger_entry(NEXT_ENTRY)

        result = self.fixture.run_cli(*self.fixture.advance_args(target))

        self.assert_cli_error(result, "is not forward-only")

    def test_missing_commit_is_rejected(self) -> None:
        self.fixture.add_ledger_entry(NEXT_ENTRY)

        result = self.fixture.run_cli(*self.fixture.advance_args("a" * 40))

        self.assert_cli_error(result, "commit does not exist")

    def test_invalid_hash_is_rejected(self) -> None:
        self.fixture.add_ledger_entry(NEXT_ENTRY)

        result = self.fixture.run_cli(*self.fixture.advance_args("not-a-commit"))

        self.assert_cli_error(result, "full 40-character lowercase commit ID")

    def test_missing_ledger_marker_is_rejected(self) -> None:
        target = self.fixture.prepare_target()

        result = self.fixture.run_cli(*self.fixture.advance_args(target))

        self.assert_cli_error(result, "ledger must contain exactly one marker")

    def test_atomic_replace_failure_preserves_original_bytes(self) -> None:
        target = self.fixture.prepare_target()
        self.fixture.add_ledger_entry(NEXT_ENTRY)
        current = load_state(self.fixture.state_path)
        paths = checkpoint_store.RuntimePaths(
            self.fixture.repo,
            self.fixture.state_path,
            self.fixture.ledger_path,
        )
        validate_state(current, paths)
        candidate, is_noop = advance_state(
            current,
            paths,
            reviewed_version="v0.6.8",
            reviewed_commit=target,
            reviewed_on="2026-08-01",
            ledger_entry=NEXT_ENTRY,
            task=".trellis/tasks/08-01-sync-v0.6.8",
            local_commit=None,
            related_commits=(),
        )
        self.assertFalse(is_noop)
        original = self.fixture.state_path.read_bytes()

        with mock.patch.object(
            checkpoint_store.os, "replace", side_effect=OSError("simulated failure")
        ):
            with self.assertRaisesRegex(CheckpointError, "simulated failure"):
                write_state_atomic(self.fixture.state_path, candidate)

        self.assertEqual(self.fixture.state_path.read_bytes(), original)
        self.assertEqual(
            list(self.fixture.state_path.parent.glob(".sync-state.json.*.tmp")), []
        )

    def test_boolean_schema_version_is_rejected(self) -> None:
        raw = self.fixture.initial_state()
        raw["schema_version"] = True
        self.fixture.state_path.write_text(json.dumps(raw), encoding="utf-8")

        result = self.fixture.run_cli("validate")

        self.assert_cli_error(result, "schema_version must be 1")


if __name__ == "__main__":
    unittest.main()
