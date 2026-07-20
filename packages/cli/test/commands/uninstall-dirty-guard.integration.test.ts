import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import inquirer from "inquirer";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("figlet", () => ({
  default: { textSync: vi.fn(() => "SUNCODE") },
}));
vi.mock("inquirer", () => ({
  default: { prompt: vi.fn() },
}));

import { init } from "../../src/commands/init.js";
import {
  collectUncommittedSuncodeData,
  uninstall,
} from "../../src/commands/uninstall.js";

function has(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const canRun = has("git", ["--version"]) && has("python3", ["--version"]);

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = (): void => {};

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

describe.skipIf(!canRun)("uninstall uncommitted-data guard", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "suncode-dirty-")),
    );
    git(tmpDir, "init", "-q", "-b", "main");
    git(tmpDir, "config", "user.email", "test@example.com");
    git(tmpDir, "config", "user.name", "Test");
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "warn").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    vi.mocked(inquirer.prompt).mockResolvedValue({ proceed: true });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    delete process.env.SUNCODE_ALLOW_DIRTY_UNINSTALL;
    await init({ yes: true, claude: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.SUNCODE_ALLOW_DIRTY_UNINSTALL;
  });

  it("detects an uncommitted spec file", () => {
    git(tmpDir, "add", "-A");
    git(tmpDir, "commit", "-q", "-m", "suncode");
    const specFile = path.join(tmpDir, ".suncode", "spec", "my-rules.md");
    fs.mkdirSync(path.dirname(specFile), { recursive: true });
    fs.writeFileSync(specFile, "my custom spec");

    expect(
      collectUncommittedSuncodeData(tmpDir).some((filePath) =>
        filePath.includes("spec/my-rules.md"),
      ),
    ).toBe(true);
  });

  it("reports nothing after the Suncode tree is committed", () => {
    git(tmpDir, "add", "-A");
    git(tmpDir, "commit", "-q", "-m", "suncode");
    expect(collectUncommittedSuncodeData(tmpDir)).toEqual([]);
  });

  it("refuses --yes while user data is uncommitted", async () => {
    const specFile = path.join(tmpDir, ".suncode", "spec", "my-rules.md");
    fs.mkdirSync(path.dirname(specFile), { recursive: true });
    fs.writeFileSync(specFile, "unsaved work");
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code ?? 0})`);
      }) as never);

    await expect(uninstall({ yes: true })).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(fs.existsSync(specFile)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".suncode"))).toBe(true);
  });

  it("SUNCODE_ALLOW_DIRTY_UNINSTALL=1 explicitly overrides the guard", async () => {
    const specFile = path.join(tmpDir, ".suncode", "spec", "my-rules.md");
    fs.mkdirSync(path.dirname(specFile), { recursive: true });
    fs.writeFileSync(specFile, "unsaved work");
    process.env.SUNCODE_ALLOW_DIRTY_UNINSTALL = "1";

    await uninstall({ yes: true });

    expect(fs.existsSync(path.join(tmpDir, ".suncode"))).toBe(false);
  });

  it("committed user data does not block --yes uninstall", async () => {
    git(tmpDir, "add", "-A");
    git(tmpDir, "commit", "-q", "-m", "suncode");

    await uninstall({ yes: true });

    expect(fs.existsSync(path.join(tmpDir, ".suncode"))).toBe(false);
  });
});
