import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSharedHookScripts } from "../../src/templates/shared-hooks/index.js";
import { getAllScripts } from "../../src/templates/suncode/index.js";

const pythonCommand = process.platform === "win32" ? "python" : "python3";

describe("execution DAG runtime template", () => {
  let cwd: string;
  let taskDir: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "suncode-execution-"));
    for (const [relativePath, content] of getAllScripts()) {
      const target = path.join(cwd, ".suncode", "scripts", relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf-8");
    }
    taskDir = path.join(cwd, ".suncode", "tasks", "07-23-dag-test");
    fs.mkdirSync(taskDir, { recursive: true });
    writeJson(path.join(taskDir, "task.json"), {
      id: "dag-test",
      title: "DAG test",
      status: "in_progress",
    });
    fs.writeFileSync(path.join(taskDir, "prd.md"), "# DAG test\n", "utf-8");
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("validates a diamond graph and returns stable topological order", () => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {
        timeoutSeconds: 900,
        maxAttempts: 2,
        contextProfile: "implement",
      },
      nodes: [
        node("root"),
        node("left", { dependsOn: ["root"], writes: ["src/left/**"] }),
        node("right", { dependsOn: ["root"], writes: ["src/right/**"] }),
        node("integration", {
          role: "integration",
          dependsOn: ["left", "right"],
          writes: ["src/integration/**"],
          context: context("integration"),
        }),
      ],
      barriers: { final: ["integration"] },
    });

    const result = runTask(["execution", "validate", taskDir, "--json"]);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      valid: boolean;
      source: string;
      nodeCount: number;
      topologicalOrder: string[];
      finalBarrier: string[];
      planHash: string;
    };
    expect(payload).toMatchObject({
      valid: true,
      source: "execution.json",
      nodeCount: 4,
      topologicalOrder: ["root", "left", "right", "integration"],
      finalBarrier: ["integration"],
    });
    expect(payload.planHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    {
      name: "duplicate node id",
      nodes: [node("same"), node("same")],
      expected: "duplicate node id",
    },
    {
      name: "missing dependency",
      nodes: [node("only", { dependsOn: ["missing"] })],
      expected: "unknown node id 'missing'",
    },
    {
      name: "cycle",
      nodes: [
        node("one", { dependsOn: ["two"] }),
        node("two", { dependsOn: ["one"] }),
      ],
      expected: "dependency graph contains a cycle",
    },
    {
      name: "shared-worktree check writer",
      nodes: [
        node("review", {
          role: "check",
          writes: ["src/**"],
          context: context("check"),
        }),
      ],
      expected: "check nodes must be read-only",
    },
    {
      name: "final barrier that omits a branch",
      nodes: [node("omitted"), finalNode("barrier")],
      expected: "does not cover every execution branch",
    },
    {
      name: "Windows drive-relative scope",
      nodes: [finalNode("drive", { writes: ["C:src/**"] })],
      expected: "must be repository-relative",
    },
    {
      name: "case-insensitive duplicate scope",
      nodes: [finalNode("case", { writes: ["src/**", "SRC/**"] })],
      expected: "duplicate normalized scope",
    },
    {
      name: "unsupported recursive glob placement",
      nodes: [finalNode("glob", { writes: ["src/**suffix"] })],
      expected: "recursive glob '**' must occupy a complete path segment",
    },
    {
      name: "multiple final barriers that split branch coverage",
      nodes: [
        node("branch-a"),
        node("branch-b"),
        finalNode("final-a", { dependsOn: ["branch-a"] }),
        finalNode("final-b", { dependsOn: ["branch-b"] }),
      ],
      finals: ["final-a", "final-b"],
      expected: "does not cover every execution branch",
    },
  ])(
    "rejects $name with a located diagnostic",
    ({ nodes, finals, expected }) => {
      writeJson(path.join(taskDir, "execution.json"), {
        version: 1,
        task: "07-23-dag-test",
        defaults: {},
        nodes,
        barriers: { final: finals ?? [String(nodes.at(-1)?.id)] },
      });

      const result = runTask(["execution", "validate", taskDir, "--json"]);

      expect(result.status).toBe(1);
      const payload = JSON.parse(result.stdout) as {
        valid: boolean;
        error: string;
      };
      expect(payload.valid).toBe(false);
      expect(payload.error).toContain(expected);
      expect(payload.error).toContain("execution.json");
    },
  );

  it.each([
    { name: "boolean", literal: "true" },
    { name: "float", literal: "1.0" },
    { name: "string", literal: '"1"' },
  ])("rejects a $name execution plan version", ({ literal }) => {
    const serialized = JSON.stringify({
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [finalNode("typed-version")],
      barriers: { final: ["typed-version"] },
    }).replace('"version":1', `"version":${literal}`);
    fs.writeFileSync(
      path.join(taskDir, "execution.json"),
      `${serialized}\n`,
      "utf-8",
    );

    const result = runTask(["execution", "validate", taskDir, "--json"]);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).error).toContain(
      "execution.json.version: must equal 1",
    );
  });

  it("validates a 1,205-node serial DAG without recursive overflow", () => {
    const nodeCount = 1_205;
    const ids = Array.from(
      { length: nodeCount },
      (_, index) => `serial-${String(index).padStart(4, "0")}`,
    );
    const nodes = ids.map((id, index) => {
      const overrides = {
        dependsOn: index === 0 ? [] : [ids[index - 1]],
      };
      return index === ids.length - 1
        ? finalNode(id, overrides)
        : node(id, overrides);
    });
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes,
      barriers: { final: [ids.at(-1)] },
    });

    const result = runTask(["execution", "validate", taskDir, "--json"]);

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const order = JSON.parse(result.stdout).topologicalOrder as string[];
    expect(order).toHaveLength(nodeCount);
    expect(order[0]).toBe(ids[0]);
    expect(order.at(-1)).toBe(ids.at(-1));
  });

  it("reports a 1,205-node cycle without recursive overflow", () => {
    const nodeCount = 1_205;
    const ids = Array.from(
      { length: nodeCount },
      (_, index) => `cycle-${String(index).padStart(4, "0")}`,
    );
    const nodes = ids.map((id, index) => {
      const overrides = { dependsOn: [ids[(index + 1) % ids.length]] };
      return index === ids.length - 1
        ? finalNode(id, overrides)
        : node(id, overrides);
    });
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes,
      barriers: { final: [ids.at(-1)] },
    });

    const result = runTask(["execution", "validate", taskDir, "--json"]);

    expect(result.status).toBe(1);
    const error = JSON.parse(result.stdout).error as string;
    expect(error).toContain("dependency graph contains a cycle");
    expect(error).toContain(`${ids[0]} -> ${ids[1]}`);
  });

  it("does not hide a malformed explicit plan behind legacy fallback", () => {
    fs.writeFileSync(
      path.join(taskDir, "execution.json"),
      "{not-json",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(taskDir, "implement.md"),
      "- [ ] [P1] Legacy fallback: must not run\n",
      "utf-8",
    );

    const result = runTask([
      "execution",
      "validate",
      taskDir,
      "--allow-legacy",
      "--json",
    ]);

    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stdout) as {
      valid: boolean;
      error: string;
    };
    expect(payload.valid).toBe(false);
    expect(payload.error).toContain("invalid JSON");
  });

  it.each([
    {
      name: "implementation node",
      nodes: [node("implementation-final")],
      final: "implementation-final",
      expected: "must reference an integration or check node",
    },
    {
      name: "non-sink integration node",
      nodes: [
        finalNode("early-integration"),
        node("successor", { dependsOn: ["early-integration"] }),
      ],
      final: "early-integration",
      expected: "must reference a sink node",
    },
    {
      name: "writable worktree check node",
      nodes: [
        finalNode("writable-check", {
          role: "check",
          writes: ["src/generated/**"],
          context: context("check"),
          execution: {
            isolation: "worktree",
            allowed: ["native-subagent"],
            timeoutSeconds: 900,
            maxAttempts: 1,
            idempotent: false,
          },
        }),
      ],
      final: "writable-check",
      expected: "must reference a read-only check node without writes",
    },
    {
      name: "writable sandbox check node",
      nodes: [
        finalNode("writable-sandbox-check", {
          role: "check",
          writes: ["src/generated/**"],
          context: context("check"),
          execution: {
            isolation: "sandbox",
            allowed: ["native-subagent"],
            timeoutSeconds: 900,
            maxAttempts: 1,
            idempotent: false,
          },
        }),
      ],
      final: "writable-sandbox-check",
      expected: "must reference a read-only check node without writes",
    },
  ])(
    "rejects a final barrier with $name semantics",
    ({ nodes, final, expected }) => {
      writeJson(path.join(taskDir, "execution.json"), {
        version: 1,
        task: "07-23-dag-test",
        defaults: {},
        nodes,
        barriers: { final: [final] },
      });

      const result = runTask(["execution", "validate", taskDir, "--json"]);

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).error).toContain(expected);
    },
  );

  it("normalizes implement.md into a conservative serial graph", () => {
    fs.writeFileSync(
      path.join(taskDir, "implement.md"),
      [
        "# Implementation",
        "- [ ] [P1] Build model: Parse and validate the graph.",
        "- [ ] [P2] Run integration: Verify compatibility.",
        "",
      ].join("\n"),
      "utf-8",
    );

    const result = runTask(["execution", "show", taskDir, "--json"]);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      nodes: {
        id: string;
        priority: string;
        dependsOn: string[];
        writes: string[];
        metadata: { legacySource: string };
      }[];
      barriers: { final: string[] };
      metadata: { normalizedFrom: string; conservativeSerial: boolean };
    };
    expect(payload.nodes).toHaveLength(2);
    expect(payload.nodes[0]).toMatchObject({
      id: "build-model",
      priority: "P1",
      dependsOn: [],
      writes: ["**/*"],
      metadata: { legacySource: "implement.md" },
    });
    expect(payload.nodes[1]).toMatchObject({
      id: "run-integration",
      priority: "P2",
      dependsOn: ["build-model"],
    });
    expect(payload.barriers.final).toEqual(["run-integration"]);
    expect(payload.metadata).toEqual({
      normalizedFrom: "implement.md",
      conservativeSerial: true,
    });
  });

  it("scaffolds an explicit serial plan without overwriting by default", () => {
    fs.writeFileSync(
      path.join(taskDir, "implement.md"),
      "- [ ] [P1] Scaffold graph: Produce an explicit plan.\n",
      "utf-8",
    );

    const first = runTask(["execution", "scaffold", taskDir]);
    const second = runTask(["execution", "scaffold", taskDir]);
    const validate = runTask(["execution", "validate", taskDir, "--json"]);

    expect(first.status).toBe(0);
    expect(fs.existsSync(path.join(taskDir, "execution.json"))).toBe(true);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("already exists");
    expect(validate.status).toBe(0);
    expect(JSON.parse(validate.stdout)).toMatchObject({
      valid: true,
      source: "execution.json",
      nodeCount: 1,
    });
  });

  it("snapshots the DAG policy for new tasks and gates only new complex tasks", () => {
    fs.writeFileSync(
      path.join(cwd, ".suncode", "config.yaml"),
      [
        "execution:",
        "  dag:",
        "    enabled: true",
        "    require_for_complex_tasks: true",
        "    max_concurrency: 3",
        "",
      ].join("\n"),
      "utf-8",
    );

    const created = runTask([
      "create",
      "Policy task",
      "--slug",
      "policy-task",
      "--assignee",
      "tester",
      "--no-start",
    ]);
    expect(created.status, created.stderr).toBe(0);
    const createdName = fs
      .readdirSync(path.join(cwd, ".suncode", "tasks"))
      .find((entry) => entry.endsWith("policy-task"));
    expect(createdName).toBeDefined();
    const createdDir = path.join(
      cwd,
      ".suncode",
      "tasks",
      createdName as string,
    );
    const createdTask = JSON.parse(
      fs.readFileSync(path.join(createdDir, "task.json"), "utf-8"),
    ) as {
      meta: {
        execution: {
          policyVersion: number;
          dagEnabled: boolean;
          requireForComplexTasks: boolean;
        };
      };
    };
    expect(createdTask.meta.execution).toEqual({
      policyVersion: 1,
      dagEnabled: true,
      requireForComplexTasks: true,
    });

    fs.writeFileSync(path.join(createdDir, "design.md"), "# Design\n", "utf-8");
    fs.writeFileSync(
      path.join(createdDir, "implement.md"),
      "- [ ] [P1] Implement policy task: verify the DAG gate.\n",
      "utf-8",
    );
    const blocked = runTask(["start", createdDir]);
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain("requires an explicit execution.json");

    expect(runTask(["execution", "scaffold", createdDir]).status).toBe(0);
    const started = runTask(["start", createdDir]);
    expect(started.status, started.stderr).toBe(0);
    expect(
      JSON.parse(fs.readFileSync(path.join(createdDir, "task.json"), "utf-8")),
    ).toMatchObject({ status: "in_progress" });

    const runtime = runTask([
      "execution",
      "start-run",
      createdDir,
      "--executor",
      "channel",
      "--run-id",
      "configured-concurrency",
      "--json",
    ]);
    expect(runtime.status, runtime.stderr).toBe(0);
    expect(JSON.parse(runtime.stdout)).toMatchObject({
      executor: { maxConcurrency: 3 },
    });
  });

  it("keeps legacy tasks compatible while rejecting malformed explicit plans", () => {
    fs.writeFileSync(
      path.join(cwd, ".suncode", "config.yaml"),
      [
        "execution:",
        "  dag:",
        "    enabled: true",
        "    require_for_complex_tasks: true",
        "",
      ].join("\n"),
      "utf-8",
    );
    writeJson(path.join(taskDir, "task.json"), {
      id: "dag-test",
      title: "Legacy task",
      status: "planning",
      meta: {},
    });
    fs.writeFileSync(path.join(taskDir, "design.md"), "# Design\n", "utf-8");
    fs.writeFileSync(
      path.join(taskDir, "implement.md"),
      "- [ ] [P1] Legacy work: remain compatible.\n",
      "utf-8",
    );

    const legacyStart = runTask(["start", taskDir]);
    expect(legacyStart.status, legacyStart.stderr).toBe(0);

    const task = JSON.parse(
      fs.readFileSync(path.join(taskDir, "task.json"), "utf-8"),
    ) as Record<string, unknown>;
    task.status = "planning";
    writeJson(path.join(taskDir, "task.json"), task);
    fs.writeFileSync(
      path.join(taskDir, "execution.json"),
      "{bad-json",
      "utf-8",
    );
    const invalidStart = runTask(["start", taskDir]);
    expect(invalidStart.status).toBe(1);
    expect(invalidStart.stderr).toContain("execution plan is invalid");
    expect(invalidStart.stderr).toContain("invalid JSON");
  });

  it("disables the DAG runtime without deleting existing plans", () => {
    fs.writeFileSync(
      path.join(cwd, ".suncode", "config.yaml"),
      "execution:\n  dag:\n    enabled: false\n",
      "utf-8",
    );
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [node("disabled")],
      barriers: { final: ["disabled"] },
    });

    const result = runTask([
      "execution",
      "start-run",
      taskDir,
      "--run-id",
      "disabled-run",
      "--json",
    ]);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).error).toContain(
      "execution DAG is disabled",
    );
    expect(fs.existsSync(path.join(taskDir, "execution.json"))).toBe(true);
  });

  it("requires the task lifecycle to be in progress before starting a run", () => {
    writeJson(path.join(taskDir, "task.json"), {
      id: "dag-test",
      title: "DAG test",
      status: "planning",
    });
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [finalNode("lifecycle-gate")],
      barriers: { final: ["lifecycle-gate"] },
    });

    const result = runTask([
      "execution",
      "start-run",
      taskDir,
      "--run-id",
      "planning-run",
      "--json",
    ]);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).error).toContain(
      "task.json.status == 'in_progress'",
    );
  });

  it("rejects an execution plan whose task does not match its directory", () => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "different-task",
      defaults: {},
      nodes: [finalNode("identity-gate")],
      barriers: { final: ["identity-gate"] },
    });

    const result = runTask([
      "execution",
      "start-run",
      taskDir,
      "--run-id",
      "mismatched-task-run",
      "--json",
    ]);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).error).toContain(
      "execution.json.task: must match task directory '07-23-dag-test'",
    );
    expect(
      fs.existsSync(
        path.join(cwd, ".suncode", ".runtime", "execution", "07-23-dag-test"),
      ),
    ).toBe(false);
  });

  it("fans out all safe ready nodes before wait and reaches the final barrier", () => {
    writeJson(path.join(taskDir, "execution.json"), diamondPlan());

    const start = runTask([
      "execution",
      "start-run",
      taskDir,
      "--executor",
      "channel",
      "--max-concurrency",
      "4",
      "--run-id",
      "fanout-run",
      "--json",
    ]);
    expect(start.status).toBe(0);

    expect(
      readyIds(runTask(["execution", "ready", taskDir, "--json"])),
    ).toEqual(["root"]);
    const rootClaim = runTask([
      "execution",
      "claim",
      taskDir,
      "root",
      "--json",
    ]);
    expect(rootClaim.status).toBe(0);
    expect(JSON.parse(rootClaim.stdout).dispatch.channelArgs).toEqual([
      "--context-file",
      expect.stringMatching(/manifest\.json$/),
      "--context-file",
      expect.stringMatching(/content\.md$/),
    ]);
    expect(
      runTask(["execution", "running", taskDir, "root", "--json"]).status,
    ).toBe(0);
    complete(
      "root",
      1,
      "succeeded",
      [
        {
          path: "src/root/model.ts",
          kind: "modified",
        },
      ],
      "fanout-run",
      ["token=root-dependency-secret"],
    );

    expect(
      readyIds(runTask(["execution", "ready", taskDir, "--json"])),
    ).toEqual(["left", "right"]);
    const leftClaim = runTask([
      "execution",
      "claim",
      taskDir,
      "left",
      "--json",
    ]);
    expect(leftClaim.status).toBe(0);
    const leftDispatch = JSON.parse(leftClaim.stdout).dispatch as {
      manifestPath: string;
      contentPath: string;
    };
    const leftManifest = JSON.parse(
      fs.readFileSync(leftDispatch.manifestPath, "utf-8"),
    ) as {
      dependencies: { redacted: boolean; includedBytes: number }[];
    };
    const leftContent = fs.readFileSync(leftDispatch.contentPath, "utf-8");
    expect(leftManifest.dependencies[0]).toMatchObject({ redacted: true });
    expect(leftManifest.dependencies[0].includedBytes).toBeLessThanOrEqual(
      65_536,
    );
    expect(leftContent).not.toContain("root-dependency-secret");
    expect(leftContent).toContain("[REDACTED]");
    expect(
      runTask(["execution", "claim", taskDir, "right", "--json"]).status,
    ).toBe(0);
    complete("right", 1, "succeeded");
    expect(
      readyIds(runTask(["execution", "ready", taskDir, "--json"])),
    ).toEqual([]);
    complete("left", 1, "succeeded");

    expect(
      readyIds(runTask(["execution", "ready", taskDir, "--json"])),
    ).toEqual(["integration"]);
    expect(
      runTask(["execution", "claim", taskDir, "integration", "--json"]).status,
    ).toBe(0);
    complete("integration", 1, "succeeded");

    const status = runTask(["execution", "status", taskDir, "--json"]);
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      runId: "fanout-run",
      status: "succeeded",
      nodes: {
        root: { status: "succeeded" },
        left: { status: "succeeded" },
        right: { status: "succeeded" },
        integration: { status: "succeeded" },
      },
    });
  });

  it("lets two claimed safe siblings overlap before either result completes", async () => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [
        node("left", { reads: ["src/base/**"], writes: ["src/left/**"] }),
        node("right", { reads: ["src/base/**"], writes: ["src/right/**"] }),
        node("integration", {
          role: "integration",
          dependsOn: ["left", "right"],
          writes: ["src/integration/**"],
          context: context("integration"),
        }),
      ],
      barriers: { final: ["integration"] },
    });
    expect(
      runTask([
        "execution",
        "start-run",
        taskDir,
        "--executor",
        "channel",
        "--max-concurrency",
        "2",
        "--run-id",
        "overlap-run",
        "--json",
      ]).status,
    ).toBe(0);
    expect(
      readyIds(runTask(["execution", "ready", taskDir, "--json"])),
    ).toEqual(["left", "right"]);
    expect(
      runTask(["execution", "claim", taskDir, "left", "--json"]).status,
    ).toBe(0);
    expect(
      runTask(["execution", "claim", taskDir, "right", "--json"]).status,
    ).toBe(0);

    const barrierDir = path.join(cwd, "overlap-barrier");
    fs.mkdirSync(barrierDir);
    const left = runOverlapWorker(
      path.join(barrierDir, "left.started"),
      path.join(barrierDir, "right.started"),
      path.join(barrierDir, "left.finished"),
    );
    const right = runOverlapWorker(
      path.join(barrierDir, "right.started"),
      path.join(barrierDir, "left.started"),
      path.join(barrierDir, "right.finished"),
    );

    await expect(Promise.all([left, right])).resolves.toEqual([0, 0]);
    expect(fs.existsSync(path.join(barrierDir, "left.finished"))).toBe(true);
    expect(fs.existsSync(path.join(barrierDir, "right.finished"))).toBe(true);
  });

  it("serializes ready nodes when read/write scopes or resources may conflict", () => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [
        node("writer", {
          reads: [],
          writes: ["src/shared/**"],
          resources: ["database-schema"],
        }),
        node("reader", {
          reads: ["src/shared/model.ts"],
          writes: [],
          resources: [],
        }),
        node("other", {
          reads: [],
          writes: ["src/other/**"],
          resources: ["database-schema"],
        }),
        finalNode("integration", {
          dependsOn: ["writer", "reader", "other"],
          reads: ["src/**"],
          writes: [],
          resources: [],
        }),
      ],
      barriers: { final: ["integration"] },
    });
    expect(
      runTask([
        "execution",
        "start-run",
        taskDir,
        "--executor",
        "channel",
        "--max-concurrency",
        "4",
        "--run-id",
        "conflict-run",
        "--json",
      ]).status,
    ).toBe(0);

    const ready = runTask(["execution", "ready", taskDir, "--json"]);
    expect(readyIds(ready)).toEqual(["writer"]);
  });

  it("canonicalizes equivalent scopes and never schedules them together", () => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [
        node("dot", { writes: ["./src//shared/**"] }),
        node("plain", { writes: ["SRC\\shared\\**"] }),
        node("root-scope", { writes: ["."] }),
        finalNode("integration", {
          dependsOn: ["dot", "plain", "root-scope"],
          writes: [],
          resources: [],
        }),
      ],
      barriers: { final: ["integration"] },
    });

    const shown = runTask(["execution", "show", taskDir, "--json"]);
    expect(shown.status).toBe(0);
    expect(JSON.parse(shown.stdout).nodes[0].writes).toEqual(["src/shared/**"]);

    expect(
      runTask([
        "execution",
        "start-run",
        taskDir,
        "--executor",
        "channel",
        "--max-concurrency",
        "2",
        "--run-id",
        "normalized-scope-run",
        "--json",
      ]).status,
    ).toBe(0);
    expect(
      readyIds(runTask(["execution", "ready", taskDir, "--json"])),
    ).toEqual(["dot"]);
  });

  it("builds an auditable context manifest and redacts sensitive content", () => {
    fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, "docs", "node-context.md"),
      "Design note\ntoken=super-secret-value\n",
      "utf-8",
    );
    fs.writeFileSync(path.join(cwd, ".env"), "PASSWORD=do-not-read\n", "utf-8");
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [
        finalNode("context-node", {
          context: {
            profile: "implement",
            include: ["prd", "docs/node-context.md", ".env"],
            dependencyResults: "none",
            maxBytes: 32_768,
            perSourceBytes: 8_192,
          },
        }),
      ],
      barriers: { final: ["context-node"] },
    });
    expect(
      runTask([
        "execution",
        "start-run",
        taskDir,
        "--executor",
        "native-subagent",
        "--run-id",
        "context-run",
        "--parent-session",
        "parent-123",
        "--json",
      ]).status,
    ).toBe(0);

    const claim = runTask([
      "execution",
      "claim",
      taskDir,
      "context-node",
      "--json",
    ]);
    expect(claim.status).toBe(0);
    const dispatch = JSON.parse(claim.stdout).dispatch as {
      forkTurns: string;
      role: string;
      name: string;
      contextProfile: string;
      isolation: string;
      manifestPath: string;
      manifestRef: string;
      contentPath: string;
      prompt: string;
    };
    expect(dispatch.forkTurns).toBe("none");
    expect(dispatch).toMatchObject({
      role: "integration",
      name: "context-node",
      contextProfile: "implement",
      isolation: "shared-worktree",
    });
    expect(dispatch.prompt.split("\n").slice(0, 2)).toEqual([
      "Active task: .suncode/tasks/07-23-dag-test",
      `Suncode context manifest: ${dispatch.manifestRef}`,
    ]);
    const manifest = JSON.parse(
      fs.readFileSync(dispatch.manifestPath, "utf-8"),
    ) as {
      task: { id: string; path: string; planVersion: number; planHash: string };
      run: { parentSession: string };
      execution: {
        allowed: string[];
        isolation: string;
        timeoutSeconds: number;
        maxAttempts: number;
        idempotent: boolean;
      };
      sources: { path: string; redacted: boolean }[];
      budget: { usedBytes: number; totalBytes: number };
      content: { path: string; sha256: string };
      manifestHash: string;
    };
    const contentBytes = fs.readFileSync(dispatch.contentPath);
    const content = contentBytes.toString("utf-8");
    expect(manifest.task).toMatchObject({
      id: "07-23-dag-test",
      path: ".suncode/tasks/07-23-dag-test",
      planVersion: 1,
    });
    expect(manifest.run.parentSession).toBe("parent-123");
    expect(manifest.execution).toEqual({
      allowed: ["inline", "native-subagent", "channel"],
      isolation: "shared-worktree",
      timeoutSeconds: 900,
      maxAttempts: 2,
      idempotent: true,
    });
    expect(
      manifest.sources.find((source) => source.path === ".env"),
    ).toMatchObject({
      redacted: true,
    });
    expect(content).toContain("token=[REDACTED]");
    expect(content).not.toContain("super-secret-value");
    expect(content).not.toContain("do-not-read");
    expect(content).toContain("Execution plan version: 1");
    expect(content).toContain(
      "Allowed executors: inline, native-subagent, channel",
    );
    expect(content).toContain("Isolation: shared-worktree");
    expect(content).toContain("Timeout: 900 seconds");
    expect(content).toContain("Maximum attempts: 2");
    expect(content).toContain("Idempotent: yes");
    expect(manifest.budget.usedBytes).toBeLessThanOrEqual(
      manifest.budget.totalBytes,
    );
    expect(manifest.budget.usedBytes).toBe(contentBytes.byteLength);
    expect(createHash("sha256").update(contentBytes).digest("hex")).toBe(
      manifest.content.sha256,
    );
    expect(manifest.manifestHash).toMatch(/^[a-f0-9]{64}$/);

    const pulled = runTask(["execution", "context", dispatch.manifestRef]);
    expect(pulled.status).toBe(0);
    expect(pulled.stdout).toContain("# Suncode execution node");
    expect(pulled.stdout).not.toContain("super-secret-value");

    fs.mkdirSync(path.join(cwd, ".git"));
    const hook = getSharedHookScripts().find(
      (candidate) => candidate.name === "inject-subagent-context.py",
    );
    expect(hook).toBeDefined();
    const hookPath = path.join(
      cwd,
      ".claude",
      "hooks",
      "inject-subagent-context.py",
    );
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, hook?.content ?? "", "utf-8");
    const hookRun = spawnSync(pythonCommand, [hookPath], {
      cwd,
      encoding: "utf-8",
      input: JSON.stringify({
        cwd,
        tool_name: "Task",
        tool_input: {
          subagent_type: "suncode-implement",
          prompt: dispatch.prompt,
        },
      }),
    });
    expect(hookRun.status, hookRun.stderr).toBe(0);
    const injected = JSON.parse(hookRun.stdout) as {
      hookSpecificOutput: { updatedInput: { prompt: string } };
    };
    expect(injected.hookSpecificOutput.updatedInput.prompt).toContain(
      "# Suncode Execution Node",
    );
    expect(injected.hookSpecificOutput.updatedInput.prompt).not.toContain(
      "super-secret-value",
    );
  });

  it("writes immutable context bytes without platform newline translation", () => {
    const scriptRoot = path.join(cwd, ".suncode", "scripts");
    const target = path.join(cwd, "atomic-context.md");
    const probe = [
      "from pathlib import Path",
      "import sys",
      `sys.path.insert(0, ${JSON.stringify(scriptRoot)})`,
      "from common import execution_context",
      "real_fdopen = execution_context.os.fdopen",
      "def windows_text_fdopen(fd, mode, **kwargs):",
      "    if 'b' not in mode and 'newline' not in kwargs:",
      "        kwargs['newline'] = '\\r\\n'",
      "    return real_fdopen(fd, mode, **kwargs)",
      "execution_context.os.fdopen = windows_text_fdopen",
      "value = 'alpha\\nbeta\\n'",
      "target = Path(sys.argv[1])",
      "execution_context._write_text_atomic(target, value)",
      "actual = target.read_bytes()",
      "expected = value.encode('utf-8')",
      "assert actual == expected, (actual, expected)",
    ].join("\n");

    const result = spawnSync(pythonCommand, ["-c", probe, target], {
      cwd,
      encoding: "utf-8",
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(fs.readFileSync(target)).toEqual(
      Buffer.from("alpha\nbeta\n", "utf-8"),
    );
  });

  it.each([
    { name: "boolean", literal: "true" },
    { name: "float", literal: "1.0" },
    { name: "string", literal: '"1"' },
  ])("rejects a context manifest with a $name version", ({ name, literal }) => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [finalNode("manifest-version")],
      barriers: { final: ["manifest-version"] },
    });
    const runId = `manifest-version-${name}`;
    expect(
      runTask([
        "execution",
        "start-run",
        taskDir,
        "--executor",
        "native-subagent",
        "--run-id",
        runId,
        "--json",
      ]).status,
    ).toBe(0);
    const claim = runTask([
      "execution",
      "claim",
      taskDir,
      "manifest-version",
      "--run-id",
      runId,
      "--json",
    ]);
    expect(claim.status).toBe(0);
    const dispatch = JSON.parse(claim.stdout).dispatch as {
      manifestPath: string;
      manifestRef: string;
    };
    const original = fs.readFileSync(dispatch.manifestPath, "utf-8");
    const tampered = original.replace('"version": 1', `"version": ${literal}`);
    expect(tampered).not.toBe(original);
    fs.writeFileSync(dispatch.manifestPath, tampered, "utf-8");

    const pulled = runTask([
      "execution",
      "context",
      dispatch.manifestRef,
      "--json",
    ]);

    expect(pulled.status).toBe(1);
    expect(JSON.parse(pulled.stdout).error).toContain(
      "context manifest version must equal 1",
    );
  });

  it("keeps live workers active unless the coordinator explicitly forces orphaning", () => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [finalNode("orphan")],
      barriers: { final: ["orphan"] },
    });
    expect(
      runTask([
        "execution",
        "start-run",
        taskDir,
        "--executor",
        "channel",
        "--run-id",
        "recovery-run",
        "--json",
      ]).status,
    ).toBe(0);
    expect(
      runTask(["execution", "claim", taskDir, "orphan", "--json"]).status,
    ).toBe(0);
    expect(
      runTask(["execution", "running", taskDir, "orphan", "--json"]).status,
    ).toBe(0);

    const recovered = runTask(["execution", "recover", taskDir, "--json"]);
    expect(recovered.status).toBe(0);
    expect(JSON.parse(recovered.stdout)).toMatchObject({
      actions: [
        "left orphan attempt 1 active; executor liveness is unconfirmed",
      ],
    });
    expect(
      readyIds(runTask(["execution", "ready", taskDir, "--json"])),
    ).toEqual([]);

    const forced = runTask([
      "execution",
      "recover",
      taskDir,
      "--force-orphan",
      "orphan",
      "--json",
    ]);
    expect(forced.status).toBe(0);
    expect(JSON.parse(forced.stdout)).toMatchObject({
      actions: [
        "marked orphan attempt 1 orphaned",
        "scheduled idempotent retry for orphan",
      ],
    });
    expect(
      readyIds(runTask(["execution", "ready", taskDir, "--json"])),
    ).toEqual(["orphan"]);

    const plan = diamondPlan();
    writeJson(path.join(taskDir, "execution.json"), plan);
    const drift = runTask(["execution", "recover", taskDir, "--json"]);
    expect(drift.status).toBe(1);
    expect(JSON.parse(drift.stdout).error).toContain("plan changed");
  });

  it("reconciles an already-persisted result before applying force-orphan", () => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [finalNode("result-wins")],
      barriers: { final: ["result-wins"] },
    });
    const started = runTask([
      "execution",
      "start-run",
      taskDir,
      "--executor",
      "channel",
      "--run-id",
      "result-wins-run",
      "--json",
    ]);
    expect(started.status).toBe(0);
    expect(
      runTask(["execution", "claim", taskDir, "result-wins", "--json"]).status,
    ).toBe(0);
    const runtimePath = JSON.parse(started.stdout).runtimePath as string;
    writeJson(path.join(runtimePath, "results", "result-wins", "1.json"), {
      version: 1,
      taskId: "07-23-dag-test",
      runId: "result-wins-run",
      nodeId: "result-wins",
      attempt: 1,
      status: "succeeded",
      summary: "persisted result wins",
      changes: [],
      findings: [],
      validation: [
        {
          command: "validate result-wins",
          status: "passed",
          evidence: "persisted before recovery",
        },
      ],
      artifacts: [],
      risks: [],
    });

    const recovered = runTask([
      "execution",
      "recover",
      taskDir,
      "--force-orphan",
      "result-wins",
      "--json",
    ]);
    expect(recovered.status, recovered.stderr || recovered.stdout).toBe(0);
    expect(JSON.parse(recovered.stdout)).toMatchObject({
      status: "succeeded",
      actions: ["reconciled result for result-wins attempt 1"],
    });
  });

  it("keeps a forced non-idempotent orphan terminal until explicit retry", () => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [
        finalNode("non-idempotent", {
          execution: {
            isolation: "shared-worktree",
            allowed: ["inline", "native-subagent", "channel"],
            timeoutSeconds: 900,
            maxAttempts: 2,
            idempotent: false,
          },
        }),
      ],
      barriers: { final: ["non-idempotent"] },
    });
    expect(
      runTask([
        "execution",
        "start-run",
        taskDir,
        "--executor",
        "channel",
        "--run-id",
        "non-idempotent-run",
        "--json",
      ]).status,
    ).toBe(0);
    expect(
      runTask(["execution", "claim", taskDir, "non-idempotent", "--json"])
        .status,
    ).toBe(0);
    expect(
      runTask(["execution", "running", taskDir, "non-idempotent", "--json"])
        .status,
    ).toBe(0);

    const forced = runTask([
      "execution",
      "recover",
      taskDir,
      "--force-orphan",
      "non-idempotent",
      "--json",
    ]);
    expect(forced.status).toBe(0);
    expect(JSON.parse(forced.stdout).actions).toEqual([
      "marked non-idempotent attempt 1 orphaned",
    ]);
    expect(
      JSON.parse(runTask(["execution", "status", taskDir, "--json"]).stdout)
        .nodes["non-idempotent"].status,
    ).toBe("orphaned");

    const retried = runTask([
      "execution",
      "recover",
      taskDir,
      "--retry",
      "non-idempotent",
      "--json",
    ]);
    expect(retried.status).toBe(0);
    expect(
      readyIds(runTask(["execution", "ready", taskDir, "--json"])),
    ).toEqual(["non-idempotent"]);
  });

  it("recursively unlocks blocked descendants after an explicit dependency retry", () => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [
        node("parent", {
          execution: {
            isolation: "shared-worktree",
            allowed: ["inline", "native-subagent", "channel"],
            timeoutSeconds: 900,
            maxAttempts: 2,
            idempotent: false,
          },
        }),
        node("child", { dependsOn: ["parent"] }),
        node("grandchild", { dependsOn: ["child"] }),
        finalNode("integration", {
          dependsOn: ["grandchild"],
          writes: [],
          resources: [],
        }),
      ],
      barriers: { final: ["integration"] },
    });
    expect(
      runTask([
        "execution",
        "start-run",
        taskDir,
        "--executor",
        "channel",
        "--run-id",
        "retry-run",
        "--json",
      ]).status,
    ).toBe(0);
    expect(
      runTask(["execution", "claim", taskDir, "parent", "--json"]).status,
    ).toBe(0);
    complete("parent", 1, "failed", [], "retry-run");
    expect(
      JSON.parse(runTask(["execution", "status", taskDir, "--json"]).stdout)
        .nodes,
    ).toMatchObject({
      child: { status: "blocked" },
      grandchild: { status: "blocked" },
      integration: { status: "blocked" },
    });

    const retried = runTask([
      "execution",
      "recover",
      taskDir,
      "--retry",
      "parent",
      "--json",
    ]);
    expect(retried.status).toBe(0);
    expect(
      JSON.parse(runTask(["execution", "status", taskDir, "--json"]).stdout)
        .nodes,
    ).toMatchObject({
      parent: { status: "ready" },
      child: { status: "pending" },
      grandchild: { status: "pending" },
      integration: { status: "pending" },
    });

    expect(
      runTask(["execution", "claim", taskDir, "parent", "--json"]).status,
    ).toBe(0);
    complete("parent", 2, "succeeded", [], "retry-run");
    expect(
      readyIds(runTask(["execution", "ready", taskDir, "--json"])),
    ).toEqual(["child"]);
  });

  it("rejects succeeded results without complete passing evidence or within-scope outputs", () => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [finalNode("guarded", { writes: ["src/allowed/**"] })],
      barriers: { final: ["guarded"] },
    });
    expect(
      runTask([
        "execution",
        "start-run",
        taskDir,
        "--executor",
        "channel",
        "--run-id",
        "result-gate-run",
        "--json",
      ]).status,
    ).toBe(0);
    expect(
      runTask(["execution", "claim", taskDir, "guarded", "--json"]).status,
    ).toBe(0);

    const baseResult = {
      version: 1,
      taskId: "07-23-dag-test",
      runId: "result-gate-run",
      nodeId: "guarded",
      attempt: 1,
      status: "succeeded",
      summary: "guarded succeeded",
      changes: [],
      findings: [],
      validation: [
        {
          command: "validate guarded",
          status: "passed",
          evidence: "test passed",
        },
      ],
      artifacts: [],
      risks: [],
    };
    const invalidResults = [
      { ...baseResult, validation: [] },
      {
        ...baseResult,
        validation: [
          { command: "validate guarded", status: "failed", evidence: "failed" },
        ],
      },
      {
        ...baseResult,
        validation: [
          {
            command: "validate guarded",
            status: "unknown",
            evidence: "unknown",
          },
        ],
      },
      {
        ...baseResult,
        validation: [
          {
            command: "undeclared validation",
            status: "passed",
            evidence: "passed",
          },
        ],
      },
      {
        ...baseResult,
        validation: [{ command: "validate guarded", status: "passed" }],
      },
      {
        ...baseResult,
        validation: [
          {
            command: "validate guarded",
            status: "passed",
            evidence: "first",
          },
          {
            command: "validate guarded",
            status: "passed",
            evidence: "duplicate",
          },
        ],
      },
      {
        ...baseResult,
        changes: [{ path: "src/forbidden/file.py", kind: "modified" }],
      },
      {
        ...baseResult,
        changes: [{ path: ".", kind: "modified" }],
      },
      {
        ...baseResult,
        artifacts: [{ name: "report", path: "reports/result.txt" }],
      },
    ];
    for (const [index, invalidResult] of invalidResults.entries()) {
      const submitted = submitResult(
        "guarded",
        invalidResult,
        `invalid-${index}`,
      );
      expect(submitted.status).toBe(1);
    }

    const invalidIntegerIdentity = [
      { field: "version", name: "boolean", literal: "true" },
      { field: "version", name: "float", literal: "1.0" },
      { field: "version", name: "string", literal: '"1"' },
      { field: "attempt", name: "boolean", literal: "true" },
      { field: "attempt", name: "float", literal: "1.0" },
      { field: "attempt", name: "string", literal: '"1"' },
    ];
    for (const { field, name, literal } of invalidIntegerIdentity) {
      const rawResult = JSON.stringify(baseResult).replace(
        `"${field}":1`,
        `"${field}":${literal}`,
      );
      const submitted = submitRawResult(
        "guarded",
        rawResult,
        `invalid-${field}-${name}`,
      );
      expect(submitted.status).toBe(1);
      expect(JSON.parse(submitted.stdout).error).toContain(
        `node result ${field} must equal 1`,
      );
    }

    const malformedNestedResults = [
      {
        name: "unknown-change-field",
        result: {
          ...baseResult,
          changes: [
            {
              path: "src/allowed/file.py",
              kind: "modified",
              detail: "unexpected",
            },
          ],
        },
        expected: "changes[0] has unknown field(s): detail",
      },
      {
        name: "finding-location-type",
        result: {
          ...baseResult,
          findings: [
            {
              severity: "warning",
              location: { path: "src/allowed/file.py" },
              message: "invalid optional field",
            },
          ],
        },
        expected: "findings[0].location must be a string",
      },
      {
        name: "unknown-finding-field",
        result: {
          ...baseResult,
          findings: [
            {
              severity: "warning",
              message: "unknown field",
              code: "W001",
            },
          ],
        },
        expected: "findings[0] has unknown field(s): code",
      },
      {
        name: "validation-evidence-type",
        result: {
          ...baseResult,
          validation: [
            {
              command: "validate guarded",
              status: "passed",
              evidence: { log: "passed" },
            },
          ],
        },
        expected: "validation[0].evidence must be a string",
      },
      {
        name: "unknown-validation-field",
        result: {
          ...baseResult,
          validation: [
            {
              command: "validate guarded",
              status: "passed",
              evidence: "passed",
              durationMs: "10",
            },
          ],
        },
        expected: "validation[0] has unknown field(s): durationMs",
      },
      {
        name: "artifact-hash-type",
        result: {
          ...baseResult,
          artifacts: [
            {
              name: "report",
              path: "artifacts/guarded/report.txt",
              hash: { sha256: "abc" },
            },
          ],
        },
        expected: "artifacts[0].hash must be a string",
      },
      {
        name: "unknown-artifact-field",
        result: {
          ...baseResult,
          artifacts: [
            {
              name: "report",
              path: "artifacts/guarded/report.txt",
              size: "10",
            },
          ],
        },
        expected: "artifacts[0] has unknown field(s): size",
      },
    ];
    for (const { name, result, expected } of malformedNestedResults) {
      const submitted = submitResult("guarded", result, name);
      expect(submitted.status).toBe(1);
      expect(JSON.parse(submitted.stdout).error).toContain(expected);
    }

    const caseMismatch = submitResult(
      "guarded",
      {
        ...baseResult,
        changes: [{ path: "SRC/ALLOWED/escape.py", kind: "modified" }],
      },
      "case-mismatch",
    );
    expect(caseMismatch.status).toBe(1);
    expect(JSON.parse(caseMismatch.stdout).error).toContain(
      "outside node 'guarded' writes",
    );

    const accepted = submitResult(
      "guarded",
      {
        ...baseResult,
        changes: [{ path: "./src/allowed/result.py", kind: "modified" }],
        findings: [
          {
            severity: "info",
            location: "src/allowed/result.py",
            message: "validated optional finding fields",
          },
        ],
        artifacts: [
          {
            name: "report",
            path: "artifacts/guarded/report.txt",
            hash: "sha256:abc",
          },
        ],
      },
      "valid",
    );
    expect(accepted.status, accepted.stderr || accepted.stdout).toBe(0);
    expect(JSON.parse(accepted.stdout).nodeStatus).toBe("succeeded");
  });

  it("matches deep concrete change paths without recursive overflow", () => {
    const deepPath = [
      "src",
      ...Array.from({ length: 1_200 }, () => "x"),
      "result.py",
    ].join("/");
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [finalNode("deep-path", { writes: ["src/**"] })],
      barriers: { final: ["deep-path"] },
    });
    expect(
      runTask([
        "execution",
        "start-run",
        taskDir,
        "--executor",
        "channel",
        "--run-id",
        "deep-path-run",
        "--json",
      ]).status,
    ).toBe(0);
    expect(
      runTask(["execution", "claim", taskDir, "deep-path", "--json"]).status,
    ).toBe(0);

    const submitted = submitResult("deep-path", {
      version: 1,
      taskId: "07-23-dag-test",
      runId: "deep-path-run",
      nodeId: "deep-path",
      attempt: 1,
      status: "succeeded",
      summary: "deep path succeeded",
      changes: [{ path: deepPath, kind: "modified" }],
      findings: [],
      validation: [
        {
          command: "validate deep-path",
          status: "passed",
          evidence: "test passed",
        },
      ],
      artifacts: [],
      risks: [],
    });
    expect(submitted.status, submitted.stderr || submitted.stdout).toBe(0);
    expect(JSON.parse(submitted.stdout).result.changes).toEqual([
      { path: deepPath, kind: "modified" },
    ]);
  });

  it("rejects changes reported by a read-only final check", () => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [
        finalNode("readonly", {
          role: "check",
          reads: ["src/**"],
          writes: [],
          context: context("check"),
        }),
      ],
      barriers: { final: ["readonly"] },
    });
    expect(
      runTask([
        "execution",
        "start-run",
        taskDir,
        "--executor",
        "channel",
        "--run-id",
        "readonly-run",
        "--json",
      ]).status,
    ).toBe(0);
    expect(
      runTask(["execution", "claim", taskDir, "readonly", "--json"]).status,
    ).toBe(0);

    const submitted = submitResult("readonly", {
      version: 1,
      taskId: "07-23-dag-test",
      runId: "readonly-run",
      nodeId: "readonly",
      attempt: 1,
      status: "succeeded",
      summary: "readonly succeeded",
      changes: [{ path: "src/changed.ts", kind: "modified" }],
      findings: [],
      validation: [
        {
          command: "validate readonly",
          status: "passed",
          evidence: "test passed",
        },
      ],
      artifacts: [],
      risks: [],
    });
    expect(submitted.status).toBe(1);
    expect(JSON.parse(submitted.stdout).error).toContain(
      "outside node 'readonly' writes",
    );
  });

  it("keeps a worker-reported blocked result terminal", () => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [finalNode("worker-blocked")],
      barriers: { final: ["worker-blocked"] },
    });
    expect(
      runTask([
        "execution",
        "start-run",
        taskDir,
        "--executor",
        "channel",
        "--run-id",
        "worker-blocked-run",
        "--json",
      ]).status,
    ).toBe(0);
    expect(
      runTask(["execution", "claim", taskDir, "worker-blocked", "--json"])
        .status,
    ).toBe(0);
    complete("worker-blocked", 1, "blocked", [], "worker-blocked-run");

    const status = JSON.parse(
      runTask(["execution", "status", taskDir, "--json"]).stdout,
    );
    expect(status.nodes["worker-blocked"].status).toBe("blocked");
    expect(
      readyIds(runTask(["execution", "ready", taskDir, "--json"])),
    ).toEqual([]);
  });

  it("reclaims a lock whose recorded owner process is dead", () => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [finalNode("locked")],
      barriers: { final: ["locked"] },
    });
    const start = runTask([
      "execution",
      "start-run",
      taskDir,
      "--executor",
      "channel",
      "--run-id",
      "stale-lock-run",
      "--json",
    ]);
    expect(start.status).toBe(0);
    const runtimePath = JSON.parse(start.stdout).runtimePath as string;
    writeJson(path.join(runtimePath, ".state.lock"), {
      pid: 99_999_999,
      createdAt: "2000-01-01T00:00:00Z",
    });

    const ready = runTask(["execution", "ready", taskDir, "--json"]);
    expect(ready.status).toBe(0);
    expect(readyIds(ready)).toEqual(["locked"]);
    expect(fs.existsSync(path.join(runtimePath, ".state.lock"))).toBe(false);
  });

  it.each([
    { name: "boolean", literal: "true" },
    { name: "float", literal: "1.0" },
    { name: "string", literal: '"1"' },
  ])("rejects runtime state with a $name version", ({ name, literal }) => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [finalNode("runtime-version")],
      barriers: { final: ["runtime-version"] },
    });
    const runId = `runtime-version-${name}`;
    const started = runTask([
      "execution",
      "start-run",
      taskDir,
      "--executor",
      "channel",
      "--run-id",
      runId,
      "--json",
    ]);
    expect(started.status).toBe(0);
    const runtimePath = JSON.parse(started.stdout).runtimePath as string;
    const statePath = path.join(runtimePath, "state.json");
    const original = fs.readFileSync(statePath, "utf-8");
    const tampered = original.replace('"version": 1', `"version": ${literal}`);
    expect(tampered).not.toBe(original);
    fs.writeFileSync(statePath, tampered, "utf-8");

    const status = runTask([
      "execution",
      "status",
      taskDir,
      "--run-id",
      runId,
      "--json",
    ]);

    expect(status.status).toBe(1);
    expect(JSON.parse(status.stdout).error).toContain(
      "unsupported runtime state version",
    );
  });

  it.each([
    { field: "taskId", value: "different-task" },
    { field: "taskPath", value: ".suncode/tasks/different-task" },
  ])("rejects runtime state with a mismatched $field", ({ field, value }) => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [finalNode("runtime-identity")],
      barriers: { final: ["runtime-identity"] },
    });
    const runId = `runtime-identity-${field}`;
    const started = runTask([
      "execution",
      "start-run",
      taskDir,
      "--executor",
      "channel",
      "--run-id",
      runId,
      "--json",
    ]);
    expect(started.status).toBe(0);
    const runtimePath = JSON.parse(started.stdout).runtimePath as string;
    const statePath = path.join(runtimePath, "state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8")) as Record<
      string,
      unknown
    >;
    state[field] = value;
    writeJson(statePath, state);

    const status = runTask([
      "execution",
      "status",
      taskDir,
      "--run-id",
      runId,
      "--json",
    ]);

    expect(status.status).toBe(1);
    expect(JSON.parse(status.stdout).error).toContain(
      `runtime state ${field} does not match task directory`,
    );
  });

  it("rejects runtime state whose runId differs from its runtime directory", () => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [finalNode("runtime-run-identity")],
      barriers: { final: ["runtime-run-identity"] },
    });
    const runId = "runtime-run-identity";
    const started = runTask([
      "execution",
      "start-run",
      taskDir,
      "--executor",
      "channel",
      "--run-id",
      runId,
      "--json",
    ]);
    expect(started.status).toBe(0);
    const runtimePath = JSON.parse(started.stdout).runtimePath as string;
    const statePath = path.join(runtimePath, "state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8")) as Record<
      string,
      unknown
    >;
    state.runId = "different-run";
    writeJson(statePath, state);

    const status = runTask([
      "execution",
      "status",
      taskDir,
      "--run-id",
      runId,
      "--json",
    ]);

    expect(status.status).toBe(1);
    expect(JSON.parse(status.stdout).error).toContain(
      "runtime state runId does not match runtime directory",
    );
  });

  it("rejects a tampered non-integer runtime maxConcurrency", () => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [finalNode("runtime-concurrency")],
      barriers: { final: ["runtime-concurrency"] },
    });
    const runId = "runtime-concurrency";
    const started = runTask([
      "execution",
      "start-run",
      taskDir,
      "--executor",
      "channel",
      "--run-id",
      runId,
      "--json",
    ]);
    expect(started.status).toBe(0);
    const runtimePath = JSON.parse(started.stdout).runtimePath as string;
    const statePath = path.join(runtimePath, "state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8")) as {
      executor: Record<string, unknown>;
    };
    state.executor.maxConcurrency = 1.5;
    writeJson(statePath, state);

    const status = runTask([
      "execution",
      "status",
      taskDir,
      "--run-id",
      runId,
      "--json",
    ]);

    expect(status.status).toBe(1);
    expect(JSON.parse(status.stdout).error).toContain(
      "runtime executor maxConcurrency is invalid",
    );
  });

  it.each([
    { name: "boolean", jsonValue: "true" },
    { name: "float", jsonValue: "1.0" },
    { name: "string", jsonValue: '"1"' },
  ])(
    "rejects executor capabilities with a $name result protocol version",
    ({ name, jsonValue }) => {
      writeJson(path.join(taskDir, "execution.json"), {
        version: 1,
        task: "07-23-dag-test",
        defaults: {},
        nodes: [finalNode("capability-version")],
        barriers: { final: ["capability-version"] },
      });
      const probe = [
        "import json",
        "import sys",
        "from pathlib import Path",
        "sys.path.insert(0, sys.argv[1])",
        "from common.execution_runtime import ExecutionRuntimeError, ExecutorCapabilities, start_execution_run",
        "capabilities = ExecutorCapabilities(",
        "    kind='channel',",
        "    max_concurrency=1,",
        "    roles=('implement', 'check', 'fix', 'integration', 'research'),",
        "    supports_wait_any=True,",
        "    supports_cancellation=False,",
        "    supports_clean_context=True,",
        "    isolation='shared-worktree',",
        "    result_protocol_version=json.loads(sys.argv[4]),",
        ")",
        "try:",
        "    start_execution_run(",
        "        repo_root=Path(sys.argv[2]),",
        "        task_dir=Path(sys.argv[3]),",
        "        capabilities=capabilities,",
        "        run_id=sys.argv[5],",
        "    )",
        "except ExecutionRuntimeError as exc:",
        "    print(exc)",
        "    raise SystemExit(1)",
      ].join("\n");
      const result = spawnSync(
        pythonCommand,
        [
          "-c",
          probe,
          path.join(cwd, ".suncode", "scripts"),
          cwd,
          taskDir,
          jsonValue,
          `capability-version-${name}`,
        ],
        { cwd, encoding: "utf-8" },
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("executor result protocol must equal 1");
    },
  );

  it.each([
    { name: "boolean", jsonValue: "true" },
    { name: "float", jsonValue: "1.5" },
    { name: "string", jsonValue: '"2"' },
  ])(
    "rejects a $name max concurrency at the capability factory boundary",
    ({ jsonValue }) => {
      const probe = [
        "import json",
        "import sys",
        "sys.path.insert(0, sys.argv[1])",
        "from common.execution_runtime import ExecutionRuntimeError, make_capabilities",
        "try:",
        "    make_capabilities(kind='channel', max_concurrency=json.loads(sys.argv[2]))",
        "except ExecutionRuntimeError as exc:",
        "    print(exc)",
        "    raise SystemExit(1)",
      ].join("\n");
      const result = spawnSync(
        pythonCommand,
        ["-c", probe, path.join(cwd, ".suncode", "scripts"), jsonValue],
        { cwd, encoding: "utf-8" },
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "max concurrency must be a positive integer",
      );
    },
  );

  it("rejects a direct adapter float max concurrency before creating runtime state", () => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [finalNode("adapter-concurrency")],
      barriers: { final: ["adapter-concurrency"] },
    });
    const probe = [
      "import sys",
      "from pathlib import Path",
      "sys.path.insert(0, sys.argv[1])",
      "from common.execution_runtime import ExecutionRuntimeError, ExecutorCapabilities, start_execution_run",
      "capabilities = ExecutorCapabilities(",
      "    kind='channel',",
      "    max_concurrency=1.5,",
      "    roles=('implement', 'check', 'fix', 'integration', 'research'),",
      "    supports_wait_any=True,",
      "    supports_cancellation=False,",
      "    supports_clean_context=True,",
      "    isolation='shared-worktree',",
      ")",
      "try:",
      "    start_execution_run(",
      "        repo_root=Path(sys.argv[2]),",
      "        task_dir=Path(sys.argv[3]),",
      "        capabilities=capabilities,",
      "        run_id='invalid-adapter-concurrency',",
      "    )",
      "except ExecutionRuntimeError as exc:",
      "    print(exc)",
      "    raise SystemExit(1)",
    ].join("\n");
    const result = spawnSync(
      pythonCommand,
      ["-c", probe, path.join(cwd, ".suncode", "scripts"), cwd, taskDir],
      { cwd, encoding: "utf-8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "executor max concurrency must be a positive integer",
    );
    expect(
      fs.existsSync(
        path.join(
          cwd,
          ".suncode",
          ".runtime",
          "execution",
          "07-23-dag-test",
          "invalid-adapter-concurrency",
        ),
      ),
    ).toBe(false);
  });

  it("preserves a no-clean-context capability declaration in inline mode", () => {
    writeJson(path.join(taskDir, "execution.json"), {
      version: 1,
      task: "07-23-dag-test",
      defaults: {},
      nodes: [finalNode("inline")],
      barriers: { final: ["inline"] },
    });
    const start = runTask([
      "execution",
      "start-run",
      taskDir,
      "--executor",
      "inline",
      "--max-concurrency",
      "9",
      "--no-clean-context",
      "--run-id",
      "inline-capability-run",
      "--json",
    ]);
    expect(start.status).toBe(0);
    expect(JSON.parse(start.stdout)).toMatchObject({
      executor: {
        kind: "inline",
        maxConcurrency: 1,
        supportsWaitAny: false,
        supportsCleanContext: false,
      },
      warnings: [expect.stringContaining("cannot guarantee clean context")],
    });
  });

  function readyIds(result: SpawnSyncReturns<string>): string[] {
    expect(result.status).toBe(0);
    return (JSON.parse(result.stdout).selected as { id: string }[]).map(
      (item) => item.id,
    );
  }

  function complete(
    nodeId: string,
    attempt: number,
    status: "succeeded" | "failed" | "blocked" | "cancelled",
    changes: Record<string, unknown>[] = [],
    runId = "fanout-run",
    risks: string[] = [],
  ): void {
    const result = submitResult(nodeId, {
      version: 1,
      taskId: "07-23-dag-test",
      runId,
      nodeId,
      attempt,
      status,
      summary: `${nodeId} ${status}`,
      changes,
      findings: [],
      validation: [
        {
          command: `validate ${nodeId}`,
          status: "passed",
          evidence: "test validation passed",
        },
      ],
      artifacts: [],
      risks,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
  }

  function submitResult(
    nodeId: string,
    value: Record<string, unknown>,
    suffix = "result",
  ): SpawnSyncReturns<string> {
    const resultPath = path.join(cwd, `${nodeId}-${suffix}.json`);
    writeJson(resultPath, value);
    return runTask([
      "execution",
      "complete",
      taskDir,
      nodeId,
      "--result",
      resultPath,
      "--json",
    ]);
  }

  function submitRawResult(
    nodeId: string,
    value: string,
    suffix: string,
  ): SpawnSyncReturns<string> {
    const resultPath = path.join(cwd, `${nodeId}-${suffix}.json`);
    fs.writeFileSync(resultPath, `${value}\n`, "utf-8");
    return runTask([
      "execution",
      "complete",
      taskDir,
      nodeId,
      "--result",
      resultPath,
      "--json",
    ]);
  }

  function runTask(args: string[]): SpawnSyncReturns<string> {
    return spawnSync(
      pythonCommand,
      [path.join(cwd, ".suncode", "scripts", "task.py"), ...args],
      { cwd, encoding: "utf-8" },
    );
  }
});

