# Suncode Hub 团队协作设计

## 设计目标

新增一个可选的团队 Hub 协作层，让 Suncode 在团队项目中能与 Hub 平台同步需求、任务、规划文档、审核意见、开发状态、spec 变更和经验沉淀，同时保持普通本地项目不受影响。

关键设计目标：

- 默认关闭 Hub，不改变现有本地工作流。
- Hub 启用后，AI 通过 skill/workflow 自动调用命令，用户不需要离开 agent 手动跑主流程。
- lifecycle hook 只做自动通知和补偿同步，不承担不可恢复的核心 gate。
- 所有远端写入命令都幂等，支持 hook 重试、AI 补跑和用户补跑。
- 文档和 spec 变更用内容 hash 判断，避免重复上传。
- Hub API 作为控制面，只传元数据、状态、对象引用和短字符串；文档正文上传/下载走 MinIO 兼容对象存储。
- 需求、需求变更和审核补充信息按 `text` / `document` 两种载荷处理。

## 总体架构

```text
AI / Workflow
        |
        v
Hub skills
        |
        v
suncode hub 命令族
        |
        +-- Hub 配置读取
        +-- task.json.meta.hub 状态读取/回写
        +-- hub-manifest.json 工件 hash 状态
        +-- Hub HTTP API client
        +-- MinIO presigned URL 上传/下载 client
        |
        +-- 控制面：Hub 平台 API
        |
        v
        数据面：MinIO 兼容对象存储
```

生命周期 hook 与命令关系：

```text
task.py create
  -> after_create (hub.enabled=true 时内置 sync hook)
    -> suncode hub create-task --task-json "$TASK_JSON_PATH"

suncode hub preflight-start
  -> 成功后才允许 task.py start

task.py start
  -> after_start (hub.enabled=true 时内置 sync hook)
    -> suncode hub mark-started --task-json "$TASK_JSON_PATH"

finish-work skill
  -> suncode hub submit-spec
  -> suncode hub submit-completion

task.py archive
  -> after_archive (hub.enabled=true 时内置 sync hook)
    -> 可选 suncode hub mark-archived / submit-completion 兜底
```

控制面与数据面边界：

| 层 | 传输内容 | 说明 |
| --- | --- | --- |
| Hub API | JSON 元数据、状态、cursor、revision、artifact hash、MinIO 对象引用、简单字符串 | 不传文档正文，不出现 artifact `content` 字段 |
| MinIO | `prd.md`、`design.md`、`implement.md`、spec 文档、总结文档、长需求文档、长变更文档、评审附件 | 第一版通过 Hub 签发的预签名 URL 上传/下载，Suncode 不保存 MinIO access key |

## Skill / CLI / Hook 边界

Hub 协作分三层：

| 层 | 责任 | 例子 |
| --- | --- | --- |
| Skill | 编排需要 AI 判断、文档产出或多轮交互的语义流程 | 拉取需求并创建 task、生成经验总结 |
| CLI 命令 | 执行可幂等的本地状态更新和 Hub API 调用 | `suncode hub submit-plan`、`suncode hub preflight-start` |
| Hook | 在 Suncode 生命周期事件后自动补充通知或同步 | `after_create` 自动绑定远端 task、`after_start` 标记开发开始 |

设计原则：

- 需要 AI 产出内容或多轮判断的流程优先考虑 skill，但不要求所有 Hub 流程都 skill 化。
- 需要网络写入或本地状态回写的动作必须落到 CLI 命令。
- hook 只调用 CLI 命令，不调用 skill，不要求 AI 在 hook 中产出内容。
- Hub lifecycle sync 是内置 hook 追加逻辑，只有 `.suncode/config.yaml` 中 `hub.enabled=true` 且 `hub.mode=team` 时才追加；普通项目不会启动 Hub hook。
- hook 失败不能让流程假装成功；skill/CLI 必须能检查状态并补跑。

## Hub Skill 设计

第一版必须落地两个高价值 skill：

- `suncode-hub-requirements`
- `suncode-hub-finish`

`suncode-hub-planning`、`suncode-hub-sync`、`suncode-hub-start` 作为后续可选 skill；第一版可以先通过 workflow-state / command 文档引导 AI 调用对应 CLI 命令。

