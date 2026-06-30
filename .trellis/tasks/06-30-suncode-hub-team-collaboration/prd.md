# Suncode Hub 团队协作

## 目标

把 Suncode 从纯本地 AI 开发工作流扩展为可选的团队 Hub 协作模式。启用后，AI 可以从 Hub 拉取需求、创建并绑定本地 task、提交规划文档、拉取审核意见和需求变更、在开发前做 Hub gate、开发后提交 spec 变更和经验沉淀。未启用 Hub 的项目必须保持当前本地 Suncode 行为，不联网、不新增流程负担。

## 背景

当前 Suncode 已有本地 task 生命周期、规划工件、hooks、workflow-state 和 skill 引导：

- task 工件：`task.json`、`prd.md`、`design.md`、`implement.md`、`implement.jsonl`、`check.jsonl`。
- 生命周期 hook：`after_create`、`after_start`、`after_finish`、`after_archive`。
- 现有限制：hook 是事后通知，失败只警告；文档保存本身不会触发语义动作。

Hub 协作需要在这个基础上增加远端需求、审核、状态和文档同步能力。核心原则是：

- Hub 功能默认关闭，只有配置为团队 Hub 项目才启用。
- AI 不需要用户跳出会话手动跑主流程命令；主流程由 skill/workflow 引导，生命周期自动动作由 hook 调用命令。
- 需要 AI 判断、产出文档或处理多轮交互的流程适合提取成 Hub skill；第一版优先提取“需求拉取/建任务”和“经验总结/复用评估/收尾”。
- Hub API 只做控制面交互，文档正文上传/下载统一走 MinIO 兼容对象存储。
- 需求、需求变更、审核补充信息支持两种载荷：简单内容用字符串字段，长文档用 MinIO 文档引用。
- 所有 Hub 命令必须可重试、可幂等、可由 AI 或用户补跑。
- 不用文件保存事件判断“规划完成”；规划完成必须由显式命令提交。
- 所有推送必须有明确任务归属，禁止一股脑扫描并上传不相干 task 的 `prd.md`、`design.md`、`implement.md` 或总结文档。

## 范围

### 本次任务包含

1. 设计 Hub 团队协作整体流程。
2. 设计 `.suncode/config.yaml` 中的 Hub 启用开关和项目配置。
3. 设计 `task.json.meta.hub` 远端绑定状态结构。
4. 设计 `hub-manifest.json`，用于记录本地工件 hash、远端修订和上传状态。
5. 设计文档上传/下载的 MinIO 对象存储模型，Hub API 不传输文档正文。
6. 设计需求、需求变更、审核补充信息的 `text` / `document` 两种载荷模型。
7. 设计 `suncode hub` 命令族：
   - `status`
   - `pull`
   - `create-task`
   - `submit-plan`
   - `pull-review`
   - `sync`
   - `preflight-start`
   - `submit-subtasks`
   - `mark-started`
   - `submit-spec`
   - `submit-completion`
8. 设计可选 Hub AI-facing skill 层，第一版至少包含：
   - `suncode-hub-requirements`
   - `suncode-hub-finish`
9. 设计生命周期 hook 与 Hub 命令的连接方式：
   - `after_create` 自动调用 `suncode hub create-task`
   - `after_start` 自动调用 `suncode hub submit-subtasks`，再调用 `suncode hub mark-started`
   - `after_finish` 只允许做非最终状态的会话结束同步
   - `after_archive` 才能代表本地任务完成归档
10. 生成 Hub 平台需要实现的接口文档，接口由 Suncode 侧先设计。
11. 设计幂等策略、变更检测策略和冲突处理策略。
12. 设计一个 Hub requirement 拆成本地 parent/child 多 task 的绑定方式。
13. 设计 artifact 归属边界，确保推送只包含当前 task 或显式允许的 child task 内容。

### 本次任务不包含

