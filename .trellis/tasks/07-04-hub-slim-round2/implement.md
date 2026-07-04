# Implement: Hub workflow 减负第二轮

依赖顺序：Step 1（R1 模板）独立；Step 2（R2 intake）与 Step 3（R3 finish）独立可并行；Step 4（skills）依赖 2、3 的行为定型；Step 5 验证收尾。每个 Step 结束是一个回滚点。

## Step 1: workflow.md 模板 subtasks.json 语义统一（R1）

- [ ] `packages/cli/src/templates/suncode/workflow.md` 448 行小节标题改为 `[optional override for Hub team projects · once]`
- [ ] 1.4 正文删除 `after_start` hook 内部命令代码块与 "Then it marks the Hub task as started." 段；Rules 压缩，保留 override 格式示例
- [ ] 1.6 完成标准表删除 `subtasks.json exists (Hub team projects)` 行，表后补一句派生规则说明
- [ ] 全文核对 `subtasks.json` 各处表述（171 / 196 / 205 / 219 行附近）用词一致
- [ ] 验证：`grep -n "required for Hub team projects" packages/cli/src/templates/suncode/workflow.md` 无输出；`grep -c "subtasks.json" ...` 各处语义抽查
- [ ] 验证：若 `pnpm exec vitest run test/configurators/shared.test.ts` 或其它模板断言测试引用被改文案，同步更新并通过

回滚点：仅模板文案，`git checkout` 单文件即可。

## Step 2: `hub intake` 内置 spec 同步（R2）

- [ ] `intake.ts`：import `pullHubSpecs`（`./specs.js`），在 `hubCreateTask` 之后调用，透传 `cwd/env/homeDir/fetch`
- [ ] 新增私有 `formatSpecSyncSummary(result)`：`updated` → `spec: +N ~N -N(preserved) local-only N`（零值段省略）；`skipped` → `spec: up-to-date`
- [ ] 失败路径：try/catch 包裹，message 追加 `spec sync FAILED (<原因>); retry: suncode hub pull-spec`，不回滚任务与绑定，不阻塞流程，整体 status 保持 bindResult.status
- [ ] 测试（`test/commands/hub.test.ts`）：
  - [ ] claim 成功 → spec 端点被请求，message 含 `spec:` 摘要
  - [ ] spec 请求失败 → 任务目录与 `meta.hub` 保留，message 含 `spec sync FAILED` 与修复命令
  - [ ] `--list` 与 ambiguous 路径 → 断言 fetch 请求列表不含 spec 端点
- [ ] 验证：`pnpm exec vitest run test/commands/hub.test.ts`（packages/cli 下）

回滚点：intake.ts + 测试，独立 revert 不影响 Step 1/3。

## Step 3: `hub finish` 内置绑定确保（R3）

- [ ] `workflow.ts`：`hubFinish` 在 `assertCompletionArtifactsPresent` 后读取 task（`readHubTask`），实现三态：
  - [ ] 已绑定（remoteTaskId 或 bindingStatus=bound）→ 行为与输出保持现状
  - [ ] hub-pending（有 requirementId 无 remoteTaskId）→ `hubCreateTask` 自动绑定，成功记入 steps（name: `bind`）后继续提交；失败抛错（非 0 退出）
  - [ ] local-only（无 requirementId）→ 返回 `skipped` + "local-only task; Hub finish not applicable" message，不发起任何 Hub 请求
- [ ] 核对 `SubmitSpecOptions` 是否含 `homeDir`；缺则补透传（不破坏类型别名）
- [ ] 测试：
  - [ ] hub-pending 任务 finish → steps 含 `bind`，completion 提交成功
  - [ ] 绑定接口失败 → 抛错且错误含原因
  - [ ] local-only 任务 finish → skipped，无 Hub 请求
  - [ ] 已绑定任务 finish → 输出与现状一致（回归）
- [ ] 验证：`pnpm exec vitest run test/commands/hub.test.ts`

回滚点：workflow.ts + 测试，独立 revert。

## Step 4: skills 文案对齐（R2.5 / R2.6 / R3.4）

- [ ] `suncode-hub-requirements/SKILL.md`：第 4 步替换为 intake 自动同步说明 + 非阻塞失败重试指引
- [ ] `suncode-hub-spec-sync/SKILL.md`：description 与开头定位改为恢复 / 手动刷新 / 同步失败重试场景；正文"同步成功前不要规划或实现"阻塞句改为非阻塞提示，其余流程不动
- [ ] `suncode-hub-finish/SKILL.md`：Flow 缩为 3 步（确认任务 → `hub finish` → 按输出处理）；`create-task` 步骤删除；`sync` / `pull-review` / `download-document` 移入按需注记
- [ ] 核对三个 skill 中不再出现"规划前必跑 pull-spec"与"未绑定手工 create-task"表述

回滚点：纯模板文案。

## Step 5: 全量验证（Phase 2.2 最后一轮全范围检查）

- [ ] `pnpm exec vitest run test/commands/hub.test.ts`（packages/cli）
- [ ] `pnpm run typecheck`（packages/cli）
- [ ] `pnpm run lint`（packages/cli）
- [ ] `pnpm test`（packages/cli 全量，确认无跨文件回归）
- [ ] `python3 .trellis/scripts/task.py validate .trellis/tasks/07-04-hub-slim-round2`

## Review gates

- Step 1 完成后：人工抽查 workflow.md 渲染后 1.4/1.6 语义（无矛盾、无 hook 内部命令）。
- Step 2/3 完成后：核对 intake/finish 输出 message 实际样例（测试断言中的字符串）是否对 agent 可读、可行动。
- Step 4 完成后：通读三个 SKILL.md 全文，确认与 CLI 新行为零冲突。
