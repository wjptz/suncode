# Hub Review 后端开发清单

本文只保留本次 `suncode hub review` 需要 Hub 后端开发或放开的内容。既有能力如登录、task 绑定、状态 patch、artifact upload session、MinIO signed URL 上传、completion submission 本身不在本文重复展开。

## 1. 放开 task review 状态

现有接口复用：

```http
PATCH /api/v1/projects/{projectId}/tasks/{remoteTaskId}/status
```

Hub 后端需要在 task 状态枚举或校验规则中接受以下 review 状态：

| 状态 | 含义 |
| --- | --- |
| `in_review` | CLI 已开始执行本轮 review。 |
| `changes_requested` | Review 返回 must-fix 问题，需要开发者修改后重新 review。 |
| `approved` | Review 通过，当前 diff/head 已被批准。 |
| `blocked` | Review provider 失败、返回格式非法，或 provider 修改了工作树，不能视为通过。 |

本次不需要新增状态接口。CLI 会在 review 开始时 patch `in_review`，在 review submission 成功后 patch 最终状态。

状态 patch 的 `Idempotency-Key` 形如
`hub:review-status:{remoteTaskId}:{status}:{payloadHash}`。因为 payload
包含 `updatedAt`，同一 task/status 在多轮 review 中不是同一个幂等操作；
`payloadHash` 用于避免下一轮 review 或删除本地 round 后重跑时，用相同
key 提交不同 body。

## 2. 放开 review artifact 类型

现有接口复用：

```http
POST /api/v1/projects/{projectId}/artifact-upload-sessions
```

Hub 后端需要放开两个枚举值：

```text
submissionKind = "review"
artifact.type = "review"
```

Review artifact 仍走现有 artifact upload session + MinIO signed URL 流程。Hub 只需要按现有上传逻辑给每个 artifact path 返回 upload target。

本轮 review 可能上传的文件：

| 文件 | 是否必有 | 说明 |
| --- | --- | --- |
| `reviews/round-NNN/review.json` | 是 | 结构化 review 结果，Hub 可解析它展示详情。 |
| `reviews/round-NNN/result.md` | 是 | 面向人的 review 总结报告，不是 provider 原始输出。 |
| `reviews/round-NNN/diff.patch` | 是 | 本轮 review 对应 diff。 |
| `reviews/round-NNN/prompt.md` | 是 | CLI 生成给 provider 的 prompt。 |
| `reviews/round-NNN/raw-output.md` | 否 | provider stdout/stderr 原文；`saveRawOutput=false` 时不存在。 |
| `reviews/round-NNN/fix-summary.md` | 否 | 后续轮次可用于记录修复摘要。 |

后端不要假设 `raw-output.md` 一定存在，也不要把 `result.md` 当原始日志处理。

## 3. 新增 review submission

需要新增或开放一个与现有 `plan-submissions`、`completion-submissions` 同风格的接口：

```http
POST /api/v1/projects/{projectId}/tasks/{remoteTaskId}/review-submissions
```

### 请求体

```json
{
  "developerId": "dev_456",
  "requirementId": "REQ-1001",
  "localTaskId": "07-02-hub-review-cli-workflow",
  "localTaskPath": ".suncode/tasks/07-02-hub-review-cli-workflow",
  "artifactScope": "current_task",
  "uploadSessionId": "UPLOAD-9001",
  "reviewBundleHash": "sha256...",
  "review": {
    "round": 1,
    "provider": "engineer",
    "status": "changes_requested",
    "diffHash": "sha256...",
    "headCommit": "abc123",
    "summary": "发现 1 个必须修复问题。",
    "mustFixCount": 1,
    "advisoryCount": 1
  },
  "artifacts": [
    {
      "path": "reviews/round-001/review.json",
      "type": "review",
      "sha256": "sha256...",
      "size": 2048,
      "contentType": "application/json",
      "storage": "minio",
      "objectRef": {
        "provider": "minio",
        "objectKey": "objects/reviews/round-001/review.json",
        "versionId": null
      },
      "uploadSessionId": "UPLOAD-9001"
    }
  ]
}
```