1. 不要求 Hub 后端真实实现接口。
2. 不要求接入某个已存在 Hub 域名或真实鉴权系统。
3. 不在未启用 Hub 的项目中改变现有 Suncode 行为。
4. 不通过 watcher 监听 `prd.md` / `design.md` / `implement.md` 保存事件。
5. 不把现有 Trellis 数据迁移到 Suncode Hub。

## 需求

### R1. Hub 功能默认关闭

- 新项目默认 `hub.enabled` 为 `false` 或缺省。
- Hub 未启用时，`suncode hub ...` 命令应安全跳过或提示未启用。
- Hub 未启用时，不应发起任何网络请求。
- Hub 未启用时，不应改变当前本地 Suncode task/workflow 行为。

### R2. 团队 Hub 项目显式启用

团队项目应通过配置启用：

```yaml
hub:
  enabled: true
  mode: team
  projectId: "proj_123"
  apiBaseUrl: "https://hub.example.com"
```

启用后，缺少 `projectId`、`apiBaseUrl` 或鉴权信息应视为配置错误。

### R3. 从 Hub 拉取需求

AI 通过 `suncode-hub-requirements` skill 调用 `suncode hub pull`，根据项目和开发者身份拉取可处理需求。开发者本地信息来自 `.suncode/.developer`，Hub 身份认证使用 `SUNCODE_HUB_TOKEN` 中的 JWT。

需求正文支持两种形态：

- `text`：标题、摘要、短需求说明、简短验收标准直接通过 Hub API 字符串字段返回。
- `document`：完整 PRD、附件式需求、长验收说明只通过 MinIO 文档引用返回，Suncode CLI 根据引用下载到当前 task 的 Hub 来源资料目录。

该 skill 负责检查 Hub 是否启用、拉取需求列表、按载荷类型获取需求内容、引导 AI 选择需求、创建本地 task、预写 Hub requirement 元数据，并检查 `after_create` 是否完成远端绑定。

### R4. 创建本地 task 时预写 Hub 需求元数据

根据 Hub 需求创建本地 task 时，本地 `task.json.meta.hub` 必须预写：

- `projectId`
- `developerId`
- `requirementId`
- `requirementRevision`
- `bindingStatus: "pending"`

这样 `after_create` 才能知道要绑定哪个 Hub 需求。

### R5. `after_create` 自动绑定远端 task

`after_create` 应调用：

```bash
suncode hub create-task --task-json "$TASK_JSON_PATH"
```

该命令读取 `task.json`、Hub 配置和开发者身份，调用 Hub 创建/绑定接口。成功后回写：

- `remoteTaskId`
- `bindingStatus: "bound"`
- `lastSyncedAt`

失败后回写：

- `bindingStatus: "failed"` 或保留 `"pending"`
- `lastError`
- `lastSyncAttemptAt`

后续命令必须能补跑该绑定命令。

### R6. 规划文档显式提交

`prd.md`、`design.md`、`implement.md` 的创建或修改不自动上传。规划完成时，AI 必须通过 skill/workflow 调用：

```bash
suncode hub submit-plan
```

该命令先把变更过的规划工件上传到 MinIO，再通过 Hub API 提交 artifact 元数据和对象引用，并记录 `planSubmissionId`、`planRevision`、`reviewStatus`。Hub API 不接收 `prd.md`、`design.md`、`implement.md` 的正文内容。

规划提交第一版可以先由 workflow / brainstorm 指引 AI 调用 `suncode hub submit-plan`。如果后续审核循环变复杂，再提取 `suncode-hub-planning` skill，用于检查规划工件完整性、提交 plan、拉取审核意见，并引导 AI 根据意见修改文档后再次提交。

### R7. 审核意见和需求变更必须可反复拉取

AI 应通过：

```bash
suncode hub pull-review
suncode hub sync
```

拉取 Hub 审核意见和需求变更。命令需要使用 cursor/revision 避免重复处理同一条意见或变更。

审核意见和需求变更同样支持两种形态：

- 简单意见或简单变更用字符串字段返回。
- 长文档、完整变更说明、评审附件用 MinIO 文档引用返回，由 Suncode CLI 下载到当前 task 的 Hub 来源资料目录。