function diamondPlan(): Record<string, unknown> {
  return {
    version: 1,
    task: "07-23-dag-test",
    defaults: {
      timeoutSeconds: 900,
      maxAttempts: 2,
      contextProfile: "implement",
    },
    nodes: [
      node("root", { reads: [], writes: ["src/root/**"] }),
      node("left", {
        dependsOn: ["root"],
        reads: ["src/root/**"],
        writes: ["src/left/**"],
      }),
      node("right", {
        dependsOn: ["root"],
        reads: ["src/root/**"],
        writes: ["src/right/**"],
      }),
      node("integration", {
        role: "integration",
        dependsOn: ["left", "right"],
        reads: ["src/left/**", "src/right/**"],
        writes: ["src/integration/**"],
        context: context("integration"),
      }),
    ],
    barriers: { final: ["integration"] },
  };
}

function runOverlapWorker(
  startedPath: string,
  peerStartedPath: string,
  finishedPath: string,
): Promise<number | null> {
  const script = [
    "from pathlib import Path",
    "import sys, time",
    "started, peer, finished = map(Path, sys.argv[1:4])",
    "started.write_text('started', encoding='utf-8')",
    "deadline = time.monotonic() + 5",
    "while not peer.exists() and time.monotonic() < deadline: time.sleep(0.01)",
    "if not peer.exists(): raise SystemExit(2)",
    "finished.write_text('finished', encoding='utf-8')",
  ].join("\n");
  const child = spawn(
    pythonCommand,
    ["-c", script, startedPath, peerStartedPath, finishedPath],
    { stdio: "ignore" },
  );
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
}

function context(
  profile: "implement" | "check" | "integration",
): Record<string, unknown> {
  return {
    profile,
    include: [
      "prd",
      "design",
      "implement",
      profile === "check" ? "check-jsonl" : "implement-jsonl",
    ],
    dependencyResults: "direct",
    maxBytes: 262_144,
    perSourceBytes: 65_536,
  };
}

function node(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name: id,
    description: `Execute ${id}`,
    priority: "P1",
    role: "implement",
    dependsOn: [],
    reads: ["src/**"],
    writes: [`src/${id}/**`],
    resources: [`resource-${id}`],
    context: context("implement"),
    validation: [`validate ${id}`],
    execution: {
      isolation: "shared-worktree",
      allowed: ["inline", "native-subagent", "channel"],
      timeoutSeconds: 900,
      maxAttempts: 2,
      idempotent: true,
    },
    ...overrides,
  };
}

function finalNode(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return node(id, {
    role: "integration",
    context: context("integration"),
    ...overrides,
  });
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}
