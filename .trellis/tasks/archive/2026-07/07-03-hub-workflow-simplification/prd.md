# Hub Workflow Simplification

## Goal

将 Suncode Hub 协作从“AI 串联多个低层命令”收敛为“AI 表达意图，CLI 执行可测试状态机”的工作流。当前任务覆盖 `hub-workflow-review.md` 中的 P1 和 P2：先降低 AI 操作负担并补齐 start/review/finish gate，再统一 Hub 状态机、hook 输出、失败重试队列、命名和文档分层。

## Background

- 根目录 [hub-workflow-review.md](../../../hub-workflow-review.md) 记录了本任务的完整 review 依据、P1/P2 分层、命令语义和命名策略。
- 当前 Hub 已有低层命令，例如 `pull`、`create-task`、`pull-spec`、`submit-plan`、`submit-subtasks`、`preflight-start`、`review`、`submit-spec`、`submit-completion` 等。
- 当前 Python hook 和 OpenCode JS plugin 都会注入 `<hub-state>`；OpenCode 需要保留 JS plugin 入口，但 Hub 状态判断应收敛到 CLI，避免两份业务逻辑漂移。
- 当前 `preflight-start` 和 `hub.startReviewPolicy` 已存在，但 workflow 对 `task.py start` 前置 gate 的接线不够强。
- 当前 `subtasks.json` 是 AI 手工维护的派生 artifact，应该降级为 CLI 可生成、人工可覆盖的结构化数据。
- 当前 `submit-spec` 是显式命令，通过 `.suncode/hub-spec-manifest.json` 的 `lastSubmittedSha256` 判断 `.suncode/spec/**` 是否需要上传。

## Requirements

### P1: workflow gate and AI burden reduction

1. `task.py start` 前必须有 Hub preflight gate。
   - 首选实现是新增 `before_start` hook / pre-start gate：`task.py start` 对 Hub-bound task 先执行 `preflight-start`，通过后才把本地任务切到 `in_progress`。
   - `preflight-start` 和 `task.py start` 在用户心智上属于同一个“开始任务”动作，但职责不同：前者做远端 Hub 开始前校验，后者做本地状态切换和 active task 绑定。
   - `before_start` 只应在 Hub-bound task 且 Hub 可用/已配置时产生影响；Hub off、local-only task、未绑定 task 不应被干扰。
   - `hub.startReviewPolicy` 的 `confirm` / `block` / `bypass` 行为必须清楚映射到 CLI 结果。
   - 如果新增 `before_start` hook 实在困难，可接受在 `task.py start` 内部直接识别 Hub-bound task 并调用 Hub preflight；但这只是 fallback，因为它会让 Python task 脚本知道更多 Hub 业务。

2. 新增高层计划命令：
   - 命令形态：`suncode hub plan-ready --task current`。
   - 内部完成 `submit-plan`、auto subtasks、`submit-subtasks`、`preflight-start`。
   - 输出结构化结果：`ok`、`needs_confirmation`、`blocked`、`skipped`、`error`。

3. 自动生成 structured subtasks。
   - `subtasks.json` 不再是 Hub team task 的必写 AI artifact。
   - CLI 必须能从 `implement.md` 生成默认 structured subtasks。
   - 如果存在 `subtasks.json`，它作为人工/AI override。
   - 生成失败时必须返回结构化缺口，不要静默跳过。

4. `<hub-state>` 降噪。
   - Hub off 默认静默，或只输出一行极短 guardrail。
   - Hub on 但当前 task local-only 时，只输出最小 `do-not` guardrail。
   - Hub-bound task 才输出完整、机器可读的 Hub state。
   - Hub 状态刷新失败必须 fail closed，不得用 stale cache 显示 Hub 可用。

5. 新增高层完成命令：
   - 命令形态：`suncode hub finish --task current`。
   - 内部处理 required review gate、completion artifact 检查、`submit-spec`、`submit-completion`。
   - 缺少 completion artifact 时返回明确缺口。
   - `suncode-hub-finish` skill 改成调用该命令并解释结果。

### P2: state machine, reliability, naming, and documentation

6. 新增 Hub workflow state module。
   - 集中定义 Hub config/login/service/current-task/spec/review/allowed-actions/blocked-reason/next-action 状态。
   - `suncode hub state --json` 输出状态码和 allowed/blocked actions。
   - 新增 `suncode hub state --prompt --hook`，由 CLI 生成 `<hub-state>` prompt block。

7. 收敛 Python hook 与 OpenCode JS plugin 的 Hub 逻辑。
   - 保留 OpenCode JS plugin 入口。
   - Python hook 和 OpenCode JS plugin 都只做平台适配、上下文解析、短超时调用 CLI、注入 CLI 输出。
   - Hub 状态判断和 prompt 文案由 CLI 单点维护。