审核意见和需求变更第一版可以先由 workflow 指引 AI 调用 `suncode hub sync` / `suncode hub pull-review`。如果变更解释和多轮修订逻辑变复杂，再提取 `suncode-hub-sync` skill。

### R8. 开发前必须有 Hub preflight gate

开始开发前，应先调用：

```bash
suncode hub preflight-start
```

该命令需要确认：

- 本地 task 已绑定远端 task。
- 最新规划工件已上传。
- Hub 审核状态。如果审核未通过，允许继续，但必须先向用户做二次确认。
- 本地 `requirementRevision` 未落后于 Hub。

`preflight-start` 的默认策略是 `startReviewPolicy: "confirm"`：

- 审核通过：preflight 直接成功。
- 审核未通过或仍在审核中：preflight 返回“需要二次确认”，AI 必须向用户说明风险并获得明确确认。
- 用户二次确认后，AI 重新执行带确认标记的 preflight，成功后才进入 `task.py start`。

开发前确认第一版可以先由 workflow 指引 AI 调用 `suncode hub preflight-start`。如果需要二次确认，AI 按 preflight 输出向用户说明风险；确认后执行带确认标记的 preflight。后续可提取 `suncode-hub-start` skill 来封装这段交互。

### R9. 开发开始状态自动同步

`after_start` 应先上传当前任务的结构化子任务，再同步任务开始状态：

```bash
suncode hub submit-subtasks --task-json "$TASK_JSON_PATH"
```

然后调用：

```bash
suncode hub mark-started --task-json "$TASK_JSON_PATH"
```

`submit-subtasks` 读取当前 task 目录的 `subtasks.json`，把本地实施步骤转换后的结构化子任务列表提交给 Hub，方便 Hub 展示“主任务 -> 子任务”结构。`mark-started` 通知 Hub 本地 task 已进入开发中。二者都不能替代 `preflight-start`。

`subtasks.json` 格式：

```json
{
  "version": 1,
  "subtasks": [
    {
      "priority": "P1",
      "name": "Implement API contract",
      "description": "Add the command/API changes needed for the reviewed task."
    }
  ]
}
```

规则：

- 文件只描述当前 task 的实施子任务，不读取 sibling task。
- 每个子任务必须包含非空的 `priority`、`name`、`description`。
- 本地普通项目可以不创建该文件；Hub team 项目应在 `task.py start` 前由 workflow 引导 AI 从 `implement.md` 生成。
- 上传使用 `subtasksHash` 幂等，重复 start 或补跑不会重复创建 Hub 子任务。

### R10. 开发中需求变更通过显式同步处理

当用户或审核员提示需求变更，AI 应调用：

```bash
suncode hub sync
```

拉取变更后，AI 根据变更修改规划文档或代码，并在需要时重新提交规划。简单变更直接来自 Hub API 字符串字段；文档型变更必须先从 MinIO 下载，再由 AI 阅读和应用。

### R11. 开发结束后提交 spec 变更

开发结束时，AI 应调用：

```bash
suncode hub submit-spec
```

命令通过 git diff 和 hash manifest 判断哪些 `.suncode/spec/**` 文件真的发生变更，只上传变更工件。spec 文件正文通过 MinIO 上传；Hub API 只接收 spec artifact 的路径、类型、hash、大小和 MinIO 对象引用。

spec 是项目级资产，不归属某个本地 task。`submit-spec` 可以使用当前 task 的远端绑定作为本次提交的需求/任务关联上下文，但 spec hash 状态应记录在项目级 Hub spec manifest 中，不能把 spec 文件塞进某个 task 的规划/完成工件归属里。

### R12. 任务结束时提交经验总结和复用评估

finish-work 流程需要生成或确认：

- `retrospective.md`
- `reuse-assessment.md`
- `validation-summary.md`
- `implementation-summary.md`

然后调用：

```bash
suncode hub submit-completion
```

该动作需要把总结工件上传到 MinIO，并通过 Hub API 提交通知本地任务的最终交付状态。最终完成语义应以 `after_archive` 或显式 completion 命令为准，不能只依赖 `after_finish`。

