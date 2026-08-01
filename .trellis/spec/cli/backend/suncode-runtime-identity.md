# Suncode Runtime Identity

## Scenario: Fresh Suncode Runtime Namespace

### 1. Scope / Trigger

- Trigger: Any change to fresh `suncode init`, generated workflow assets,
  hook injection, channel storage, template hashing, update, uninstall, or
  package-boundary code that can expose product-owned runtime names.
- Scope: Current Suncode runtime behavior only. Historical migration
  manifests, old release notes, archived task records, and tests that parse
  historical Trellis sessions may keep Trellis strings when they explicitly
  describe old Trellis releases or backward-looking data.

### 2. Signatures

- CLI command namespace: `suncode <command>`.
- npm install namespace: `npm install -g @wjptz/suncode`.
- Core package imports:

```ts
import { createChannelStore } from "@wjptz/suncode-core/channel";
import { searchMemSessions } from "@wjptz/suncode-core/mem";
```

- Workflow source helpers:

```ts
getSuncodeTemplatePath(relativePath?: string): string
readSuncodeFile(relativePath: string): string
copySuncodeDir(
  srcRelativePath: string,
  destPath: string,
  options?: { executable?: boolean },
): void
```

### 3. Contracts

- Project workflow root: `.suncode/`.
- Generated project subpaths: `.suncode/workspace`, `.suncode/tasks`,
  `.suncode/tasks/archive`, `.suncode/spec`, `.suncode/scripts`,
  `.suncode/agents`, `.suncode/config.yaml`, `.suncode/.template-hashes.json`,
  and `.suncode/.runtime`.
- Global channel root: `~/.suncode/channels`.
- Environment variable prefix: `SUNCODE_`.
- Channel overrides: `SUNCODE_CHANNEL_ROOT`, `SUNCODE_CHANNEL_PROJECT`,
  `SUNCODE_CHANNEL_WORKER_IDLE_TIMEOUT`, and
  `SUNCODE_CHANNEL_MAX_LIVE_WORKERS`.
- Hook and context env keys: use `SUNCODE_CONTEXT_ID`, `SUNCODE_HOOKS`,
  `SUNCODE_DISABLE_HOOKS`, and `SUNCODE_*` equivalents for generated hooks.
- Generated protocol markers: `<!-- suncode-hook-injected -->` and
  `<suncode-workflow>`.
- No compatibility alias: Suncode must not read `.trellis/` or `TRELLIS_*` as
  fallback runtime inputs.
- No data migration: Suncode must not rename, import, delete, or mutate an
  existing Trellis install. A project with only `.trellis/` is uninitialized
  from Suncode's perspective.
- 仓库自身的开发工作流仍可使用 `.trellis/`；它不是发布给用户的
  Suncode runtime。live dogfood 与 packaged template 同步行为时，必须做
  身份映射：开发根保持 `.trellis` / `TRELLIS_*`，产品模板使用
  `.suncode` / `SUNCODE_*`。
- 平台自动识别必须基于 Suncode 所有权证据：当前模板路径出现在
  `.suncode/.template-hashes.json`，或存在平台注册的 Suncode 唯一
  `ownershipMarkers`。裸 `.claude`、`.codex`、`.snow`、`.omp` 等宿主
  目录不能证明 Suncode 所有权。
- manifest 中仍有模板 hash、但用户删除了对应文件时，平台所有权仍
  保留，以便 update 尊重 `userDeletedFiles`；不能因为当前文件缺失就
  把平台当成从未配置。
- 根 `.gitattributes` 是项目协作配置，不属于 `.suncode` runtime
  目录。生成项目必须包含精确规则
  `.suncode/workspace/*/journal-*.md merge=union`；仓库 dogfood 根只使用
  对应 `.trellis/workspace/*/...` 规则，两者不得互相冒充。
- channel 的自动可信符号链接只能来自 `.suncode/tasks` 与
  `.suncode/workspace`；不得把 `.trellis/**` 当成 Suncode 兼容入口。

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Fresh project runs `suncode init` | Create `.suncode/`; do not create `.trellis/`. |
| Project contains only `.trellis/` | Treat as no Suncode install; never migrate it implicitly. |
| `TRELLIS_*` env vars are present | Ignore them for Suncode runtime behavior. |
| `SUNCODE_*` env vars are present | Apply them according to the specific command or hook contract. |
| Channel root unset | Use `~/.suncode/channels`. |
| Channel root override set | Use `SUNCODE_CHANNEL_ROOT`; do not check `TRELLIS_CHANNEL_ROOT`. |
| Generated hook injects context | Emit Suncode markers and `.suncode/*` paths only. |
| Historical migration manifest mentions Trellis | Allowed only when describing old Trellis releases. |
| 只存在宿主平台配置目录，没有 Suncode hash/marker | 不报告为 configured，不由 update 接管。 |
| tracked 平台文件被用户删除但 hash 仍存在 | 保留平台所有权，同时尊重 user-deleted。 |
| `.gitattributes` 只有 Trellis journal 规则 | 追加 Suncode 精确规则并保留原内容。 |

### 5. Good/Base/Bad Cases

- Good: `suncode init --codex --yes` writes `.suncode/scripts/task.py`,
  `.suncode/config.yaml`, and generated Codex instructions that point back to
  `.suncode/`.
- Base: `suncode channel create review` with no env override stores events
  under `~/.suncode/channels`.
- Bad: `suncode update` sees `.trellis/.version` and decides to update or
  rename that tree.
- Bad: a generated hook writes `TRELLIS_CONTEXT_ID` while the generated script
  reads `SUNCODE_CONTEXT_ID`.

### 6. Tests Required

- Path constants test asserts `.suncode` for workflow, workspace, task, spec,
  script, agent, and archive paths.
- Init integration test asserts `.suncode/` exists and `.trellis/` does not
  exist after a fresh Suncode init.
- Update and uninstall tests assert they operate on `.suncode/` and do not
  treat `.trellis/` as Suncode-owned state.
- Hook/template tests assert `SUNCODE_*`, `.suncode/*`,
  `<!-- suncode-hook-injected -->`, and `<suncode-workflow>`.
- Channel core tests assert default storage under `~/.suncode/channels` and
  env overrides through `SUNCODE_CHANNEL_ROOT` / `SUNCODE_CHANNEL_PROJECT`.
- Grep audit current runtime source/templates for non-historical
  `.trellis`, `TRELLIS_`, `trellis-hook`, `trellis-workflow`, and
  user-visible Trellis wording.
- 平台归属测试覆盖裸目录、hash-owned、marker-owned、tracked 文件已删除、
  OMP shared-root 与 legacy Windsurf Suncode marker。
- `.gitattributes` 测试覆盖新建、增量追加、精确去重、Trellis/Suncode
  规则区分，以及 `update --dry-run` 零写入。

### 7. Wrong vs Correct

#### Wrong

```ts
export const DIR_NAMES = {
  WORKFLOW: ".trellis",
} as const;

const root = process.env.TRELLIS_CHANNEL_ROOT ?? "~/.trellis/channels";
```

#### Correct

```ts
export const DIR_NAMES = {
  WORKFLOW: ".suncode",
} as const;

const root = process.env.SUNCODE_CHANNEL_ROOT ?? "~/.suncode/channels";
```
