# Hub pull task type routing 实施计划

## 步骤

- [x] 读取实现前规范：`suncode-hub-collaboration.md`、`workflow-state-contract.md`、`quality-guidelines.md`、`commands-channel`/platform docs 仅在实际触碰对应文件时再读。
- [x] 在 `packages/cli/src/commands/hub/types.ts` 增加 Hub task type/source task 类型，并扩展 `HubTaskMeta`。
- [x] 在 `packages/cli/src/commands/hub/intake.ts` 增加 requirement normalizer：
  - [x] 支持 `taskType` / `kind` / `type` / `requirementType`。
  - [x] 缺失/未知按 `standard` fallback。
  - [x] 安全归一化 `sourceTask`。
- [x] 更新 `createLocalHubTask` 和默认 PRD：
  - [x] 写入 `meta.hub.taskType`。
  - [x] quick 生成快速任务 PRD。
  - [x] change 生成 sourceTask 区块，并按设计需要写 `research/source-task.md`。
- [x] 更新 Hub state prompt：
  - [x] 读取当前任务 `meta.hub.taskType`。
  - [x] 输出 `task-type:<type>` 或等价短行。
  - [x] quick Hub-bound task 输出 `plan-ready` upload-only / 不跑 `review` 的 guardrail。
- [x] 更新 `packages/cli/src/templates/common/bundled-skills/suncode-hub-requirements/SKILL.md`：
  - [x] standard 保持 plan-ready。
  - [x] quick 走 minimal PRD -> task.py start -> direct implementation -> minimal validation -> completion artifacts -> `suncode hub finish` -> finish-work。
  - [x] change 先读取 sourceTask，再按 standard 规划。
- [x] 更新 `packages/cli/src/templates/common/bundled-skills/suncode-hub-finish/SKILL.md` 或相关 finish 文案：
  - [x] quick 任务明确跳过 Hub code review。
  - [x] quick 任务仍必须生成并上传完成产物。
  - [x] quick 任务的 validation summary 必须记录最小验证证据；未执行项写明 `未执行` 和原因。
- [x] 更新 `packages/cli/src/templates/suncode/workflow.md` planning/in_progress breadcrumb，避免对所有 Hub 任务无条件要求 plan-ready/check/review。
- [x] 更新或补充 spec：`suncode-hub-collaboration.md` 增加 Hub task type routing 场景。
- [x] 补测试：
  - [x] command-level intake tests：quick、standard default、change sourceTask、unknown fallback。
  - [x] Hub state prompt tests：quick guardrail。
  - [x] quick plan-ready/upload tests：quick 仍上传 plan/PRD，但跳过 start preflight/计划审核。
  - [x] quick finish/upload tests：quick 不要求 review，但仍要求/上传完成产物。
  - [x] quick validation tests：文案或 helper 不允许把未执行验证表述为通过。
  - [x] quick preflight/start tests：`hub preflight-start` 和 `task.py start` before_start hook 对 quick 都在本地跳过，不联系 Hub preflight。
  - [x] quick review tests：`suncode hub review` 对 quick 在 provider/status/artifact 前跳过。
  - [x] Hub review prompt 测试：去掉 `Review Boundary` / `Changed Files` 列表，不再按 changed files 过滤 provider findings。
  - [x] sourceTask 安全测试：`description` 不再作为 `summary` fallback 落盘。
  - [x] workflow 详细 Phase 2 文案测试：review 命令仅适用于 standard/change。
  - [x] 真实 Hub payload 回归测试：`kind: "quick"` 被归一化为本地 `meta.hub.taskType: "quick"`。
  - [x] template/configurator tests：bundled skill 和 workflow 文案包含三类路线。
- [x] 根据 review 补 `.gitignore`：忽略本地 `data/*.sqlite*` 运行态文件，避免误提交 SQLite/WAL/SHM。

## 验证命令

优先定向运行：

```bash
pnpm test packages/cli/test/commands/hub.test.ts
pnpm test packages/cli/test/configurators/shared.test.ts packages/cli/test/configurators/platforms.test.ts
pnpm test packages/cli/test/templates/suncode.test.ts
pnpm typecheck
```

