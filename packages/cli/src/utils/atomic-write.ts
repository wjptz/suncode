import fs from "node:fs";
import path from "node:path";

/**
 * Write a file atomically by replacing it with a completed sibling temp file.
 * A failed write leaves the original file intact. Cleanup is best-effort so it
 * never hides the original write or rename error.
 */
export function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array,
): void {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);

  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, filePath);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // Best-effort cleanup; preserve the original failure.
    }
    throw error;
  }
}
