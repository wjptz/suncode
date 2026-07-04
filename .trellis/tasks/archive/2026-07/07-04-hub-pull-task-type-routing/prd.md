# Hub pull task type routing

## 目标

Hub 拉取/认领任务后，根据 Hub 返回的任务类型路由本地 Suncode 工作流：

- `standard`：保持当前标准流程。
- `quick`：走快速任务流程，减少规划、计划审核、代码 review 等等待成本，尽快实施并 finish。
- `change`：作为需求变更任务处理，Hub 返回的 `sourceTask` 必须进入当前任务上下文，帮助 AI 先理解旧需求再处理变更。

## 已确认事实

- `suncode hub pull` 当前直接请求 `/requirements` 并返回 Hub 原始响应，筛选状态为 `ready,in_review,changes_requested`；本地没有解释任务类型。证据：`packages/cli/src/commands/hub/pull.ts:37`。
- `suncode hub intake` 当前也请求 `/requirements`，但 `normalizeRequirements` 只保留 `id/title/description/revision/status`，不会读取 `quick/standard/change` 或 `sourceTask`。证据：`packages/cli/src/commands/hub/intake.ts:25`、`packages/cli/src/commands/hub/intake.ts:233`。
- intake 创建本地任务时，`task.json.meta.hub` 只保存项目、开发者、需求 ID、需求 revision、taskRole、bindingStatus；没有任务类型或来源任务字段。证据：`packages/cli/src/commands/hub/intake.ts:209`。
- 当前 Phase 1 文案要求 Hub 团队项目在规划完成后运行 `suncode hub plan-ready --task current`，再 `task.py start`；这就是 standard 的现有流程。证据：`packages/cli/src/templates/suncode/workflow.md:197`、`packages/cli/src/templates/suncode/workflow.md:204`。
- `hubPlanReady` 当前串行执行 `submit-plan -> submit-subtasks -> preflight-start`。证据：`packages/cli/src/commands/hub/workflow.ts:43`。
- `task.py start` 会经过 `before_start` Hook；Hub 团队项目默认 `before_start` 为 `suncode hub preflight-start`，`after_start` 会提交 subtasks 并标记 started。quick 任务提交 plan artifacts 后仍必须在本地跳过 before_start preflight，因为 quick 不进入计划审核/启动审核门。证据：`packages/cli/src/templates/suncode/scripts/task.py:95`、`packages/cli/src/templates/suncode/scripts/common/config.py:304`。
- `preflightStart` 在没有已提交 plan 时会使用空 artifact bundle hash，真实 Hub 可能强校验 planSubmissionId；quick 任务即使已上传 plan，也不应调用 Hub preflight。证据：`packages/cli/src/commands/hub/lifecycle.ts:76`。
- `submitSubtasks` 在没有 `subtasks.json` 或 `implement.md` checklist 时会跳过，快速任务不必强制生成 implement checklist。证据：`packages/cli/src/commands/hub/submissions.ts:195`、`packages/cli/src/commands/hub/submissions.ts:795`。
- `suncode hub finish` 当前会校验并上传完成产物：`implementation-summary.md`、`validation-summary.md`、`retrospective.md`、`reuse-assessment.md`，同时提交 spec 与 completion artifacts。证据：`packages/cli/src/commands/hub/workflow.ts:36`、`packages/cli/src/commands/hub/workflow.ts:123`、`packages/cli/src/templates/common/bundled-skills/suncode-hub-finish/SKILL.md:47`。
- 当前 `suncode-hub-requirements` skill 固定要求 planning 完成后运行 `suncode hub plan-ready --task current`，没有 quick/change 分支。证据：`packages/cli/src/templates/common/bundled-skills/suncode-hub-requirements/SKILL.md:24`、`packages/cli/src/templates/common/bundled-skills/suncode-hub-requirements/SKILL.md:28`。

## 任务类型定义

- `standard`：默认类型。缺失或未知类型按 `standard` 处理，保持向后兼容。继续要求 PRD；复杂任务需要 `design.md` 和 `implement.md`；Hub-bound 任务继续走 `plan-ready` 和现有 review/finish 路线。
- `quick`：快速任务。允许 PRD-only 或极简 PRD；默认不要求 `design.md` / `implement.md`；仍运行 `suncode hub plan-ready` 上传 plan/PRD，但 quick 分支不跑 Hub 计划审核和 Hub start preflight；不跑 `suncode hub review` 或 Suncode check-agent review；但仍保留最小确定性验证，并且最终产物必须通过 Hub finish 上传。Hub 启动/完成状态仍应尽量同步，除非 Hub 明确不接受。
- `change`：需求变更。创建任务时必须保留 Hub 返回的 `sourceTask` 摘要，并在 PRD/research 中提示先阅读旧任务/旧需求上下文。执行阶段默认沿用 standard 的严谨流程，除非后续明确支持 `change + quick` 组合。