### `suncode-hub-requirements`

触发场景：

- 用户说“从 Hub 拉需求”、“开始 Hub 任务”、“同步 Hub 需求”。
- 无 active task 且 Hub enabled。

职责：

- 检查 Hub 是否启用和鉴权是否可用。
- 调用 `suncode hub pull` 拉取需求。
- 识别需求载荷是 `text` 还是 `document`；如果是 `document`，通过 MinIO 下载长需求文档。
- 帮 AI 选择需求并创建本地 task。
- 创建 task 时写入 `task.json.meta.hub` 的 requirement 元数据。
- 检查 `after_create` 是否完成绑定；失败时补跑 `suncode hub create-task`。

### `suncode-hub-planning`（后续可选）

触发场景：

- 规划文档完成。
- 用户要求提交规划给 Hub。
- Hub 审核要求修改规划。

职责：

- 检查 `prd.md`、`design.md`、`implement.md` 是否满足当前任务复杂度。
- 调用 `suncode hub submit-plan`。
- 调用 `suncode hub pull-review` 拉取审核意见。
- 引导 AI 根据审核意见修改规划文档，再重新提交。

### `suncode-hub-sync`（后续可选）

触发场景：

- 用户或审核员提示需求变更。
- 开发中需要检查 Hub 最新状态。
- `preflight-start` 或 `submit-plan` 返回 revision conflict。

职责：

- 调用 `suncode hub sync`。
- 解释需求变更和审核意见；文档型变更先通过 MinIO 下载后再处理。
- 判断需要回到规划、修改代码，还是只更新状态。
- 修改后提示重新提交 plan 或重新跑 preflight。

### `suncode-hub-start`（后续可选）

触发场景：

- 规划完成，准备进入开发。

职责：

- 调用 `suncode hub preflight-start`。
- 如果返回需要二次确认，向用户说明：
  - 当前 `reviewStatus`
  - 未处理审核意见摘要
  - 继续开始开发的风险
- 用户明确确认后，调用 `suncode hub preflight-start --confirm-unapproved-review`。
- preflight 成功后，提示或执行 `task.py start`。

### `suncode-hub-finish`

触发场景：

- 开发结束、准备 finish-work 或归档。

职责：

- 生成或校验：
  - `implementation-summary.md`
  - `validation-summary.md`
  - `retrospective.md`
  - `reuse-assessment.md`
- 调用 `suncode hub submit-spec`。
- 调用 `suncode hub submit-completion`。
- 确认没有上传空白总结或未验证的复用结论。

## Skill 分发位置

Hub MVP skills 应作为 Suncode 内置可分发 skill，随 `suncode init` / `suncode update` 写入支持的平台 skill 目录。

推荐来源：

```text
packages/cli/src/templates/common/bundled-skills/suncode-hub-requirements/
packages/cli/src/templates/common/bundled-skills/suncode-hub-finish/
```

后续可选 skill 可按需要补充分发：

```text
packages/cli/src/templates/common/bundled-skills/suncode-hub-planning/
packages/cli/src/templates/common/bundled-skills/suncode-hub-sync/
packages/cli/src/templates/common/bundled-skills/suncode-hub-start/
```

Hub disabled 时，这些 skill 必须快速说明“当前项目未启用 Hub”，并回到普通 Suncode workflow。

## 配置设计

`.suncode/config.yaml` 新增：

```yaml
hub:
  enabled: false
  mode: team
  projectId: null
  apiBaseUrl: null
  startReviewPolicy: confirm
  sync:
    afterCreate: true
    afterStart: true
    afterFinish: false
    afterArchive: true
```

规则：

- `hub.enabled` 缺省或为 `false`：Hub 命令不联网，返回跳过。
- `hub.enabled=true` 但缺 `projectId`：配置错误。
- `hub.enabled=true` 但缺 `apiBaseUrl`：配置错误。
- `hub.enabled=true` 但缺 `SUNCODE_HUB_TOKEN`：认证错误。
- `startReviewPolicy=confirm` 时，`preflight-start` 在审核未通过或未完成时要求用户二次确认。
- 第一版不在 `.suncode/config.yaml` 配置 MinIO endpoint、bucket、access key 或 secret key；文档上传/下载使用 Hub API 签发的短期预签名 URL。