经验总结、复用评估、spec 变更提交和 completion 提交应由 `suncode-hub-finish` skill 编排。该 skill 负责生成或校验总结文档，调用 `submit-spec` 和 `submit-completion`，并保证没有把空文档或不相关 task 的文档当作当前任务沉淀上传。

### R13. 文档正文通过 MinIO 传输

所有文档类内容的上传和下载必须走 MinIO 兼容对象存储：

- Suncode 本地生成的规划文档、spec 变更、完成总结先上传到 MinIO，再把对象引用提交给 Hub。
- Hub 侧提供的长需求、长需求变更、评审附件通过 MinIO 对象引用交给 Suncode 下载。
- Hub API 不传输文档正文，不出现 artifact `content` 字段。
- 简单需求、简单需求变更、短审核意见可以继续作为字符串字段通过 Hub API 传输。
- 第一版优先使用 Hub 签发的 MinIO 预签名上传/下载 URL，避免在 Suncode 本地配置 MinIO access key。
- 预签名 URL 和对象引用不得写入长期日志；manifest 只保存稳定对象 ID、hash、size、revision 等非敏感元数据。

### R14. 幂等与变更检测

所有 Hub 写入命令必须具备幂等键。工件上传必须通过内容 hash 判断是否变更：

- 规划文档固定扫描当前 task 下的 `prd.md`、`design.md`、`implement.md`。
- spec 文档是项目级资产，扫描 `.suncode/spec/**` 或 git diff 的 spec 候选后再计算 hash。
- hash 采用规范化换行后的 SHA-256。
- manifest 可缓存 `size` 和 `mtimeMs`，但最终一致性以 hash 为准。
- 上传幂等以 `artifactBundleHash` / `specBundleHash` / `completionBundleHash` 以及对象 hash 为依据，不能以 MinIO 临时 URL 为依据。

### R15. 安全和隐私

- 不得把 Hub JWT 写入仓库。
- 第一版使用 JWT 身份认证。
- 第一版 JWT 只从 `SUNCODE_HUB_TOKEN` 环境变量读取。
- 第一版不实现用户级 token 配置文件或系统凭据存储；后续可作为体验优化扩展。
- Hook 日志不得打印 JWT、secret 或完整认证头。
- Hub 未启用时不得联网。
- MinIO 预签名 URL 视为短期敏感凭据，不写入 task 文档、manifest 长期字段或普通日志。

### R16. 一个 Hub requirement 允许拆成本地 parent/child 多 task

Hub requirement 可以对应一个本地 task，也可以对应一个 parent task 和多个 child task：

- 简单需求：本地 task 使用 `taskRole: "single"`，直接绑定 `requirementId`。
- 复杂需求：本地 parent task 使用 `taskRole: "parent"`，作为该 requirement 的主绑定 task。
- child task 使用 `taskRole: "child"`，继承 parent 的 `requirementId`、`requirementRevision`，并记录 `parentRemoteTaskId`。
- Hub 端可以为 child task 创建远端执行单元，但 requirement 的主绑定关系以 parent task 为准。
- child task 的依赖顺序不能只靠树结构表达，必须写入 child 的 `prd.md` / `implement.md`。
- parent task 负责源需求、子任务地图、跨子任务验收标准和最终集成 review。

### R17. Hub 语义流程按复杂度提取为 skill

Hub 的语义流程不要求全部 skill 化。是否提取为 skill 按以下标准判断：

- 需要 AI 生成文档、总结、评估或解释风险：优先做成 skill。
- 需要多轮用户确认或审核意见处理：可以做成 skill，但第一版不强制。
- 纯确定性、可幂等的远端写入：保留为 CLI 命令。
- 生命周期自动通知：保留为 hook 调 CLI。

第一版 Hub skill 分层：

