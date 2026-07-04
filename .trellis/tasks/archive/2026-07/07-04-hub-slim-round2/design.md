# Design: Hub workflow 减负第二轮

## 总体思路

三个改动都遵循同一原则：把"agent 按说明书做分支判断"改为"CLI 内部确定性编排 + 结构化结果"。不新增命令、不改 API 契约、不动 `plan-ready` / `review` / `before_start` gate 现有行为。

## R1: workflow.md 模板 subtasks.json 语义统一

改动文件：`packages/cli/src/templates/suncode/workflow.md`

1. 448 行小节标题：`#### 1.4 Structure subtasks \`[required for Hub team projects · once]\`` → `[optional override for Hub team projects · once]`。
2. 1.4 正文（450-480 行区域）：
   - 保留：何时需要 override（派生的 `implement.md` checklist 不满足展示需求时）、override JSON 格式示例、"仅描述当前任务"规则。
   - 删除：`after_start` hook 内部命令代码块（`suncode hub submit-subtasks --task-json "$TASK_JSON_PATH" --best-effort`）及"Then it marks the Hub task as started."段落 —— hook 编排是 CLI 内部实现，agent 无需感知。
   - Rules 列表压缩为 3-4 条（override 粒度、字段、仅当前任务、默认派生可跳过）。
3. 1.6 完成标准表：`| \`subtasks.json\` exists (Hub team projects) | ✅ |` 行删除，紧随表后已有/新增一句说明："Hub team 项目的 structured subtasks 默认由 `implement.md` 派生，仅在需要覆盖时提供 `subtasks.json`。"（避免表格里出现"conditional optional"这种模糊标记）。
4. 核对 171 / 196 / 205 / 219 行的既有表述（已是 optional override 语义），确保用词一致（"derived from `implement.md`"、"override"）。

不改 `getting-started` 或平台标记块结构；1.4 节的平台标记（`[/Claude Code, ...]`）保持原位。

## R2: `hub intake` 内置 Hub spec 同步

改动文件：`packages/cli/src/commands/hub/intake.ts`

### 插入点

`hubIntake()`（intake.ts:82-93）在 `hubCreateTask` 返回后、构造最终 message 前追加：

```ts
const specResult = await syncSpecsAfterIntake({
  cwd,
  env: options.env,
  homeDir: options.homeDir,
  fetch: options.fetch,
});
```

`pullHubSpecs(options: HubSpecOptions)` 已支持 `cwd/env/homeDir/fetch`（specs.ts:113-118），直接透传即可，测试可用现有 `options.fetch` mock 通道。

### 结果语义

| spec 拉取结果 | intake 行为 |
| --- | --- |
| `updated` | message 追加 `spec: +N ~N -N(preserved) local-only N`（从 `HubSpecSyncResult.actions` / `localOnly` 生成；为 0 的段省略） |
| `skipped`（无变更） | message 追加 `spec: up-to-date` |
| `disabled` | 理论不可达（intake 已通过 enabled 检查）；按失败处理 |
| 抛错 | 捕获，不回滚任务与绑定；message 追加 `spec sync FAILED (<原因>); retry: suncode hub pull-spec`；整体 status 保持 bindResult.status（任务创建成功的事实不因 spec 失败被掩盖，失败信息由 message 承载） |

关键点：spec 同步是非阻塞增强步骤（用户决策 2026-07-04）。失败不抛出到顶层、不回滚、不阻塞后续规划与实施；message 提示修复命令即可。

`--list`、ambiguous、no-work、requirement-not-found 路径在 `selectRequirement` 返回前退出，天然不触发 spec 拉取。

### 摘要格式函数

intake.ts 内新增私有 `formatSpecSyncSummary(result: HubSpecSyncResult): string`，不放 specs.ts（单一调用方，避免过早抽象）。

## R3: `hub finish` 内置绑定确保

改动文件：`packages/cli/src/commands/hub/workflow.ts`

### 插入点

`hubFinish()`（workflow.ts:82-93）在 `assertCompletionArtifactsPresent` 后增加 ensure-bound 步骤：

```ts
const task = readHubTask(options.taskJsonPath, cwd);
```

三态处理：