8. 新增 Hub sync failure queue。
   - best-effort lifecycle hook 失败写入 `.suncode/.runtime/hub-sync-queue.jsonl`。
   - `suncode hub state` 显示 `pendingSyncCount`。
   - 新增 `suncode hub sync-pending` 用于重试。
   - archive/finish 时如果当前 task 有 pending critical sync，必须明确提醒。

9. 梳理 `projectId` / `project_key` 命名。
   - 对外新文档优先使用 `projectKey`，或明确说明 `hub.projectId` 当前实际存的是 Agent Hub `project_key`。
   - CLI 内部可保留 `projectId` 做兼容。
   - `/api/agent-hub` 相关 helper 和 docs 使用 `projectKey` 语义。

10. 梳理 Hub command 文档分层。
    - 默认用户/AI 层只突出：`state`、`intake`、`plan-ready`、`review`、`finish`。
    - 现有低层命令保留，但在 docs 中标为 advanced/debug。
    - `knowledge`、`skill-push`、`skill-pull` 作为独立能力，不进入默认 task lifecycle。

11. 加强 contract/golden tests。
    - 覆盖 `hub state --json`、`hub state --prompt --hook`、hook 输出、OpenCode plugin 输出。
    - 覆盖 `intake` 多候选 ambiguous、单候选 auto、显式 `--requirement`。
    - 覆盖 `plan-ready` 的 submit-plan / subtasks / preflight 编排。
    - 覆盖 `finish` 的 review gate、spec submission、completion submission。
    - 覆盖 sync failure queue 的写入、状态展示、重试。

12. `intake` 多候选不得盲接。
    - 多个 available requirements 时，`suncode hub intake` 必须返回 ambiguous/list，不创建本地 task。
    - AI 只能通过 `--requirement <id>` 或用户明确选择后领取。
    - `--auto` 只允许在恰好 1 个候选时创建任务；候选数大于 1 时仍返回 ambiguous。

13. 自动接 Hub 需求并创建本地任务时，任务名必须以 `HUB-REQ-` 开头。
    - 适用范围：`suncode hub intake` / claim 自动创建的本地 task。
    - `task.json.title` 和 `task.json.name` 必须以 `HUB-REQ-<requirementId>` 开头，例如 `HUB-REQ-128 优化 Hub 接任务流程`。
    - 本地目录 slug 仍保持 ASCII，例如 `07-03-hub-req-128` 或 `07-03-hub-req-128-hub-api`。
    - 中文需求标题保留在展示名和 PRD 中，不做默认翻译或拼音。
    - 如果用户显式传 `--slug`，仍应保留 `hub-req-<id>` 前缀，除非未来增加清晰的 expert override。

## Out of Scope

- 不重写 Hub 后端服务；本任务以 CLI、模板、hook、docs、tests 为主。
- 不删除现有低层 Hub 命令；只降低默认 workflow 暴露面。
- 不移除 OpenCode JS plugin；只收敛其 Hub 状态业务逻辑。
- 不让 CLI 在多个可接需求中基于优先级、更新时间或列表顺序自动猜测要接哪个。
- 不默认把中文 title 翻译成英文 slug 或拼音 slug。

## Acceptance Criteria

- [ ] P1 和 P2 范围都在 task artifacts 中明确记录，并与 `hub-workflow-review.md` 一致。
- [ ] Hub-bound task start 前有可测试的 `preflight-start` gate 或明确的 workflow 前置命令接线。
- [ ] `before_start` gate 不干扰 Hub off、local-only、未绑定或普通本地任务。
- [ ] `suncode hub plan-ready --task current` 能编排 plan submission、subtasks submission 和 start preflight，并输出结构化结果。
- [ ] `subtasks.json` 变为可选 override；无 override 时 CLI 能从 `implement.md` 生成默认 structured subtasks。
- [ ] `<hub-state>` 对 Hub off/local-only 场景降噪，对 Hub-bound 场景输出机器可读状态。
- [ ] `suncode hub finish --task current` 能统一处理 required review gate、spec submission、completion submission 和缺口提示。
- [ ] Hub workflow state 的状态码、allowed actions、blocked reasons 由 CLI 单点生成。
- [ ] Python hook 和 OpenCode JS plugin 保留各自平台入口，但 Hub 状态判断不再重复实现。
- [ ] best-effort Hub sync 失败能落入可见队列，并可通过 `sync-pending` 重试。
- [ ] Hub intake 多候选返回 ambiguous，不自动创建任务。
- [ ] Hub intake 自动创建的本地 task `title` / `name` 以 `HUB-REQ-` 开头，中文标题保留在展示文本和 PRD 中。
- [ ] Team Hub docs 只把 `state`、`intake`、`plan-ready`、`review`、`finish` 作为默认动作；低层命令归入 advanced/debug。
- [ ] 新增或更新测试覆盖上述状态机、命令编排、hook prompt、OpenCode plugin、命名和 sync queue 行为。

## Open Questions

当前没有阻塞规划的问题。实现时需要用现有后端 API fixture 校准字段名和 endpoint 响应，但这属于实现期验证，不阻塞进入设计。