| Skill | 责任 |
| --- | --- |
| `suncode-hub-requirements` | 第一版必做：拉取 Hub 需求、选择需求、创建本地 task、检查远端绑定 |
| `suncode-hub-finish` | 第一版必做：生成经验总结/复用评估/验证摘要/实现摘要，提交 spec 和 completion |
| `suncode-hub-planning` | 后续可选：检查规划工件、提交 plan、拉取审核意见、引导修改后重提 |
| `suncode-hub-sync` | 后续可选：开发中拉取需求变更和审核意见，处理 revision/cursor |
| `suncode-hub-start` | 后续可选：开发前 preflight、审核未通过时二次确认、确认后允许 `task.py start` |

skill 只负责编排和指导，不直接替代幂等 CLI 命令。所有远端写入仍必须通过 `suncode hub ...` 命令执行。

### R18. 推送必须限制在当前任务归属范围内

所有 artifact 推送命令必须先解析一个明确的目标 task：

- hook 调用使用 `TASK_JSON_PATH`。
- AI/用户补跑使用 `--task current` 或显式 task 名。
- 如果没有明确目标 task，命令必须失败或跳过，不能全局扫描所有 task。

artifact 收集范围：

- `submit-plan` 只允许上传目标 task 目录下的 `prd.md`、`design.md`、`implement.md` 和显式允许的 `research/**`。
- `submit-completion` 只允许上传目标 task 目录下的 `implementation-summary.md`、`validation-summary.md`、`retrospective.md`、`reuse-assessment.md`。
- parent task 只有在显式传入 `--include-children` 且 child task 属于该 parent、同一个 `requirementId`、同一个 `parentRemoteTaskId` 时，才允许包含 child task 摘要。
- 默认禁止扫描 `.suncode/tasks/**` 并批量上传所有 task 文档。
- spec 变更是项目级文件，不归属当前 task；`submit-spec` 处理 `.suncode/spec/**` 的项目级变更，并用项目级 manifest 做 hash 去重。这里的限制目标是“不要上传其他 task 的 `prd.md`、`design.md`、`implement.md`、总结文档”，不是限制项目级 spec。

## 验收标准

- [ ] 有中文 `prd.md`、`design.md`、`implement.md` 规划文档。
- [ ] 有中文 Hub API 接口文档，覆盖 Suncode CLI 需要调用的所有 Hub 接口。
- [ ] 文档明确 Hub 默认关闭，只有 `hub.enabled=true` 时启用。
- [ ] 文档明确 `after_create -> suncode hub create-task` 的自动绑定方案和补跑方案。
- [ ] 文档明确规划完成通过 `suncode hub submit-plan` 显式提交，而不是文件保存触发。
- [ ] 文档明确 `preflight-start` 在 `task.py start` 之前执行。
- [ ] 文档明确 Hub 审核未通过时允许开始开发，但必须二次确认。
- [ ] 文档明确 `after_start` 会上传当前 task 的结构化子任务并同步开发开始状态，不能替代 preflight。
- [ ] 文档明确 `after_finish` 不是任务完成，最终完成应由显式 completion/归档流程处理。
- [ ] 文档包含 `task.json.meta.hub` 和 `hub-manifest.json` 数据结构。
- [ ] 文档包含幂等键规则和 artifact hash 变更检测规则。
- [ ] 文档明确文档正文上传/下载通过 MinIO，Hub API 不传输文档正文。
- [ ] 文档明确需求、需求变更和审核补充信息支持 `text` / `document` 两种载荷。
- [ ] 文档包含错误处理、冲突处理、禁用模式和认证边界。
- [ ] 文档明确第一版鉴权使用 `SUNCODE_HUB_TOKEN` 环境变量中的 JWT。
- [ ] 文档明确一个 Hub requirement 可以拆成本地 parent/child 多 task。
- [ ] 文档明确需求拉取、经验总结和复用评估第一版由 Hub skill 编排；规划提交、同步、开发前确认可先由 workflow 引导调用 CLI。
- [ ] 文档明确推送 artifact 必须限制在当前任务归属范围内，不能上传不相关 task 文档。

## 开放问题

当前无阻塞开放问题。