`startReviewPolicy` 可选值：

| 值 | 行为 |
| --- | --- |
| `confirm` | 默认值。审核未通过或未完成时允许开始，但必须二次确认并记录 override。 |
| `block` | 审核未通过或未完成时禁止开始。 |
| `bypass` | 不检查审核状态，只检查绑定、revision 和文档上传状态。 |

## 鉴权设计

第一版只支持 JWT 身份认证，JWT 从环境变量读取：

```text
SUNCODE_HUB_TOKEN
```

命令行为：

- Hub disabled 时不读取 `SUNCODE_HUB_TOKEN`，也不联网。
- Hub enabled 时，所有需要访问 Hub API 的命令从 `SUNCODE_HUB_TOKEN` 读取 JWT。
- JWT 注入为 `Authorization: Bearer <jwt>`。
- JWT 不写入 `.suncode/config.yaml`、`task.json`、`hub-manifest.json`、日志或错误详情。
- 第一版不实现用户级配置文件或系统凭据存储。
- MinIO 预签名 URL 由 Hub API 基于 JWT 鉴权后签发。URL 只用于单次上传/下载窗口，不作为 Suncode 长期凭据保存。

## 任务元数据设计

`task.json` 中使用 `meta.hub` 存 Hub 绑定状态：

```json
{
  "meta": {
    "hub": {
      "projectId": "proj_123",
      "developerId": "dev_456",
      "requirementId": "REQ-1001",
      "requirementRevision": 7,
      "taskRole": "parent",
      "parentLocalTaskId": null,
      "parentRemoteTaskId": null,
      "remoteTaskId": "TASK-2001",
      "bindingStatus": "bound",
      "planSubmissionId": "PLAN-3001",
      "planRevision": 3,
      "reviewStatus": "approved",
      "lastReviewCursor": "review_cursor_xxx",
      "lastChangeCursor": "change_cursor_xxx",
      "lastSyncedAt": "2026-06-30T12:00:00Z",
      "lastError": null
    }
  }
}
```

字段含义：

| 字段 | 说明 |
| --- | --- |
| `projectId` | Hub 稳定项目 ID，不使用项目名做主键 |
| `developerId` | Hub 开发者 ID |
| `requirementId` | Hub 需求 ID |
| `requirementRevision` | 本地基于哪个需求版本做规划/开发 |
| `taskRole` | `single` / `parent` / `child` |
| `parentLocalTaskId` | child task 的本地 parent task ID；single/parent 为 `null` |
| `parentRemoteTaskId` | child task 对应的 Hub parent task ID；single/parent 为 `null` |
| `remoteTaskId` | Hub 远端任务 ID |
| `bindingStatus` | `pending` / `bound` / `failed` / `skipped` |
| `planSubmissionId` | 最近一次规划提交 ID |
| `planRevision` | 本地规划提交版本 |
| `reviewStatus` | `pending` / `changes_requested` / `approved` / `rejected` |
| `lastReviewCursor` | 最近已处理审核意见 cursor |
| `lastChangeCursor` | 最近已处理需求变更 cursor |
| `lastSyncedAt` | 最近成功同步时间 |
| `lastError` | 最近失败摘要，不包含 secret |

## Parent / Child Task 绑定设计

一个 Hub requirement 允许拆成本地 parent/child 多 task。

### 角色

| `taskRole` | 场景 | Hub 关系 |
| --- | --- | --- |
| `single` | 简单需求，一个本地 task 完成全部工作 | 直接绑定 requirement |
| `parent` | 复杂需求的主任务 | 作为 requirement 的主绑定 task |
| `child` | parent 下的独立可验证交付 | 继承 requirement，并挂到 `parentRemoteTaskId` |

### 绑定规则

- Hub requirement 的主绑定关系由 `single` 或 `parent` task 建立。
- parent task 拥有源需求、任务拆分地图、跨 child 验收标准和最终集成 review。
- child task 必须继承 parent 的 `projectId`、`developerId`、`requirementId`、`requirementRevision`。
- child task 必须记录 `parentLocalTaskId` 和 `parentRemoteTaskId`。
- Hub 可以为 child task 创建远端执行单元，便于审核和进度追踪；但 requirement 的主绑定入口仍然是 parent task。
- child task 之间的执行顺序和依赖必须写在 child 的 `prd.md` / `implement.md`，不能只依赖树结构。

