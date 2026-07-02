import { execFileSync } from "node:child_process";

import { hashText } from "./hash.js";

export interface ReviewCodeSnapshot {
  diff: string;
  diffHash: string;
  headCommit?: string;
}

export function collectReviewCodeSnapshot(cwd: string): ReviewCodeSnapshot {
  const diff = [gitText(cwd, ["diff", "--binary"]), gitText(cwd, ["diff", "--cached", "--binary"])]
    .filter((part) => part.length > 0)
    .join("\n");
  const headCommit = gitText(cwd, ["rev-parse", "HEAD"]).trim() || undefined;
  return {
    diff,
    diffHash: hashText(diff),
    ...(headCommit ? { headCommit } : {}),
  };
}

export function snapshotsMatch(
  before: ReviewCodeSnapshot,
  after: ReviewCodeSnapshot,
): boolean {
  return before.diffHash === after.diffHash && before.headCommit === after.headCommit;
}

function gitText(cwd: string, args: readonly string[]): string {
  try {
    return execFileSync("git", [...args], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}
