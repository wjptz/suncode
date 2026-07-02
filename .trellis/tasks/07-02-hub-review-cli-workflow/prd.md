# Hub Review CLI workflow

## 目标

为 Suncode Hub 增加以 task 为中心的 review 编排能力：用户或 AI 只需运行 `suncode hub review`，Suncode 自动完成当前 Hub-bound task 的 review round 创建、上下文收集、provider 调用、review artifact 落盘、Hub 同步和状态更新。AI 不负责临场拼 prompt 或维护 review 状态，只负责读取 `changes_requested` 结果后修改代码，并在通过后继续 finish。

## 背景与已确认事实

- 当前 CLI 已有 Hub 基础能力：task 绑定、artifact upload session、MinIO 上传、`submit-plan`、`submit-completion`、`pull-review`、`preflight-start`、task status patch。
- 当前 `HubArtifact["type"]` 已覆盖 plan/spec/completion，但没有 review artifact 类型。
- 当前 `submitArtifacts` 流程已有可复用结构：收集 artifact、计算 bundle hash、创建 upload session、上传 MinIO、提交 submission、写 manifest。
- 当前 `.trellis`/`.suncode` task 数据模型已有 `status`、`branch`、`base_branch`、`commit`、`pr_url` 等字段，可以承载 review gate 与 finish gate 的状态判断。
- Engineer 已作为 OpenCode-compatible 平台接入 `suncode init --engineer`，后续 Hub review 的第一版 provider 以 Engineer 为目标，但 review skill 应作为通用 bundled skill 分发到所有平台。
- 用户明确要求：尽量少新增 Hub 后端接口；状态同步、文件上传、finish 流程优先复用已有 Hub 能力。
- 用户明确要求：Suncode CLI 做大部分编排工作，AI 只触发 review、读取结果、修代码、重新 review。
- 第一版 `hub.review.required` 默认值采用 `false`。review 会同步 Hub，但默认不阻塞 `submit-completion`；团队需要强制 gate 时显式配置 `required: true`。

## 需求

1. 新增通用 bundled skill `suncode-hub-review`，安装到所有支持 skill 的平台；`suncode init --engineer` 生成 `.engineer/skills/suncode-hub-review/SKILL.md`。
2. 新增 `hub.review` 配置，最小支持：
   - `enabled`
   - `provider`
   - `required`
   - `trigger`
   - `unavailablePolicy`
   - provider 级命令配置，第一版支持 Engineer。
3. 新增 `suncode hub review` 命令，以当前或指定 task 为中心自动执行一轮 review。
4. `suncode hub review` 必须自动处理：
   - 定位 Hub-bound task。
   - 判断 review 是否启用、provider 是否可用。
   - 自动计算 review round。
   - 收集 task artifacts、相关 spec、当前 diff、上一轮 review 结果。
   - 生成 provider prompt。
   - 调用 provider。
   - 解析结构化 review 结果。
   - 写入 `reviews/round-NNN/`。
   - 复用 Hub artifact upload 同步 review 文件。
   - 复用 task status 接口同步 `in_review`、`changes_requested`、`approved`。
5. review 不可用时不得污染现有流程：
   - `hub.review.enabled` 为 false 或 provider 不可用且策略允许 bypass 时，不新增 review 状态，不阻塞原有 completion。
6. review 结果必须机器可解析，不能仅依赖自然语言。
7. review 必须默认 report-only。provider 执行前后应检查工作树；如果 reviewer 修改了文件，不能视为 approved。
8. review approved 必须绑定当前 diff 或 head commit；`submit-completion` 在 `hub.review.required=true` 时必须校验最近 approved review 仍匹配当前代码。
9. 第 1 到 N 轮 review 的结果、修改情况和状态变化必须以 task-local artifact 形式保留，并同步给 Hub。
10. Hub 后端接口扩展要最小化：
    - 状态同步复用现有 task status endpoint。
    - 文件上传复用 artifact upload session + MinIO。
    - finish 复用现有 `submit-completion`。
    - 仅新增 review submission 语义，优先表现为 `submissionKind=review` / `review-submissions`。

## 验收标准

- [ ] `suncode init --engineer` 会安装 `.engineer/skills/suncode-hub-review/SKILL.md`。
- [ ] 非 Engineer 平台也能通过 common bundled skill 获得 `suncode-hub-review`。
- [ ] `suncode hub review` 在未启用 review 或 provider 不可用且允许 bypass 时返回 skipped，不改变 task review 状态。
- [ ] `suncode hub review` 在 review 可用时创建 `reviews/round-001/`，至少包含 `review.json`、`result.md`、`diff.patch`；可选包含 `prompt.md`、`fix-summary.md`。
- [ ] `result.md` 是 provider 结构化 review 结果渲染出的逐条问题报告，不保存 provider 原始执行转录。
- [ ] `hub.review.engineer.saveRawOutput=false` 时不生成 `raw-output.md`，也不把该路径写入 `review.json.artifacts`。
- [ ] `review.json` 包含 round、provider、status、scope、diffHash/headCommit、mustFixCount、advisoryCount、summary、artifact 路径等结构化字段。
- [ ] `suncode hub review` 将 task 状态同步为 `in_review`，并根据结果同步为 `changes_requested` 或 `approved`。
- [ ] 第二轮及以后 review 自动递增 round，并能引用上一轮结果/修改摘要。
- [ ] review artifacts 通过既有 artifact upload + MinIO 机制上传给 Hub。
- [ ] review submission 使用最小新增语义，不新增独立的状态更新或文件上传接口。
- [ ] `suncode hub submit-completion` 在 `hub.review.required=true` 且最近 review 未 approved 或 diff 已变化时阻止 completion。
- [ ] reviewer 执行过程中若修改工作树，review 结果标记为 blocked 或失败，不允许作为 approved。
- [ ] 有针对配置解析、review artifact 收集、provider unavailable、review required gate、multi-round manifest 更新的测试覆盖。

## 暂不纳入第一版

- 不实现完整 Hub 分支模式、自动 merge、自动 PR。
- 不支持多个 provider 同时 review 或 all-must-pass 策略。
- 不要求第一版支持除 Engineer 以外的真实 provider adapter，但 provider 接口必须可扩展。
- 不把源码完整文件上传 Hub；优先上传 diff、文件列表、hash、review report。
- 不让 AI 手动维护 round、上传、状态同步。