| 任务状态 | 行为 |
| --- | --- |
| `meta.hub.remoteTaskId` 已存在（或 bindingStatus=bound） | 不加 bind step，直接提交（保持现有输出格式不变） |
| 有 `meta.hub.requirementId` 但无 remoteTaskId（hub-pending / failed） | 调用 `hubCreateTask({ cwd, taskJsonPath, env, homeDir, fetch })`；成功（`created`/`skipped: already bound`）→ 记入 steps（name: `bind`）并继续；失败 → 直接抛错（`hub finish` 非 0 退出），错误信息含原因 |
| 无 `meta.hub.requirementId`（local-only 任务） | 返回 `{ status: "skipped", message: "local-only task; Hub finish not applicable, use normal finish workflow." }`，不再进入 submit 流程 —— 消除现状"跑两个 submit 各自 skipped"的噪音输出 |

`hubCreateTask` 幂等（create-task.ts:52 已绑定返回 skipped），重复调用无害。

注意：`HubFinishOptions = SubmitSpecOptions` 已含 `env/homeDir/fetch` 透传能力（需实现时核对 `SubmitSpecOptions` 字段；若缺 `homeDir` 则补充透传，保持类型别名不破坏调用方）。

### 不再依赖 submissions 的静默 skip

`submitSpec` / `submitCompletion` 内部的 "not bound → skipped" 分支保留不动（低层命令单独使用时语义合理）；`hubFinish` 通过前置 ensure-bound 保证走到 submit 时必已绑定。

## Skills 文案（R2.5 / R2.6 / R3.4）

1. `packages/cli/src/templates/common/bundled-skills/suncode-hub-requirements/SKILL.md`
   - 第 4 步（spec-sync skill 跳转 + `pull-spec --json` 代码块）替换为一句："`hub intake` 已自动同步 Hub spec；若 intake 输出包含 `spec sync FAILED`，可运行 `suncode hub pull-spec` 重试；spec 同步失败不阻塞规划。"
2. `packages/cli/src/templates/common/bundled-skills/suncode-hub-spec-sync/SKILL.md`
   - description 改为：恢复会话 / 用户要求手动刷新 / intake 或 plan-ready 报 spec 同步失败时使用；删除"规划前默认步骤"定位。正文流程保留（pull-spec、删除候选复盘不变），但"命令失败或超时时……同步成功前不要规划或实现 Hub 任务"的阻塞句改为非阻塞提示（说明失败可稍后重试，不阻塞任务进行）。
3. `packages/cli/src/templates/common/bundled-skills/suncode-hub-finish/SKILL.md`
   - Flow 从 5 步缩为 3 步：确认当前任务（`task.py current --source`）→ `suncode hub finish --task current` → 按输出处理（missing artifacts → 补文件重跑；bind 失败 → 报告用户；skipped local-only → 走普通 finish）。
   - `sync` / `pull-review` / `download-document` 移入"按需"注记：仅当用户提到需求变更或 Hub 评审意见时执行。
   - 删除"未绑定就跑 `suncode hub create-task`"步骤。

## 测试设计

文件：`packages/cli/test/commands/hub.test.ts`（沿用现有 mock fetch / temp dir 模式）

R2：
1. intake 成功 claim → fetch 序列包含 spec bundle 请求，message 含 `spec:` 摘要。
2. spec 请求失败（mock 500/网络错）→ 任务目录与 `meta.hub` 绑定仍在，message 含 `spec sync FAILED` 与 `pull-spec` 提示。
3. `--list` / ambiguous → fetch 未收到 spec 请求（断言请求 URL 列表）。

R3：
4. hub-pending 任务（有 requirementId 无 remoteTaskId）跑 finish → 先 create-task 再 submit，steps 输出含 `bind`。
5. 绑定失败（mock create-task 接口错误）→ 抛错（run() 非 0 退出路径），错误含原因。
6. local-only 任务跑 finish → `skipped` + "not applicable" message，无任何 Hub 请求。
7. 已绑定任务跑 finish → 输出格式与现状一致（回归保护）。

R1 为纯模板文案，无行为测试；若现有 template 快照/字符串断言测试引用了被改文案（如 `configurators/shared.test.ts`、workflow 相关断言），同步更新。

## 兼容性与回滚

- 无 API / 配置 / manifest 格式变更；`subtasks.json` 仍被 `submit-subtasks` 优先读取（override 语义不变）。
- intake 新增的 spec 请求对旧 Hub 服务端就是既有 `pull-spec` 端点，无新端点依赖。
- 回滚单位：三个 R 各自独立成 commit-able 改动；任一项回滚不影响其余两项。