如触碰 workflow-state 或模板生成范围较广，再追加：

```bash
pnpm test packages/cli/test/regression.test.ts
pnpm lint
```

## 已执行验证

- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts test/templates/suncode.test.ts`：先按新增回归测试得到 4 个预期失败；修复后 114 个用例通过。
- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts -t "kind as the task type"`：先得到 `kind` 被 fallback 成 `standard` 的预期失败；修复后通过。
- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts -t "current task diff"`：早期按 review 范围约束得到预期失败；后续已按用户反馈改为移除 `Review Boundary` / `Changed Files` 列表。
- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts -t "omits boundary"`：先得到 prompt 仍包含 `Review Boundary` 和 changed-file list 的预期失败；修复后通过。
- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts -t "omits boundary"`：按 prompt-only 行为约束补断言后，先得到 prompt 缺少“聚焦当前 Hub task / 不做全仓审计”约束的预期失败；修复后通过。
- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts -t "provider prompt lightweight"`：先得到 prompt 仍内嵌 PRD/design/implement 正文和 diff 的预期失败；修复为仅列任务目录、任务文件路径和让 provider 自行检查 diff 后通过。
- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts -t "provider prompt lightweight"`：按 review prompt 五点修正补断言后，先得到缺少 `result.md` 说明、中文描述要求、实现审查边界、固定 JSON 格式和目录级范围提示的预期失败；修复后通过。
- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts -t "provider prompt lightweight"`：按“需求视角 review、不要运行 build/test/lint/format、不要引导 git diff/git status”补断言后，先得到 prompt 仍引导 diff 且缺少高阶 review 清单的预期失败；修复后通过。
- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts -t "provider output"`：先复现 provider 输出多个 fenced JSON 时会吃到前置示例、真实 engineer provider 输出超过 Node 默认 1MiB buffer 会 `ENOBUFS` 截断并导致 final JSON 丢失；修复为 prompt 不含可解析 JSON 示例、解析最后一个 fenced JSON、engineer provider 使用 32MiB maxBuffer 后通过。
- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts test/configurators/shared.test.ts test/templates/suncode.test.ts`：按 lightweight review prompt 修正后复跑，167 个用例通过。
- `pnpm --filter @wjptz/suncode run typecheck`：按 lightweight review prompt 修正后复跑，通过。
- `pnpm --filter @wjptz/suncode run lint`：按 lightweight review prompt 修正后复跑，通过。
- `git diff --check`：按 lightweight review prompt 修正后复跑，通过，无 whitespace error。
- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts test/configurators/shared.test.ts test/templates/suncode.test.ts`：按 review prompt 五点修正后复跑，167 个用例通过。
- `pnpm --filter @wjptz/suncode run typecheck`：按 review prompt 五点修正后复跑，通过。
- `pnpm --filter @wjptz/suncode run lint`：按 review prompt 五点修正后复跑，通过。
- `git diff --check`：按 review prompt 五点修正后复跑，通过，无 whitespace error。
- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts test/configurators/shared.test.ts test/templates/suncode.test.ts`：按需求视角 review prompt 修正后复跑，167 个用例通过。
- `pnpm --filter @wjptz/suncode run typecheck`：按需求视角 review prompt 修正后复跑，通过。
- `pnpm --filter @wjptz/suncode run lint`：按需求视角 review prompt 修正后复跑，通过。
- `git diff --check`：按需求视角 review prompt 修正后复跑，通过，无 whitespace error。
- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts test/configurators/shared.test.ts test/templates/suncode.test.ts`：按 provider output 截断/示例误解析修正后复跑，169 个用例通过。
- `pnpm --filter @wjptz/suncode run typecheck`：按 provider output 截断/示例误解析修正后复跑，通过。
- `pnpm --filter @wjptz/suncode run lint`：按 provider output 截断/示例误解析修正后复跑，通过。
- `git diff --check`：按 provider output 截断/示例误解析修正后复跑，通过，无 whitespace error。
- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts test/configurators/shared.test.ts`：按 prompt-only review 行为约束修正后复跑，139 个用例通过。
- `pnpm --filter @wjptz/suncode run typecheck`：按 prompt-only review 行为约束修正后复跑，通过。
- `pnpm --filter @wjptz/suncode run lint`：按 prompt-only review 行为约束修正后复跑，通过。
- `git diff --check`：按 prompt-only review 行为约束修正后复跑，通过，无 whitespace error。
- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts test/configurators/shared.test.ts`：按移除 Hub review boundary/file list 修正后复跑，139 个用例通过。
- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts -t "preflight-start skips quick"`：先得到 quick 仍调用 Hub preflight 的预期失败；修复后通过。
- `pnpm --filter @wjptz/suncode exec vitest run test/scripts/task-create-hub.integration.test.ts -t "quick Hub task"`：先得到 `task.py start` 被 failing preflight hook 阻塞的预期失败；修复后通过。
- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts -t "hub plan-ready uploads quick plan artifacts"`：先得到 quick `hubPlanReady` 直接 skipped、不上传 plan 的预期失败；修复后通过。
- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts test/scripts/task-create-hub.integration.test.ts test/configurators/shared.test.ts test/templates/suncode.test.ts`：按 quick plan-ready upload-only 修正后复跑，176 个用例通过。
- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts`：89 个用例通过。
- `pnpm --filter @wjptz/suncode exec vitest run test/commands/hub.test.ts test/scripts/task-create-hub.integration.test.ts test/configurators/shared.test.ts test/templates/suncode.test.ts`：176 个用例通过。
- `pnpm --filter @wjptz/suncode run typecheck`：通过。
- `pnpm --filter @wjptz/suncode run lint`：通过。
- `pnpm --filter @wjptz/suncode run typecheck`：按移除 Hub review boundary/file list 修正后复跑，通过。
- `pnpm --filter @wjptz/suncode run lint`：按移除 Hub review boundary/file list 修正后复跑，通过。
- `pnpm --filter @wjptz/suncode test`：第一次遇到 `init-uninstall-overdelete` 单用例 10s 超时；单独复跑该用例通过；第二次 CLI 包全量 54 个测试文件、1396 个用例通过。
- `pnpm --filter @wjptz/suncode test`：按 quick plan-ready upload-only 修正后复跑，CLI 包全量 54 个测试文件、1396 个用例通过。
- `pnpm run typecheck`：根目录通过，包含 `@wjptz/suncode-core` build 和 CLI typecheck。
- `pnpm run lint`：根目录通过，包含 core/CLI lint。
- `pnpm run typecheck`：按 quick plan-ready upload-only 修正后复跑，根目录通过，包含 `@wjptz/suncode-core` build 和 CLI typecheck。
- `pnpm run lint`：按 quick plan-ready upload-only 修正后复跑，根目录通过，包含 core/CLI lint。
- `node .gitnexus/run.cjs detect-changes --scope all`：变更影响 18 条 Hub 相关流程，风险 critical；风险来自本任务整体覆盖 Hub intake/state/review/finish 与 workflow 模板，已用 Hub command/template 全量测试、CLI 全量测试、typecheck/lint 覆盖。
- `git diff --check`：通过，无 whitespace error。
- `node .gitnexus/run.cjs detect-changes --scope all`：按 quick plan-ready upload-only 修正后复跑，变更影响 23 个文件、73 个 symbols、27 条流程，风险 critical；风险来自本任务整体覆盖 Hub intake/state/review/finish 与 workflow 模板，已用 Hub command/template 全量测试、CLI 全量测试、typecheck/lint 覆盖。

## 回滚点

- 如果 quick 直接 `task.py start` 与 Hub preflight 服务端策略冲突，本地 quick 路径必须跳过 before_start preflight；不要把 quick 静默拉回 standard。
- 如果 `sourceTask` 结构与预期差异大，只保留 safe summary + raw type 提示，不保存未知嵌套字段。
- 如果模板测试大面积失败，优先收窄 workflow 文案变更到 Hub skill 与 Hub state prompt，避免扰动非 Hub 本地流程。
