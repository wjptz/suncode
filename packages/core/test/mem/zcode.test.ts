import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { fakeHome, snapshotTestState } = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");

  return {
    fakeHome: fs.mkdtempSync(path.join(os.tmpdir(), "suncode-zcode-adapter-")),
    snapshotTestState: {
      unstablePath: null as string | null,
      mainDbStatReads: 0,
    },
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => fakeHome };
});

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    statSync: (...args: Parameters<typeof actual.statSync>) => {
      const stat = actual.statSync(...args);
      if (String(args[0]) !== snapshotTestState.unstablePath) return stat;
      snapshotTestState.mainDbStatReads += 1;
      if (snapshotTestState.mainDbStatReads % 2 !== 0) return stat;

      const changed = Object.create(stat) as typeof stat;
      Object.defineProperty(changed, "mtimeMs", {
        value: stat.mtimeMs + snapshotTestState.mainDbStatReads,
      });
      return changed;
    },
  };
});

const {
  collectZcodeTurnsAndEvents,
  zcodeExtractDialogue,
  zcodeListSessions,
  zcodeSearch,
} = await import("../../src/mem/adapters/zcode.js");
const { ZCODE_DB } = await import("../../src/mem/internal/paths.js");
type MemFilter = import("../../src/mem/types.js").MemFilter;

const mkFilter = (overrides: Partial<MemFilter> = {}): MemFilter => ({
  platform: "zcode",
  allProjects: true,
  limit: 20,
  offset: 0,
  json: false,
  ...overrides,
});

afterAll(() => {
  nodeFs.rmSync(fakeHome, { recursive: true, force: true });
});

// =============================================================================
// ZCode adapter — reads from `~/.zcode/cli/db/db.sqlite` via the zero-dependency
// SQLite parser. Fixtures are built with the system python sqlite3 module; the
// whole block is skipped when no python interpreter is available so CI without
// python does not regress.
// =============================================================================

/** Detect a python launcher with the sqlite3 stdlib module. */
function findPythonForZcode(): string[] | null {
  const { execFileSync } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("node:child_process") as typeof import("node:child_process");
  const candidates =
    process.platform === "win32" ? ["py", "python"] : ["python3", "python"];
  for (const cmd of candidates) {
    try {
      execFileSync(cmd, ["-c", "import sqlite3"], { stdio: "ignore" });
      return [cmd];
    } catch {
      /* next */
    }
  }
  return null;
}

const ZCODE_PY = findPythonForZcode();

/** Build a ZCode-shaped SQLite db at ZCODE_DB with session/message/part rows.
 * Columns are kept to the subset the adapter reads. */
function buildZcodeDb(opts: {
  sessions?: {
    id: string;
    title?: string;
    directory?: string;
    time_created?: number;
    time_updated?: number;
  }[];
  messages?: {
    id: string;
    session_id: string;
    time_created: number;
    role: string;
  }[];
  parts?: {
    message_id: string;
    time_created: number;
    data: Record<string, unknown>;
  }[];
}): void {
  if (!ZCODE_PY || ZCODE_PY.length === 0) throw new Error("python unavailable");
  const pyCmd = ZCODE_PY[0];
  if (!pyCmd) throw new Error("python unavailable");
  const { execFileSync } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("node:child_process") as typeof import("node:child_process");
  nodeFs.mkdirSync(nodePath.dirname(ZCODE_DB), { recursive: true });
  const payload = JSON.stringify(opts);
  const script = `
import sqlite3, json, os
os.makedirs(os.path.dirname(${JSON.stringify(ZCODE_DB)}), exist_ok=True)
if os.path.exists(${JSON.stringify(ZCODE_DB)}):
    os.remove(${JSON.stringify(ZCODE_DB)})
db = sqlite3.connect(${JSON.stringify(ZCODE_DB)})
db.execute("CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER)")
db.execute("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)")
db.execute("CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)")
spec = json.loads(${JSON.stringify(payload)})
message_sessions = {m["id"]: m["session_id"] for m in spec.get("messages", [])}
for s in spec.get("sessions", []):
    db.execute("INSERT INTO session (id,title,directory,time_created,time_updated) VALUES (?,?,?,?,?)",
               (s["id"], s.get("title"), s.get("directory"), s.get("time_created", 1000), s.get("time_updated", 2000)))
for m in spec.get("messages", []):
    data = json.dumps({"role": m["role"]})
    db.execute("INSERT INTO message (id,session_id,time_created,data) VALUES (?,?,?,?)",
               (m["id"], m["session_id"], m["time_created"], data))
for i, p in enumerate(spec.get("parts", [])):
    pid = f"part_{i}_{p['message_id']}"
    db.execute("INSERT INTO part (id,message_id,session_id,time_created,time_updated,data) VALUES (?,?,?,?,?,?)",
               (pid, p["message_id"], message_sessions.get(p["message_id"], ""), p["time_created"], p["time_created"], json.dumps(p["data"])))
db.commit()
db.close()
`;
  execFileSync(pyCmd, ["-c", script], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function rimrafZcodeDb(): void {
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      nodeFs.rmSync(ZCODE_DB + ext, { force: true });
    } catch {
      /* ignore */
    }
  }
}