### `create-task` 处理规则

- 创建 `single` task：直接调用 Hub 任务绑定接口。
- 创建 `parent` task：直接调用 Hub 任务绑定接口，并作为 requirement 主绑定 task。
- 创建 `child` task：
  - 如果 parent 已经 `bindingStatus=bound`，child 继承 parent Hub 元数据并调用 Hub 创建 child 执行单元。
  - 如果 parent 尚未绑定，child 标记为 `bindingStatus=pending_parent`，后续由 `suncode hub sync` 或补跑 `suncode hub create-task` 继续。

### child task 的 `meta.hub` 示例

```json
{
  "meta": {
    "hub": {
      "projectId": "proj_123",
      "developerId": "dev_456",
      "requirementId": "REQ-1001",
      "requirementRevision": 7,
      "taskRole": "child",
      "parentLocalTaskId": "06-30-payment-retry",
      "parentRemoteTaskId": "TASK-2001",
      "remoteTaskId": "TASK-2001-CHILD-1",
      "bindingStatus": "bound"
    }
  }
}
```

## 文档载荷与 MinIO 传输设计

Hub 与 Suncode 之间的内容分两类：

| 类型 | 用法 | 传输方式 |
| --- | --- | --- |
| `text` | 简短需求说明、短验收标准、简单需求变更、短审核意见 | Hub API JSON 字符串字段 |
| `document` | 完整需求文档、长需求变更说明、评审附件、本地规划/spec/总结文档 | MinIO 对象存储，Hub API 只传对象引用 |

统一载荷结构：

```json
{
  "body": {
    "kind": "document",
    "text": null,
    "document": {
      "documentId": "DOC-1001",
      "filename": "requirement.md",
      "contentType": "text/markdown",
      "sha256": "abc",
      "size": 2048,
      "objectRef": {
        "provider": "minio",
        "objectKey": "projects/proj_123/requirements/REQ-1001/revisions/7/requirement.md",
        "versionId": "minio-version-1"
      }
    }
  }
}
```

简单文本载荷：

```json
{
  "body": {
    "kind": "text",
    "text": "Retry count changed from 3 to 5.",
    "document": null
  }
}
```

下载规则：

- Hub API 返回 `text` 或 `document` payload；`document` payload 只包含 `documentId`、文件名、hash、对象引用等元数据。
- AI/skill 遇到 `document` payload 后显式调用 `suncode hub download-document`，由 CLI 再调用下载 URL 签发接口并执行 MinIO GET。
- `downloadUrl` 属于短期敏感凭据，不写入长期 manifest 或日志。
- 已有本地 task 时，文档型需求、变更和评审附件下载到当前 task 的 `hub-sources/` 目录。
- 尚未创建 task 时，文档型需求默认下载到 `.suncode/hub-inbox/<documentId>/hub-sources/`，供 AI 创建任务和编写规划文档时引用。
- 下载得到的 Hub 来源资料默认不作为 `submit-plan` 上传内容；只有 AI 明确把其中内容整理进 `prd.md`、`design.md`、`implement.md` 或显式列入 `research/**` 时才参与规划提交。

上传规则：

- `submit-plan` 和 `submit-completion` 先根据当前 task 归属范围收集本地文件。
- `submit-spec` 收集项目级 `.suncode/spec/**` 变更；当前 task 只作为本次 spec submission 的 Hub 关联上下文，不代表 spec 文件归属该 task。
- CLI 计算规范化内容 hash 和 bundle hash。
- CLI 调用 Hub API 创建上传会话，拿到每个 artifact 的 MinIO 预签名上传 URL。
- CLI 将文档正文上传到 MinIO。
- CLI 再调用对应 submission API，只提交 artifact 元数据、hash、size、对象引用和上传会话 ID。
- Hub API 不接收文档正文，不出现 `content` 字段。

## 工件 manifest 设计

每个 Hub task 目录下维护 task 级 manifest：

```text
.suncode/tasks/<task>/hub-manifest.json
```

结构：

