# Research: 第二轮 Hub workflow review 证据（2026-07-04）

基于 commit 5dd1813 之后的工作区。子代理实施前先读本文件获取精确定位。

## 上一轮（07-03）已落地项，本任务不要重做

- `hub intake`（`packages/cli/src/commands/hub/intake.ts`，含 --list/--auto/--requirement/--slug、ambiguous 语义、HUB-REQ 前缀命名）
- `hub plan-ready` / `hub finish`（`packages/cli/src/commands/hub/workflow.ts`）
- `before_start` 阻断 preflight（`packages/cli/src/templates/suncode/scripts/common/task_utils.py:219-246`）
- hub:off 一行降噪（`state.ts:261-263`、Python hook 325 行、OpenCode 插件 108 行）
- sync-queue（`sync-queue.ts` + `hub-sync-queue.jsonl`）
- subtasks.json 派生（`submit-subtasks` 从 `implement.md` 派生，subtasks.json 为 override）

## 问题 1 证据：workflow.md 模板矛盾

文件：`packages/cli/src/templates/suncode/workflow.md`

- 196 行（phase index）：`- 1.4 Structure subtasks [optional override for Hub team projects · once]` —— 已是 optional
- 448 行（小节标题）：`#### 1.4 Structure subtasks \`[required for Hub team projects · once]\`` —— 仍是 required，矛盾点 1
- 511 行附近（1.6 完成标准表）：`| \`subtasks.json\` exists (Hub team projects) | ✅ |` —— 仍必需，矛盾点 2（agent 以此表为完成门槛）
- 474-480 行：展示 `after_start` hook 内部命令 `suncode hub submit-subtasks --task-json "$TASK_JSON_PATH" --best-effort` + "Then it marks the Hub task as started." —— CLI 实现细节，应删
- 171 / 205 / 219 行：已是派生 + override 语义，保持一致即可

## 问题 2 证据：intake 未内置 spec 同步

- `intake.ts` 全文无 `pullHubSpecs` 引用（已 grep 确认）
- `hubIntake` 主流程（intake.ts:32-94）：resolveHubConfig → 拉 requirements → selectRequirement → createLocalHubTask → setCurrentSessionTask → hubCreateTask → 返回。插入点在 hubCreateTask（82-88 行）之后
- `pullHubSpecs(options: HubSpecOptions)`（specs.ts:157），`HubSpecOptions = { cwd?, env?, homeDir?, fetch? }`（specs.ts:113-118）—— 与 intake 的 options 透传通道完全对齐，测试可 mock fetch
- `HubSpecSyncResult`（specs.ts:81-97）：`status: "disabled"|"skipped"|"updated"`，`actions: { added[], updated[], deleted[], unchanged }`，`localOnly[]`，`deletionCandidates[]` —— 摘要行数据源
- 当前 skill 链：`suncode-hub-requirements/SKILL.md` 第 4 步 → 跳转 `suncode-hub-spec-sync` skill → `suncode hub pull-spec --json`

## 问题 3 证据：finish 对未绑定任务静默跳过

- `submissions.ts:187-191` 与 271-275：`remoteTaskId = task.meta.remoteTaskId ?? manifest.remoteTaskId`；无则 `return { status: "skipped", message: "Task is not bound to a remote Hub task." }` —— exit 0
- `hubFinish`（workflow.ts:82-93）：`assertCompletionArtifactsPresent → submitSpec → submitCompletion`，无绑定检测 —— unbound 时输出 `finish: submit-spec skipped (...); submit-completion skipped (...)` 且整体 exit 0，completion 实际未提交
- `hubCreateTask` 幂等（create-task.ts）：已绑定 → `skipped: "Task already bound to Hub task <id>"`（52-53 行）；无 `meta.hub.requirementId` → `skipped: "ordinary local task skipped"`（67-68 行）；成功 → `bound`（130-135 行）
- `readHubTask(taskJsonPath, cwd)`（task.ts:241）返回含 `meta.remoteTaskId`（task.ts:330）的 HubTaskContext
- `classifyHubTaskState`（state.ts:282-307）：三态判定参考（bound / pending / local-only）—— finish 的三态设计与之对齐
- 当前 `suncode-hub-finish/SKILL.md` Flow 5 步：current --source → create-task 修绑定 → sync + pull-review → download-document → hub finish

## 测试基建

- `packages/cli/test/commands/hub.test.ts`：现有 intake / finish / plan-ready 测试均用 mock fetch + temp dir 模式，直接沿用
- 验证命令（packages/cli 目录）：`pnpm exec vitest run test/commands/hub.test.ts`、`pnpm run typecheck`、`pnpm run lint`、全量 `pnpm test`
- 模板文案断言可能落在 `test/configurators/shared.test.ts` 等文件，改 workflow.md 后需跑一次确认

## 明确不做（本轮 review 的 P2，另立任务）

- Python hook（`inject-workflow-state.py:329-368`）与 OpenCode 插件（`inject-workflow-state.js:113-156`）pre-check 分支长句降噪、`workflow:primary` 行移除
- hub state 缓存 TTL（当前每轮 spawn `suncode hub state --prompt --hook`，无 cache）
- `hub --help` 27 入口分层提示、4 skills 合并 router、runJson 输出精简
