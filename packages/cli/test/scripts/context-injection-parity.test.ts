import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const TEMPLATE_ROOT = path.resolve(__dirname, "../../src/templates");

const pythonConfig = fs.readFileSync(
  path.join(TEMPLATE_ROOT, "suncode/scripts/common/config.py"),
  "utf-8",
);
const pythonHook = fs.readFileSync(
  path.join(TEMPLATE_ROOT, "shared-hooks/inject-subagent-context.py"),
  "utf-8",
);
const openCodeContext = fs.readFileSync(
  path.join(TEMPLATE_ROOT, "opencode/lib/suncode-context.js"),
  "utf-8",
);
const openCodeHook = fs.readFileSync(
  path.join(TEMPLATE_ROOT, "opencode/plugins/inject-subagent-context.js"),
  "utf-8",
);
const piExtension = fs.readFileSync(
  path.join(TEMPLATE_ROOT, "pi/extensions/suncode/index.ts.txt"),
  "utf-8",
);

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing section start: ${start}`).toBeGreaterThanOrEqual(
    0,
  );
  expect(endIndex, `missing section end: ${end}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function expectInOrder(source: string, tokens: string[]): void {
  let previous = -1;
  for (const token of tokens) {
    const current = source.indexOf(token, previous + 1);
    expect(current, `missing or out-of-order token: ${token}`).toBeGreaterThan(
      previous,
    );
    previous = current;
  }
}

describe("context injection cross-runtime parity", () => {
  it("keeps Python, OpenCode, and Pi on the same default byte budgets", () => {
    expect(pythonConfig).toContain(
      "DEFAULT_CONTEXT_INJECTION_MAX_FILE_BYTES = 32768",
    );
    expect(pythonConfig).toContain(
      "DEFAULT_CONTEXT_INJECTION_MAX_ARTIFACT_BYTES = 65536",
    );
    expect(pythonConfig).toContain(
      "DEFAULT_CONTEXT_INJECTION_MAX_TOTAL_BYTES = 131072",
    );

    for (const source of [openCodeContext, piExtension]) {
      expect(source).toContain("max_file_bytes: 32768");
      expect(source).toContain("max_artifact_bytes: 65536");
      expect(source).toContain("max_total_bytes: 131072");
    }
  });

  it("keeps truncation and non-inline notices aligned", () => {
    const sharedNoticeFragments = [
      "[Suncode: truncated at",
      "bytes — read",
      "for the full content]",
      "[Suncode: not inlined (binary file) —",
      "[Suncode: not inlined (total context limit reached) —",
      "[Suncode: total context limit reached — remaining context entries omitted]",
    ];

    for (const source of [pythonHook, openCodeContext, piExtension]) {
      for (const fragment of sharedNoticeFragments) {
        expect(source).toContain(fragment);
      }
    }
  });

  it("keeps JSONL context ahead of prd, design, and implementation artifacts", () => {
    const pythonTaskContext = section(
      pythonHook,
      "def _task_context(",
      "def get_implement_context(",
    );
    expectInOrder(pythonTaskContext, [
      "get_agent_context(",
      '("prd.md"',
      '("design.md"',
      '("implement.md"',
    ]);

    const openCodeImplementContext = section(
      openCodeHook,
      "function getImplementContext(",
      "function getCheckContext(",
    );
    expectInOrder(openCodeImplementContext, [
      "readJsonlWithFiles(",
      '["prd.md"',
      '["design.md"',
      '["implement.md"',
    ]);

    const piTaskContext = section(
      piExtension,
      "function buildContext(",
      "function normalizeAgent(",
    );
    expectInOrder(piTaskContext, [
      "readJsonlEntries(",
      "`${relTaskDir}/prd.md`",
      "`${relTaskDir}/design.md`",
      "`${relTaskDir}/implement.md`",
    ]);
  });
});
