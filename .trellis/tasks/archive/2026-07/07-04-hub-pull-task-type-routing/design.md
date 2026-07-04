# Hub pull task type routing 设计

## 边界

本任务聚焦 CLI 与模板/skill 的本地路由能力：

- Hub API 客户端继续使用现有 `/api/v1/projects/{projectId}/requirements`、`create-task`、`preflight-start`、`mark-started`、`submit-completion` 等通道。
- 本地任务仍使用现有 `planning -> in_progress -> archive` 状态，不新增状态 writer。
- 任务类型作为 Hub metadata：`task.json.meta.hub.taskType`，不改变普通 local-only 任务。

## 数据模型

新增本地概念：

```ts
type HubTaskType = "quick" | "standard" | "change";
```

`HubRequirement` 需要扩展：

- `taskType: HubTaskType`
- `sourceTask?: HubSourceTaskSummary`
- `rawTaskType?: string`，仅用于诊断未知类型时保留可读提示，不作为行为分支依据

`HubTaskMeta` 需要扩展：

- `taskType?: HubTaskType`
- `sourceTask?: HubSourceTaskSummary`

`sourceTask` 应做 allowlist 归一化，只保留旧任务理解需要的安全字段，例如：

- `id`
- `remoteTaskId`
- `localTaskId`
- `localTaskPath`
- `title`
- `requirementId`
- `requirementRevision`
- `status`
- `summary`
- `completedAt`

如果 Hub 的 `sourceTask` 是字符串，则按 ID/路径摘要保存；如果是对象，则只保存 allowlist 字段。不要原样持久化任意未知字段，避免把签名 URL、token、内部对象等写入任务目录。

## 拉取与创建流程

### `hub pull`

`pullRequirements` 当前返回原始 Hub 响应。为了保持兼容，可以继续原样输出；不需要在 `pull` 中重塑结构。后续若要做友好列表，再复用 intake 的 normalizer。

### `hub intake`

`normalizeRequirements` 读取任务类型：

- 依次尝试 `taskType`、`kind`、`type`、`requirementType`。
- 合法值大小写不敏感，归一化为小写。
- 缺失值默认为 `standard`。
- 未知值按 `standard` 行为处理，但 PRD 或 message 中可提示 `rawTaskType`，便于排查 Hub 端字段值。

`createLocalHubTask` 写入：

```json
"meta": {
  "hub": {
    "taskType": "quick",
    "sourceTask": { "...": "..." }
  }
}
```

默认 PRD 根据类型生成：

- `standard`：保持当前模板，最多补充 Task Type 行。
- `quick`：标题下显示 `Task Type: quick`，需求和验收区保持极简，明确“快速任务：不要求 design/implement，不进入 plan approval/review，但仍提交 plan artifacts”。
- `change`：显示 `Task Type: change` 与 `Source Task` 摘要，并要求 AI 先阅读旧任务上下文。

对 `change`，建议额外生成 `research/source-task.md`，因为 PRD 需要保持需求/验收为主，来源任务详情放 research 更合适。

## 工作流路由

### Standard

完全沿用现有路线：

```text
PRD/design/implement -> hub plan-ready -> task.py start -> implement -> check -> hub review when enabled -> commit -> finish
```

### Quick

推荐路线：

```text
minimal PRD -> hub plan-ready(upload-only) -> task.py start -> direct implementation -> minimal validation -> completion artifacts -> commit -> suncode hub finish -> finish-work
```

关键点：

