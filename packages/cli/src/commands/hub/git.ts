import { execFileSync } from "node:child_process";

import type { HubGitCommitRecord } from "./types.js";

export function collectGitHeadCommit(cwd: string): string | undefined {
  return gitText(cwd, ["rev-parse", "HEAD"])?.trim() ?? undefined;
}

export function collectGitCommitRecords(
  cwd: string,
  baseCommit: string | undefined,
): HubGitCommitRecord[] {
  if (!baseCommit || !isAncestor(cwd, baseCommit)) return [];
  const output = gitText(cwd, [
    "log",
    "--reverse",
    "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%cI%x1f%s%x1e",
    `${baseCommit}..HEAD`,
  ]);
  if (!output) return [];

  return output
    .split("\x1e")
    .map(parseCommitRecord)
    .filter((record): record is HubGitCommitRecord => record !== undefined);
}

function isAncestor(cwd: string, baseCommit: string): boolean {
  return (
    gitText(cwd, ["merge-base", "--is-ancestor", baseCommit, "HEAD"]) !==
    undefined
  );
}

function parseCommitRecord(record: string): HubGitCommitRecord | undefined {
  const trimmed = record.trim();
  if (!trimmed) return undefined;
  const [
    sha,
    shortSha,
    authorName,
    authorEmail,
    authoredAt,
    committedAt,
    subject,
  ] = trimmed.split("\x1f");
  if (!sha || !shortSha || !subject) return undefined;
  return {
    sha,
    shortSha,
    subject,
    authorName: authorName ?? "",
    authorEmail: authorEmail ?? "",
    authoredAt: authoredAt ?? "",
    committedAt: committedAt ?? "",
  };
}

function gitText(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 1024 * 1024 * 5,
    });
  } catch {
    return undefined;
  }
}