### 必须支持的字段

| 字段 | 说明 |
| --- | --- |
| `reviewBundleHash` | 本轮 review artifact bundle hash，用于幂等和去重。 |
| `review.round` | 本地 review 轮次，从 1 开始递增。 |
| `review.provider` | 第一版为 `engineer`。 |
| `review.status` | `approved`、`changes_requested` 或 `blocked`。 |
| `review.diffHash` | Review 绑定的 diff hash。 |
| `review.headCommit` | 可选；当前 Git HEAD。 |
| `review.summary` | 列表或详情页可直接展示的摘要。 |
| `review.mustFixCount` | 必须修复问题数量。 |
| `review.advisoryCount` | 建议问题数量。 |
| `artifacts[]` | 本轮 review 已上传 artifact 的 object refs。 |

### Idempotency-Key

CLI 会发送：

```text
hub:submit-review:{remoteTaskId}:{round}:{reviewBundleHash}
```

Hub 后端需要按既有写接口规则支持幂等。

### 响应体

CLI 最小依赖：

```json
{
  "submission": {
    "id": "REVIEW-6001",
    "remoteRevision": 4,
    "reviewStatus": "changes_requested",
    "taskStatus": "changes_requested",
    "createdAt": "2026-07-02T06:35:00.000Z"
  },
  "artifacts": [
    {
      "path": "reviews/round-001/review.json",
      "remoteArtifactId": "ART-review-json",
      "remoteRevision": 1,
      "sha256": "sha256...",
      "storage": "minio",
      "objectRef": {
        "provider": "minio",
        "objectKey": "objects/reviews/round-001/review.json",
        "versionId": null
      }
    }
  ]
}
```

实际最重要的是：

- `submission.id`：CLI 会记录为 `lastReviewSubmissionId`。
- `artifacts[].path`：用于回填本地 manifest 中对应 artifact。
- `artifacts[].remoteArtifactId` / `remoteRevision`：可选，返回则 CLI 会记录。
- `artifacts[].objectRef`：可选，返回则优先使用 Hub 返回值；不返回则 CLI 使用 upload session 的 objectRef。

## 4. Review submission 数据模型

建议 Hub 保存一张 review submission 表或等价结构，至少包含：

| 字段 | 说明 |
| --- | --- |
| `id` | Review submission ID。 |
| `projectId` | 项目 ID。 |
| `remoteTaskId` | Hub task ID。 |
| `developerId` | 提交者。 |
| `round` | 第几轮 review。 |
| `provider` | `engineer`。 |
| `status` | `approved`、`changes_requested`、`blocked`。 |
| `diffHash` | Review 绑定 diff。 |
| `headCommit` | 可选 HEAD commit。 |
| `summary` | 摘要。 |
| `mustFixCount` | must-fix 数量。 |
| `advisoryCount` | advisory 数量。 |
| `reviewBundleHash` | 本轮 artifact bundle hash。 |
| `uploadSessionId` | Artifact upload session ID。 |
| `createdAt` | 创建时间。 |

逐条问题详情不必进主表，Hub 可以从 `reviews/round-NNN/review.json` artifact 中解析。

`review.json` 中的逐条问题结构如下：

```json
{
  "mustFix": [
    {
      "severity": "high",
      "file": "packages/cli/src/commands/hub/config.ts",
      "line": 42,
      "title": "Result report must not store raw provider log",
      "detail": "result.md should contain reviewer findings only."
    }
  ],
  "advisory": [
    {
      "severity": "low",
      "file": "docs-site/advanced/configuration.mdx",
      "title": "Document raw output location",
      "detail": "Mention raw-output.md for diagnostics."
    }
  ]
}
```