```json
{
  "version": 1,
  "artifacts": {
    "prd.md": {
      "type": "prd",
      "sha256": "abc",
      "lastSubmittedSha256": "abc",
      "size": 1200,
      "mtimeMs": 1782839000000,
      "remoteArtifactId": "ART-1",
      "remoteRevision": 2,
      "storage": "minio",
      "objectKey": "projects/proj_123/tasks/TASK-2001/plan/PLAN-3001/prd.md",
      "objectVersionId": "minio-version-1",
      "lastSubmittedAt": "2026-06-30T12:00:00Z"
    }
  }
}
```

项目级 spec 维护独立 manifest：

```text
.suncode/hub-spec-manifest.json
```

该文件只记录 `.suncode/spec/**` artifact 的 hash、远端 artifact ID、远端 revision 和稳定 MinIO 对象引用。它不是 task manifest，不能用于判断某个 spec 文件“归属”某个 task；task 只在提交时提供 requirement / remote task 关联上下文。

路径规则：

- manifest key 必须是 POSIX 风格路径。
- task 内文件用相对 task 根路径，例如 `prd.md`。
- spec 文件在项目级 spec manifest 中用相对 repo 根路径，例如 `.suncode/spec/...`。
- hash 前需要把 CRLF 规范化为 LF。
- `storage/objectKey/objectVersionId` 只保存稳定对象引用，不保存预签名 URL。

## Artifact 归属边界设计

Hub 推送必须以“一个明确目标 task”为中心，不能全局扫描并上传其他 task 的文档。

### 目标 task 解析

所有 Hub 上传命令都必须先解析目标 task：

| 调用来源 | 目标 task 来源 |
| --- | --- |
| lifecycle hook | `TASK_JSON_PATH` |
| AI/用户补跑 | `--task current` 或显式 task 名 |
| 脚本集成 | `--task-json <path>` |

如果无法解析目标 task：

- Hub disabled：允许 skipped。
- Hub enabled：命令必须失败，不允许退化为扫描 `.suncode/tasks/**`。

### 规划工件归属

`submit-plan` 默认只允许读取目标 task 目录内的：

```text
prd.md
design.md
implement.md
research/**
hub-manifest.json
```

禁止行为：

- 禁止扫描 `.suncode/tasks/*/prd.md`。
- 禁止把 sibling task 的 `design.md` 或 `implement.md` 合并上传。
- 禁止把 archived task 文档作为当前 task 的规划工件上传。

### completion 工件归属

`submit-completion` 默认只允许读取目标 task 目录内的：

```text
implementation-summary.md
validation-summary.md
retrospective.md
reuse-assessment.md
```

parent task 需要汇总 child task 时，必须显式传入 `--include-children`。启用后仍需验证：

- child 在 parent `children` 列表中。
- child 的 `meta.hub.requirementId` 与 parent 一致。
- child 的 `meta.hub.parentRemoteTaskId` 等于 parent 的 `remoteTaskId`。

### spec 工件边界

`.suncode/spec/**` 是项目级目录，不归属单个 task。`submit-spec` 可以扫描项目级 spec 变更并使用项目级 spec manifest 做 hash 去重。

边界要求：

- `submit-spec` 只处理 `.suncode/spec/**`，不得扫描 `.suncode/tasks/**`。
- 当前 task 只提供 `localTaskId`、`localTaskPath`、`remoteTaskId`、`requirementId` 作为本次提交的关联上下文。
- 不得把 sibling task 的 `prd.md`、`design.md`、`implement.md`、summary 或 retrospective 文档作为 spec artifact 上传。
- spec hash 状态写入 `.suncode/hub-spec-manifest.json`，不是 `.suncode/tasks/<task>/hub-manifest.json`。

### API payload 归属字段

task 文档 artifact 上传请求包含：

```json
{
  "localTaskId": "06-30-payment-retry",
  "localTaskPath": ".suncode/tasks/06-30-payment-retry",
  "artifactScope": "current_task"
}
```

spec 上传使用：

```json
{
  "localTaskId": "06-30-payment-retry",
  "localTaskPath": ".suncode/tasks/06-30-payment-retry",
  "artifactScope": "project_spec"
}
```

parent 汇总 child 时使用：

```json
{
  "artifactScope": "parent_with_children",
  "includedChildTaskIds": ["06-30-payment-retry-api"]
}
```

