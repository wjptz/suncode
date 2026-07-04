# Hub workflow 减负第二轮：模板矛盾修复与 intake/finish 编排内聚

## Goal

在 07-03 Hub workflow simplification（P1 已落地：`intake` / `plan-ready` / `finish` / `before_start` gate / hub:off 降噪 / sync-queue）的基础上，消除第二轮 review 发现的三个残留负担，使 Hub-bound 任务的 agent 默认流程收敛为：`intake` → 写规划 → `plan-ready` → `task.py start` → 实现 → `review` → `finish`，中间不再需要 agent 手工跑 `pull-spec` / `create-task` 分支步骤，也不再被模板矛盾诱导手写 `subtasks.json`。

## Background

第二轮 review（2026-07-04，基于 5dd1813 之后的代码）发现三个问题：

1. **workflow.md 模板自相矛盾**：phase index（`packages/cli/src/templates/suncode/workflow.md` 196 行）已把 1.4 标注为 `[optional override for Hub team projects · once]`，但 1.4 小节标题（448 行）仍是 `[required for Hub team projects · once]`，且 1.6 完成标准表（511 行附近）仍有 `subtasks.json exists (Hub team projects) | ✅` 必需行。agent 以完成标准表为准，会继续每个 Hub 任务手写 `subtasks.json`，上一轮"CLI 派生 subtasks"的减负实际失效。
2. **`hub intake` 未内置 spec 同步**：`intake.ts` 无 `pullHubSpecs` 调用。`suncode-hub-requirements` skill 第 4 步要求 agent 跳转 `suncode-hub-spec-sync` skill 再跑 `suncode hub pull-spec --json`，多一次 skill 链式跳转和一条手工命令。第一轮 review 中 intake 的设计目标（内部第 7 步拉取 Hub authoritative spec）未落地。
3. **`hub finish` 对未绑定任务静默跳过**：`submitSpec` / `submitCompletion` 对无 `remoteTaskId` 的任务返回 `skipped`（exit 0，`"Task is not bound to a remote Hub task."`），`hubFinish` 不检测绑定。结果是 completion 未提交但命令成功返回。`suncode-hub-finish` skill 因此保留了 5 步手工流程（含"未绑定就跑 `create-task` 修复"）。

## Requirements

### R1: workflow.md 模板 subtasks.json 语义统一

1. 1.4 小节标题从 `[required for Hub team projects · once]` 改为 `[optional override for Hub team projects · once]`，与 phase index 一致。
2. 1.6 完成标准表中 `subtasks.json exists (Hub team projects)` 行从必需（✅）改为 override 场景下的可选项，或从表中移除并在表外一句话说明派生规则。
3. 1.4 正文删除 `after_start` hook 内部命令展示（`suncode hub submit-subtasks --task-json "$TASK_JSON_PATH" --best-effort` 代码块及其上下文），这是 CLI 实现细节；保留"何时需要 override + override 格式示例"。
4. 模板中其余 `subtasks.json` 相关表述（171、196、205、219、450 行附近）语义保持一致：默认由 `implement.md` 派生，仅覆盖时手写。

### R2: `hub intake` 内置 Hub spec 同步

1. `hubIntake` 在远端绑定（`hubCreateTask`）完成后自动执行 Hub spec 拉取（复用 `pullHubSpecs`），claim 主流程成功不再要求 agent 单独执行 `suncode hub pull-spec`。
2. intake 输出追加一行 spec 同步摘要（如 `spec: updated 2, deleted 1 preserved, local-only 3`），与现有 message 风格一致。
3. spec 拉取为非阻塞增强步骤：失败时本地任务与远端绑定保留，intake 整体不回滚，message 明确标注 spec 同步失败及修复命令（`suncode hub pull-spec`）；不阻塞后续规划与实施流程。
4. `--list` 与 ambiguous / no-work 路径不触发 spec 拉取。
5. `suncode-hub-requirements` skill 移除"写规划 artifacts 前先用 `suncode-hub-spec-sync`"步骤，改为"intake 已自动同步 spec；若输出显示 spec 同步失败，可用 `suncode hub pull-spec` 重试，不阻塞规划"。
6. `suncode-hub-spec-sync` skill 的 description 与正文调整为恢复 / 手动刷新 / 同步失败重试场景，不再作为每次规划前的默认步骤；正文中"同步成功前不要规划或实现 Hub 任务"的阻塞表述放松为非阻塞提示。

### R3: `hub finish` 内置绑定确保，未绑定不再静默跳过

1. `hubFinish` 在 completion artifact 检查后增加绑定确保步骤：任务无 `remoteTaskId`（含 manifest 兜底后仍无）时自动调用 `hubCreateTask` 修复绑定。
2. 自动绑定成功后继续 `submit-spec` / `submit-completion`；自动绑定失败时整体返回错误（非 0 退出），错误信息包含失败原因，不得再出现"unbound 但整体 exit 0 且 completion 未提交"的结果。
3. 绑定步骤计入 workflow steps 汇总输出（与 `submit-spec` / `submit-completion` 同格式）。
4. `suncode-hub-finish` skill 的 Flow 精简：删除"未绑定就跑 create-task"与默认的 `sync` + `pull-review` 步骤；主流程为"确认当前任务 → `suncode hub finish --task current` → 按结构化缺口处理"；`sync` / `pull-review` / `download-document` 降级为"仅当用户提到需求变更或评审意见时"的按需注记。

## Out of Scope

- P2 项：Python/OpenCode hook pre-check 分支降噪、`workflow:primary` 行移除、hub state 缓存 TTL、`hub --help` 分层提示、4 个 hub skills 合并为 router skill、`runJson` 命令输出精简（另立任务）。
- docs-site / marketplace submodule 内容更新。
- Hub 服务端 / API 行为变更。
- `plan-ready`、`review`、`before_start` gate 现有行为变更。

## Acceptance Criteria

- [ ] `workflow.md` 模板中 `subtasks.json` 的所有表述一致为 optional override；1.6 表不再把它列为 Hub team 项目的必需完成条件；1.4 不再展示 hook 内部命令。
- [ ] `hub intake` 成功 claim 后无需手工 `pull-spec`：单元测试覆盖"绑定成功 → 自动拉 spec → message 含 spec 摘要"。
- [ ] `hub intake` 在 spec 拉取失败时保留任务与绑定，message 含失败标注与修复命令；单元测试覆盖。
- [ ] `hub intake --list` / ambiguous 路径不发起 spec 请求；单元测试覆盖。
- [ ] `hub finish` 对未绑定任务自动绑定后完成提交；绑定失败时以错误退出；两条路径均有单元测试。
- [ ] `suncode-hub-requirements` / `suncode-hub-spec-sync` / `suncode-hub-finish` 三个 skill 文案与新行为一致，不再包含已内聚步骤。
- [ ] packages/cli 的 `vitest run`、`eslint`、`tsc --noEmit` 全部通过。