## 需求

- R1：Hub requirement 解析层必须支持任务类型字段，兼容 `taskType`、`kind`、`type`、`requirementType` 这类可能命名；合法值为 `quick | standard | change`，未知值按 `standard` 并在本地上下文中可见。
- R2：`hub intake` 创建本地任务时，必须把任务类型写入 `task.json.meta.hub.taskType`；`change` 任务还必须写入安全、可读的 `sourceTask` 摘要。
- R3：`quick` 任务的默认 PRD 应明确这是快速任务，并给出极简需求/验收区，不强制生成 `design.md` 和 `implement.md`。
- R4：`change` 任务的默认 PRD 应包含 `sourceTask` 区块，并要求先理解旧需求/旧任务后再改当前任务规划；如有必要，同时生成 `research/source-task.md` 作为可引用资料。
- R5：Hub 状态 prompt、workflow 文案、`suncode-hub-requirements` skill 必须根据当前 Hub task type 给出不同路径：standard 继续完整 plan-ready；quick 先用 plan-ready 上传 plan artifacts 再直接实施；change 先读 sourceTask 再规划。
- R6：quick 路径必须提交 plan/PRD，但跳过计划审核、Hub start preflight 和 Hub code review；不能再由通用文案把 AI 拉回标准计划审核路线。
- R7：standard 现有行为必须不回归。Hub 不返回任务类型时，pull/intake/plan-ready/review/finish 行为应与当前版本保持一致。
- R8：change 的 `sourceTask` 不能变成第二事实源覆盖当前需求；它是旧需求理解资料，当前 Hub requirement 仍是当前任务的权威输入。
- R9：所有新增本地持久化字段必须避免 token、Authorization header、signed URL query、密码等敏感信息。
- R10：quick 任务必须保留最终产物上传：完成前生成必要的完成产物文件，并运行 Hub finish/submit-completion 路线；“快速”只跳过计划审核和代码 review 等等待流程，不跳过 plan/PRD 提交或交付物同步。
- R11：quick 任务必须保留最小确定性验证。能快速运行的定向测试、typecheck、lint 或等价检查应执行；确实不能执行时，必须在 `validation-summary.md` 中写明 `未执行` 和原因，不能写成已验证通过。

## 验收标准

- [ ] `hub intake` 接收到 `taskType: "quick"` 后，创建的 `task.json.meta.hub.taskType` 为 `quick`，默认 PRD 标记快速任务，workflow/skill 提示 `plan-ready` 只用于上传 plan artifacts，不进入计划审核。
- [ ] `hub intake` 接收到缺失类型或 `taskType: "standard"` 后，创建的本地任务与现有 standard 行为兼容，仍提示标准规划和 `plan-ready`。
- [ ] `hub intake` 接收到 `taskType: "change"` 和 `sourceTask` 后，创建的本地任务保存来源任务摘要，PRD/research 中能看到旧任务上下文入口。
- [ ] Hub state prompt 对 Hub-bound quick task 暴露快速路径提示，并明确允许 `plan-ready` 上传 plan artifacts、禁止 Hub code review。
- [ ] `suncode-hub-requirements` skill 对 quick/standard/change 三种任务给出不同流程，不再无条件要求所有 Hub 任务先 `plan-ready`。
- [ ] quick 任务启动前仍提交 plan artifacts；`task.py start` 不调用 Hub start preflight，但仍保留 after_start 的 best-effort Hub 同步。
- [ ] quick 任务 finish 不要求 Hub code review；若 Hub review.required 开启，也应按 quick 任务策略绕过或明确提示配置冲突。
- [ ] quick 任务完成时仍上传 Hub 完成产物和相关 spec artifacts；缺少必要产物时应给出明确错误或生成最小有效产物后再上传。
- [ ] quick 任务的 `validation-summary.md` 至少记录一次最小确定性验证结果；未执行的验证必须明确写 `未执行` 和原因。
- [ ] 现有 Hub pull/intake/plan-ready/finish/review 测试继续通过，并新增三类任务类型的回归测试。

## 非目标

- 不修改 Hub 服务端 API，只适配 Hub 新返回字段。
- 不引入新的 `task.json.status` 状态机，除非实现阶段证明仅靠 `meta.hub.taskType` 无法可靠路由。
- 不把 quick 任务变成无验证、无提交边界的隐式跳过 Git 流程；quick 保留最小确定性验证并如实记录验证状态。
- 不自动把 `sourceTask` 对应旧任务的代码或文件改动套用到当前任务。