## 命令设计

### `suncode hub status`

显示 Hub 是否启用、项目 ID、认证状态和当前 task 的 Hub 绑定状态。

### `suncode hub pull`

根据 `projectId + developerId` 拉取可处理需求。简单需求直接输出字符串内容；文档型需求输出 `document` payload 元数据，不在该命令里自动下载正文。

### `suncode hub download-document`

根据 `documentId` 申请 Hub 签发的 MinIO 下载 URL，下载正文并校验 SHA-256：

- 带 `--task` 或 `--task-json` 时，写入目标 task 的 `hub-sources/`。
- 不带 task 时，写入 `.suncode/hub-inbox/<documentId>/hub-sources/`。
- 支持 `--payload-json` 读取 Hub 返回的完整 `text` / `document` payload。
- 不扫描 `.suncode/tasks/**`，也不上传任何本地文档。

### `suncode hub create-task`

用途：

- hook 自动调用：`suncode hub create-task --task-json "$TASK_JSON_PATH"`
- AI/用户补跑：`suncode hub create-task --task current`

行为：

1. Hub 未启用：exit 0，输出 skipped。
2. 缺 requirement 元数据：exit 0，输出 skipped，因为这可能是普通本地 task。
3. 已有 `remoteTaskId`：校验远端绑定，成功则 no-op。
4. 无 `remoteTaskId`：调用 Hub create/bind 接口。
5. 成功后回写 `task.json.meta.hub`。
6. 失败后回写 `lastError`，exit 1。

### `suncode hub submit-plan`

上传当前 task 的规划工件：

- `prd.md`
- `design.md`
- `implement.md`
- 可选 `research/**`

只处理 hash 变化的文件。上传流程是先申请 MinIO 上传会话，再 PUT 文档正文到 MinIO，最后向 Hub API 提交对象引用。成功后更新 manifest 和 `planSubmissionId`。

### `suncode hub pull-review`

根据 `remoteTaskId + lastReviewCursor` 拉取审核意见。简单意见直接返回字符串；文档型意见返回 `document` payload 元数据，由 AI/skill 再调用 `suncode hub download-document --task <task-dir>` 下载附件。AI 根据意见修改文档，再执行 `submit-plan`。

### `suncode hub sync`

综合同步入口：

- 补绑定失败的 task。
- 拉取 requirement 变更；简单变更读字符串，文档型变更返回 `document` payload 元数据，再显式调用 `download-document` 下载。
- 拉取审核意见。
- 提示需要重新提交规划或处理冲突。

### `suncode hub preflight-start`

开发前 gate：

1. 确认 Hub enabled。
2. 确认 task 已绑定远端。
3. 确认 requirement revision 未落后。
4. 确认最新规划工件已上传。
5. 按 `startReviewPolicy` 处理 Hub review status：
   - `approved`：直接通过。
   - 非 `approved` 且策略为 `confirm`：未带确认标记时返回“需要二次确认”；带确认标记时通过并把 override 同步给 Hub。
   - 非 `approved` 且策略为 `block`：失败。
   - 策略为 `bypass`：跳过审核状态检查。

CLI 建议参数：

```bash
suncode hub preflight-start
suncode hub preflight-start --confirm-unapproved-review
```

AI 行为：

- 第一次 preflight 返回需要确认时，AI 必须向用户说明当前 `reviewStatus`、未处理审核意见摘要和继续风险。
- 用户明确确认后，AI 才能执行 `--confirm-unapproved-review`。
- 未得到用户明确确认时，不能运行 `task.py start`。

成功后 exit 0；失败 exit 1，阻止 AI 继续 `task.py start`。

### `suncode hub mark-started`

`after_start` 自动调用，通知 Hub 本地 task 已进入 `in_progress`。这是状态通知，不是开发前 gate。

### `suncode hub submit-spec`

提交 `.suncode/spec/**` 中真正变更的文件：

1. 用 git diff 找候选文件。
2. 只 hash 候选文件。
3. 与 manifest 比较。
4. 申请 MinIO 上传会话并上传变更工件正文。
5. 调用 Hub API 提交对象引用。
6. 更新 manifest。

### `suncode hub submit-completion`