describe.skipIf(!ZCODE_PY)("zcodeListSessions / zcodeExtractDialogue", () => {
  beforeEach(() => rimrafZcodeDb());
  afterEach(() => rimrafZcodeDb());

  it("returns [] when the db is absent", () => {
    expect(zcodeListSessions(mkFilter())).toEqual([]);
  });

  it("lists sessions with id/title/cwd from the session table", () => {
    buildZcodeDb({
      sessions: [
        {
          id: "sess_a",
          title: "hello",
          directory: "/proj/a",
          time_created: 1000,
          time_updated: 2000,
        },
        {
          id: "sess_b",
          title: "world",
          directory: "/proj/b",
          time_created: 3000,
          time_updated: 4000,
        },
      ],
    });
    const rows = zcodeListSessions(mkFilter({ cwd: undefined }));
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.id === "sess_a");
    expect(a?.title).toBe("hello");
    expect(a?.cwd).toBe("/proj/a");
    expect(a?.platform).toBe("zcode");
  });

  it("filters by --cwd (sameProject)", () => {
    buildZcodeDb({
      sessions: [
        { id: "s1", directory: "/proj/a", time_created: 1, time_updated: 2 },
        { id: "s2", directory: "/proj/b", time_created: 1, time_updated: 2 },
      ],
    });
    const rows = zcodeListSessions(
      mkFilter({ cwd: "/proj/a", platform: "zcode" }),
    );
    expect(rows.map((r) => r.id)).toEqual(["s1"]);
  });

  it("extracts user/assistant text from parts, skipping non-text types", () => {
    buildZcodeDb({
      sessions: [
        { id: "s1", directory: "/p", time_created: 1, time_updated: 2 },
      ],
      messages: [
        { id: "m1", session_id: "s1", time_created: 10, role: "user" },
        { id: "m2", session_id: "s1", time_created: 20, role: "assistant" },
      ],
      parts: [
        {
          message_id: "m1",
          time_created: 10,
          data: { type: "text", text: "hi there" },
        },
        {
          message_id: "m1",
          time_created: 11,
          data: { type: "reasoning", text: "ignored" },
        },
        {
          message_id: "m2",
          time_created: 20,
          data: { type: "text", text: "hello back" },
        },
      ],
    });
    const turns = zcodeExtractDialogue({
      platform: "zcode",
      id: "s1",
      filePath: ZCODE_DB,
    });
    expect(turns).toEqual([
      { role: "user", text: "hi there" },
      { role: "assistant", text: "hello back" },
    ]);
  });

  it("strips injection tags from extracted text", () => {
    buildZcodeDb({
      sessions: [
        { id: "s1", directory: "/p", time_created: 1, time_updated: 2 },
      ],
      messages: [
        { id: "m1", session_id: "s1", time_created: 10, role: "user" },
      ],
      parts: [
        {
          message_id: "m1",
          time_created: 10,
          data: {
            type: "text",
            text: "real question<workflow-state>x</workflow-state> trailing",
          },
        },
      ],
    });
    const turns = zcodeExtractDialogue({
      platform: "zcode",
      id: "s1",
      filePath: ZCODE_DB,
    });
    expect(turns[0]?.text).toBe("real question trailing");
  });

  it("detects task.py create/start commands in Bash tool parts", () => {
    buildZcodeDb({
      sessions: [
        { id: "s1", directory: "/p", time_created: 1, time_updated: 2 },
      ],
      messages: [
        { id: "m1", session_id: "s1", time_created: 10, role: "user" },
        { id: "m2", session_id: "s1", time_created: 20, role: "assistant" },
      ],
      parts: [
        {
          message_id: "m1",
          time_created: 10,
          data: { type: "text", text: "go" },
        },
        {
          message_id: "m2",
          time_created: 20,
          data: {
            type: "tool",
            tool: "Bash",
            state: {
              input: {
                command:
                  'py ./.suncode/scripts/task.py create "my task" --slug my-task',
              },
            },
          },
        },
        {
          message_id: "m2",
          time_created: 21,
          data: {
            type: "tool",
            tool: "Bash",
            state: {
              input: {
                command:
                  "py ./.suncode/scripts/task.py start .suncode/tasks/01-01-my-task",
              },
            },
          },
        },
      ],
    });
    const { events, turns } = collectZcodeTurnsAndEvents({
      platform: "zcode",
      id: "s1",
      filePath: ZCODE_DB,
    });
    expect(events).toHaveLength(2);
    expect(events[0]?.action).toBe("create");
    expect(events[0]?.slug).toBe("my-task");
    expect(events[1]?.action).toBe("start");
    expect(events[1]?.taskDir).toContain("my-task");
    // turnIndex is the turn count at the time the tool ran. m1 ("go") was
    // pushed as turn 0, so both tool events on m2 (which has no text) fire at
    // turnIndex=1. This locks the ZCode turnIndex semantics documented in
    // zcode.ts (text-then-tool within a message).
    expect(events[0]?.turnIndex).toBe(1);
    expect(events[1]?.turnIndex).toBe(1);
    expect(turns).toEqual([{ role: "user", text: "go" }]);
  });

  it("drops bootstrap turns (large INSTRUCTIONS block)", () => {
    // isBootstrapTurn: >4000 chars and starts with <INSTRUCTIONS> → dropped.
    const huge = "<INSTRUCTIONS>" + "x".repeat(4500);
    buildZcodeDb({
      sessions: [
        { id: "s1", directory: "/p", time_created: 1, time_updated: 2 },
      ],
      messages: [
        { id: "m1", session_id: "s1", time_created: 10, role: "user" },
        { id: "m2", session_id: "s1", time_created: 20, role: "assistant" },
      ],
      parts: [
        {
          message_id: "m1",
          time_created: 10,
          data: { type: "text", text: huge },
        },
        {
          message_id: "m2",
          time_created: 20,
          data: { type: "text", text: "real reply" },
        },
      ],
    });
    const turns = zcodeExtractDialogue({
      platform: "zcode",
      id: "s1",
      filePath: ZCODE_DB,
    });
    // The bootstrap user turn is dropped; only the assistant reply survives.
    expect(turns).toEqual([{ role: "assistant", text: "real reply" }]);
  });

  it("joins multiple text parts of one message with blank-line separator", () => {
    buildZcodeDb({
      sessions: [
        { id: "s1", directory: "/p", time_created: 1, time_updated: 2 },
      ],
      messages: [
        { id: "m1", session_id: "s1", time_created: 10, role: "assistant" },
      ],
      parts: [
        {
          message_id: "m1",
          time_created: 10,
          data: { type: "text", text: "first" },
        },
        {
          message_id: "m1",
          time_created: 11,
          data: { type: "text", text: "second" },
        },
      ],
    });
    const turns = zcodeExtractDialogue({
      platform: "zcode",
      id: "s1",
      filePath: ZCODE_DB,
    });
    expect(turns).toEqual([{ role: "assistant", text: "first\n\nsecond" }]);
  });

  it("uses the latest compaction summary and drops pre-compaction turns/events", () => {
    buildZcodeDb({
      sessions: [
        { id: "s1", directory: "/p", time_created: 1, time_updated: 2 },
      ],
      messages: [
        { id: "m_old", session_id: "s1", time_created: 10, role: "user" },
        {
          id: "m_old_tool",
          session_id: "s1",
          time_created: 20,
          role: "assistant",
        },
        {
          id: "m_marker",
          session_id: "s1",
          time_created: 30,
          role: "assistant",
        },
        { id: "m_summary", session_id: "s1", time_created: 40, role: "user" },
        {
          id: "m_after",
          session_id: "s1",
          time_created: 50,
          role: "assistant",
        },
        {
          id: "m_after_tool",
          session_id: "s1",
          time_created: 60,
          role: "assistant",
        },
      ],
      parts: [
        {
          message_id: "m_old",
          time_created: 10,
          data: { type: "text", text: "old-secret should disappear" },
        },
        {
          message_id: "m_old_tool",
          time_created: 20,
          data: {
            type: "tool",
            tool: "Bash",
            state: {
              input: {
                command:
                  'py ./.suncode/scripts/task.py create "old task" --slug old-task',
              },
            },
          },
        },
        {
          message_id: "m_marker",
          time_created: 30,
          data: {
            type: "compaction",
            replace: true,
            summaryMessageId: "m_summary",
          },
        },
        {
          message_id: "m_summary",
          time_created: 40,
          data: { type: "text", text: "summary of earlier work" },
        },
        {
          message_id: "m_summary",
          time_created: 41,
          data: {
            type: "compaction",
            tail_start_id: "m_old_tool",
            compactBoundary: {
              keptMessageCount: 0,
              lastSummarizedMessageId: "m_old_tool",
              summaryMessageIds: ["m_summary"],
            },
          },
        },
        {
          message_id: "m_after",
          time_created: 50,
          data: { type: "text", text: "after compact retained" },
        },
        {
          message_id: "m_after_tool",
          time_created: 60,
          data: {
            type: "tool",
            tool: "Bash",
            state: {
              input: {
                command:
                  "py ./.suncode/scripts/task.py start .suncode/tasks/01-01-new-task",
              },
            },
          },
        },
      ],
    });

    const session = {
      platform: "zcode" as const,
      id: "s1",
      filePath: ZCODE_DB,
    };
    expect(zcodeExtractDialogue(session)).toEqual([
      { role: "user", text: "[compact summary]\nsummary of earlier work" },
      { role: "assistant", text: "after compact retained" },
    ]);
    expect(zcodeSearch(session, "old-secret").count).toBe(0);

    const { events, turns } = collectZcodeTurnsAndEvents(session);
    expect(turns.map((t) => t.text)).toEqual([
      "[compact summary]\nsummary of earlier work",
      "after compact retained",
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe("start");
    expect(events[0]?.taskDir).toContain("new-task");
    expect(events[0]?.turnIndex).toBe(2);
  });

  it("degrades to [] when the db file is corrupt", () => {
    // Write a non-SQLite file at ZCODE_DB so openSqliteReadOnly throws.
    nodeFs.mkdirSync(nodePath.dirname(ZCODE_DB), { recursive: true });
    nodeFs.writeFileSync(ZCODE_DB, "not a sqlite file");
    // list and extract both catch SqliteParseError → [] (not throw).
    const warnings: { code: string; message: string }[] = [];
    expect(zcodeListSessions(mkFilter({ cwd: undefined }), warnings)).toEqual(
      [],
    );
    const turns = zcodeExtractDialogue(
      {
        platform: "zcode",
        id: "anything",
        filePath: ZCODE_DB,
      },
      warnings,
    );
    expect(turns).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("zcode-db-unreadable");
  });

  it("fails closed with a retry warning when the snapshot stays unstable", () => {
    buildZcodeDb({
      sessions: [
        {
          id: "unstable-1",
          title: "unstable",
          directory: "/project",
          time_created: 1,
          time_updated: 2,
        },
      ],
    });
    try {
      snapshotTestState.unstablePath = ZCODE_DB;
      snapshotTestState.mainDbStatReads = 0;
      const warnings: { code: string; message: string }[] = [];
      expect(zcodeListSessions(mkFilter({ cwd: undefined }), warnings)).toEqual(
        [],
      );
      expect(warnings).toEqual([
        {
          code: "zcode-db-snapshot-unstable",
          message: `ZCode 正在写入，请重试。 (${ZCODE_DB})`,
        },
      ]);
    } finally {
      snapshotTestState.unstablePath = null;
    }
  });

  it("warns when the ZCode schema drops a required column", () => {
    buildZcodeDb({
      sessions: [
        {
          id: "schema-1",
          title: "schema drift",
          directory: "/project",
          time_created: 1,
          time_updated: 2,
        },
      ],
    });
    const pyCmd = ZCODE_PY && ZCODE_PY[0];
    if (!pyCmd) throw new Error("python unavailable");
    const { execFileSync } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:child_process") as typeof import("node:child_process");
    execFileSync(
      pyCmd,
      [
        "-c",
        `import sqlite3; db=sqlite3.connect(${JSON.stringify(ZCODE_DB)}); db.execute('ALTER TABLE session RENAME COLUMN directory TO project_dir'); db.commit(); db.close()`,
      ],
      { stdio: "ignore" },
    );

    const warnings: { code: string; message: string }[] = [];
    expect(zcodeListSessions(mkFilter({ cwd: undefined }), warnings)).toEqual(
      [],
    );
    expect(warnings[0]?.code).toBe("zcode-db-unreadable");
    expect(warnings[0]?.message).toContain("directory");
  });

  it("excludes subagent_child sessions from list", () => {
    // The buildZcodeDb helper writes a session table without task_type; this
    // test needs that column, so build the fixture with a custom python pass.
    const { execFileSync } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:child_process") as typeof import("node:child_process");
    const pyCmd = ZCODE_PY && ZCODE_PY[0];
    if (!pyCmd) throw new Error("python unavailable");
    nodeFs.mkdirSync(nodePath.dirname(ZCODE_DB), { recursive: true });
    const script = `
import sqlite3, os
if os.path.exists(${JSON.stringify(ZCODE_DB)}):
    os.remove(${JSON.stringify(ZCODE_DB)})
db = sqlite3.connect(${JSON.stringify(ZCODE_DB)})
db.execute("CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, task_type TEXT)")
db.execute("INSERT INTO session (id,title,directory,time_created,time_updated,task_type) VALUES (?,?,?,?,?,?)",
           ("interactive-1", "main chat", "/p", 1, 2, "interactive"))
db.execute("INSERT INTO session (id,title,directory,time_created,time_updated,task_type) VALUES (?,?,?,?,?,?)",
           ("child-1", "subagent", "/p", 1, 2, "subagent_child"))
db.commit()
db.close()
`;
    const pyDir = nodeFs.mkdtempSync(
      nodePath.join(nodePath.dirname(ZCODE_DB), "py-zc-"),
    );
    const pyFile = nodePath.join(pyDir, "b.py");
    nodeFs.writeFileSync(pyFile, script);
    try {
      execFileSync(pyCmd, [pyFile], { stdio: "ignore" });
    } finally {
      nodeFs.rmSync(pyDir, { recursive: true, force: true });
    }
    const rows = zcodeListSessions(mkFilter({ cwd: undefined }));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain("interactive-1");
    expect(ids).not.toContain("child-1");
  });

  it("search counts user/assistant occurrences", () => {
    buildZcodeDb({
      sessions: [
        { id: "s1", directory: "/p", time_created: 1, time_updated: 2 },
      ],
      messages: [
        { id: "m1", session_id: "s1", time_created: 10, role: "user" },
        { id: "m2", session_id: "s1", time_created: 20, role: "assistant" },
      ],
      parts: [
        {
          message_id: "m1",
          time_created: 10,
          data: { type: "text", text: "find the hook bug" },
        },
        {
          message_id: "m2",
          time_created: 20,
          data: { type: "text", text: "the hook is here" },
        },
      ],
    });
    const hit = zcodeSearch(
      { platform: "zcode", id: "s1", filePath: ZCODE_DB },
      "hook",
    );
    expect(hit.count).toBeGreaterThanOrEqual(2);
    expect(hit.userCount).toBe(1);
    expect(hit.asstCount).toBe(1);
  });
});
