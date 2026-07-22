import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const downloadTemplateMock = vi.fn();
vi.mock("giget", () => ({
  downloadTemplate: (source: string, options: { dir: string }) =>
    downloadTemplateMock(source, options),
}));

import { downloadWithStrategy } from "../../src/utils/template-fetcher.js";

describe("downloadWithStrategy overwrite safety", () => {
  let tmpDir: string;
  let destDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-overwrite-"));
    destDir = path.join(tmpDir, ".suncode", "spec");
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, "user.md"), "MY OWN SPEC");
    vi.spyOn(os, "tmpdir").mockReturnValue(tmpDir);
    downloadTemplateMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("replaces the destination only after a successful download", async () => {
    downloadTemplateMock.mockImplementation(
      async (_source: string, options: { dir: string }) => {
        fs.mkdirSync(options.dir, { recursive: true });
        fs.writeFileSync(path.join(options.dir, "template.md"), "TEMPLATE");
      },
    );

    await expect(
      downloadWithStrategy("some/path", destDir, "overwrite"),
    ).resolves.toBe(true);
    expect(downloadTemplateMock.mock.calls[0]?.[1]).not.toHaveProperty(
      "preferOffline",
    );
    expect(fs.readFileSync(path.join(destDir, "template.md"), "utf-8")).toBe(
      "TEMPLATE",
    );
    expect(fs.existsSync(path.join(destDir, "user.md"))).toBe(false);
  });

  it("preserves the destination when the download fails", async () => {
    downloadTemplateMock.mockRejectedValue(new Error("download failed"));

    await expect(
      downloadWithStrategy("some/path", destDir, "overwrite"),
    ).rejects.toThrow("download failed");
    expect(fs.readFileSync(path.join(destDir, "user.md"), "utf-8")).toBe(
      "MY OWN SPEC",
    );
  });

  it("does not let temp cleanup failure mask a successful overwrite", async () => {
    downloadTemplateMock.mockImplementation(
      async (_source: string, options: { dir: string }) => {
        fs.mkdirSync(options.dir, { recursive: true });
        fs.writeFileSync(path.join(options.dir, "template.md"), "TEMPLATE");
      },
    );
    const realRm = fs.promises.rm.bind(fs.promises);
    vi.spyOn(fs.promises, "rm").mockImplementation(async (target, options) => {
      if (String(target).includes("suncode-template-")) {
        throw Object.assign(new Error("resource busy"), { code: "EBUSY" });
      }
      return realRm(target, options);
    });

    await expect(
      downloadWithStrategy("some/path", destDir, "overwrite"),
    ).resolves.toBe(true);
    expect(fs.readFileSync(path.join(destDir, "template.md"), "utf-8")).toBe(
      "TEMPLATE",
    );
  });

  it("uses network-first giget defaults for a fresh download", async () => {
    fs.rmSync(destDir, { recursive: true, force: true });
    downloadTemplateMock.mockImplementation(
      async (_source: string, options: { dir: string }) => {
        fs.mkdirSync(options.dir, { recursive: true });
        fs.writeFileSync(path.join(options.dir, "template.md"), "TEMPLATE");
      },
    );

    await expect(
      downloadWithStrategy("some/path", destDir, "skip"),
    ).resolves.toBe(true);
    expect(downloadTemplateMock.mock.calls[0]?.[1]).not.toHaveProperty(
      "preferOffline",
    );
  });

  it("uses network-first giget defaults for append", async () => {
    downloadTemplateMock.mockImplementation(
      async (_source: string, options: { dir: string }) => {
        fs.mkdirSync(options.dir, { recursive: true });
        fs.writeFileSync(path.join(options.dir, "template.md"), "TEMPLATE");
      },
    );

    await expect(
      downloadWithStrategy("some/path", destDir, "append"),
    ).resolves.toBe(true);
    expect(downloadTemplateMock.mock.calls[0]?.[1]).not.toHaveProperty(
      "preferOffline",
    );
    expect(fs.readFileSync(path.join(destDir, "user.md"), "utf-8")).toBe(
      "MY OWN SPEC",
    );
    expect(fs.readFileSync(path.join(destDir, "template.md"), "utf-8")).toBe(
      "TEMPLATE",
    );
  });
});