提交任务结束材料：

- `implementation-summary.md`
- `validation-summary.md`
- `retrospective.md`
- `reuse-assessment.md`

如果材料不存在，命令应提示 AI 先生成，不应伪造空内容。存在的总结材料通过 MinIO 上传正文，再由 Hub API 接收对象引用和完成状态。

## 幂等设计

所有写入请求必须带 `Idempotency-Key`。

建议规则：

```text
create-task:
hub:create-task:{projectId}:{requirementId}:{localTaskId}

create-child-task:
hub:create-task:{projectId}:{requirementId}:{parentRemoteTaskId}:{localTaskId}

prepare-artifact-upload:
hub:prepare-upload:{remoteTaskId}:{artifactBundleHash}

submit-plan:
hub:submit-plan:{remoteTaskId}:{planRevision}:{artifactBundleHash}

preflight-start:
hub:preflight-start:{remoteTaskId}:{requirementRevision}:{artifactBundleHash}

preflight-start with review override:
hub:preflight-start:{remoteTaskId}:{requirementRevision}:{artifactBundleHash}:review-override

mark-started:
hub:mark-started:{remoteTaskId}:{localTaskStatusRevision}

submit-spec:
hub:submit-spec:{remoteTaskId}:{specBundleHash}

submit-completion:
hub:submit-completion:{remoteTaskId}:{completionBundleHash}
```

Hub 端应保证同一个幂等键重复请求返回同一业务结果。

上传会话的幂等键基于 bundle hash，而不是 MinIO 预签名 URL。预签名 URL 过期后，同一个上传会话可以重新签发 URL，但不得改变已声明的 artifact path、sha256、size 和 type。

## 变更检测设计

### 规划文档

固定扫描当前 task：

```text
prd.md
design.md
implement.md
research/**
```

### spec 文档

先缩小候选范围：

```text
git diff --name-only HEAD -- .suncode/spec
git diff --name-only --cached -- .suncode/spec
git diff --name-only <base>...HEAD -- .suncode/spec
```

再计算候选文件 hash。

### hash 规则

- 文本内容统一 CRLF -> LF。
- 使用 SHA-256。
- 第一版只把 Suncode 文本文档作为 Hub artifact 上传；二进制业务附件不纳入本次范围。
- `size + mtimeMs` 只能作为缓存命中优化，不能作为最终一致性依据。

## 错误处理

| 场景 | 行为 |
| --- | --- |
| Hub 未启用 | exit 0，输出 skipped |
| Hub 已启用但配置缺失 | exit 1，输出配置错误 |
| Hub 已启用但缺 JWT | exit 1，输出认证错误 |
| 网络失败 | exit 1，标记 retryable |
| MinIO 预签名 URL 过期 | 重新向 Hub 申请上传/下载 URL 后重试 |
| MinIO 上传成功但 submission 失败 | 保留上传会话状态，补跑 submission，不重复上传未变化对象 |
| requirement revision 落后 | exit 1，提示先 `suncode hub sync` |
| review 未通过且策略为 `confirm`，但没有二次确认 | exit 1，提示 AI 向用户二次确认 |
| review 未通过且策略为 `confirm`，并已二次确认 | exit 0，同步 override |
| review 未通过且策略为 `block` | exit 1，提示先处理审核意见 |
| 没有变更工件 | exit 0，输出 no changes |

Hook 中的 exit 1 会表现为 warning，因此关键 gate 必须在显式命令中执行，例如 `preflight-start`。

## 安全设计

- JWT 只从 `SUNCODE_HUB_TOKEN` 环境变量读取，不进 repo。
- JWT 不写 `task.json`、manifest 或日志。
- 错误信息只记录摘要。
- Hub disabled 时不读取 JWT、不联网。
- API client 默认超时，避免 hook 卡住太久。
- MinIO 预签名 URL 视为短期敏感凭据，不写入 task 文档、manifest 或普通日志。
- manifest 只保存稳定对象引用、hash、size、revision，不保存 URL、JWT 或 MinIO secret。

## 开放设计点

当前无阻塞开放设计点。`submit-completion` 由 `suncode-hub-finish` / 显式 CLI 负责，`after_archive` 只做 best-effort 兜底，不作为唯一完成语义。