- 运行 `suncode hub plan-ready --task current` 提交 plan artifacts；quick 分支在提交后本地跳过 Hub start preflight 和计划审核等待。
- `task.py start` 的 `before_start` Hub preflight 对 quick 任务必须本地跳过。quick 不使用服务端 start preflight 审核门，不能依赖服务端按 remote task type 放行。
- `after_start` 仍会 `submit-subtasks` 与 `mark-started`。如果 quick 没有 `implement.md` checklist，`submit-subtasks` 会跳过；`mark-started` 继续同步状态。
- 不运行 `suncode hub review`。如果 `hub.review.required=true` 与 quick 冲突，CLI/skill 应优先给出明确提示，而不是偷偷进入 review。
- 仍运行 `suncode hub finish --task current` 或等价完成提交路径。quick 只跳过计划审核/代码 review 等等待环节，不跳过最终产物上传。
- `prd.md` 保持 plan artifact 归属；quick 通过 `hub plan-ready` 上传 PRD，finish 不把 PRD 混入 completion artifacts。
- quick 的完成产物可以是最小有效版本，但必须存在并有证据支撑：`implementation-summary.md`、`validation-summary.md`、`retrospective.md`、`reuse-assessment.md`。其中 validation summary 应明确哪些验证已执行、哪些未执行以及原因。
- quick 保留最小确定性验证。优先执行可快速完成且与改动相关的验证，例如定向测试、typecheck、lint 或项目等价检查；如果环境限制或任务性质导致无法执行，`validation-summary.md` 必须明确写 `未执行` 和原因。

### Change

推荐路线：

```text
load sourceTask -> update PRD/design/implement around changed requirement -> hub plan-ready -> task.py start -> standard execution
```

关键点：

- `sourceTask` 是旧需求理解资料，不覆盖当前 requirement。
- 若 sourceTask 指向本地旧任务路径且文件存在，AI 可以读取旧 PRD/design/summary；若只有 Hub 摘要，则使用 `research/source-task.md`。
- 如果变更里带 document payload，继续使用现有 `suncode hub download-document` 机制。

## Prompt 与 skill 变更

需要改三类文案入口：

- `.suncode/workflow.md` 模板中的 Phase 1/Phase 2 breadcrumb 文案。
- `suncode-hub-requirements` bundled skill。
- Hub state prompt `formatHubStatePrompt`。

建议 Hub state prompt 增加一行：

```text
task-type:quick
```

并对 quick Hub-bound task 输出：

```text
allowed:intake sync plan-ready start finish
do-not:review
```

这样 AI 在每轮上下文里能看到 quick 路由，不依赖只读 PRD。

finish 相关 skill 文案也要区分 quick：quick 任务不触发 Hub code review，但 `suncode hub finish` 的产物上传仍是必经步骤。

## 兼容性

- 旧 Hub 不返回任务类型：全部按 `standard`。
- 旧本地任务没有 `meta.hub.taskType`：全部按 `standard`。
- 未知 task type：按 `standard` 执行，并在本地可见 raw value，避免错误走 quick。
- local-only 任务不受影响。

## 测试策略

新增/更新 `packages/cli/test/commands/hub.test.ts`：

- intake normalizes `quick` 并写入 task meta + quick PRD。
- intake defaults missing/standard to standard and保持当前 plan-ready guidance。
- intake normalizes `change` + sourceTask，写入 task meta，并生成 source-task context。
- Hub state prompt for quick Hub-bound task includes task type and quick guardrails。
- quick plan-ready uploads current-task `prd.md` while skipping preflight/plan approval。
- quick finish path still uploads completion/spec artifacts while skipping review。
- quick validation summary records minimal verification evidence or explicit not-run reasons。
- unknown type falls back to standard。

新增/更新模板测试：

- `suncode-hub-requirements` skill contains quick/standard/change route guidance。
- workflow breadcrumb no longer unconditionally tells every Hub team project to run plan-ready; it must be conditional on task type。

## 风险

- Hub `preflight-start` 可能强制要求 planSubmissionId 或计划审核状态；quick 任务必须在本地跳过 before_start preflight，并保留 after_start 的 best-effort `submit-subtasks` / `mark-started` 同步。
- quick 保留最小验证，但验证范围需要严格克制；不能因为 quick 类型扩大为全量慢检查，也不能把未执行验证写成通过。
- `sourceTask` 原样保存有敏感信息风险，因此设计上使用 allowlist 摘要。
