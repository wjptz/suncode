# Hub API 接口文档草案

## 目的

本文档定义 Suncode CLI 为支持团队 Hub 协作需要调用的 Hub 平台接口。接口由 Suncode 侧先设计，Hub 平台按该合同实现或协商调整。

核心边界：

- Hub API 是控制面，只交换 JSON 元数据、状态、cursor、revision、hash、对象引用和短字符串。
- 文档正文上传/下载统一通过 MinIO 兼容对象存储完成。
- Suncode 本地不保存 MinIO access key / secret key；第一版由 Hub API 基于 JWT 签发短期预签名上传/下载 URL。
- 需求、需求变更、审核补充信息支持两种载荷：`text` 和 `document`。

## 通用约定

### Base URL

```text
{apiBaseUrl}/api/v1
```

`apiBaseUrl` 来自 `.suncode/config.yaml`：

```yaml
hub:
  enabled: true
  projectId: "proj_123"
  apiBaseUrl: "https://hub.example.com"
```

### 鉴权

第一版使用 JWT 身份认证：

```http
Authorization: Bearer <jwt>
```

JWT 不进入项目仓库。Suncode CLI 必须从环境变量读取：

```text
SUNCODE_HUB_TOKEN
```

第一版不支持用户级 JWT 配置文件或系统凭据存储。

### 内容类型

Hub API：

```http
Content-Type: application/json
Accept: application/json
```

MinIO 预签名 URL 上传：

```http
PUT <presignedUploadUrl>
Content-Type: <artifact.contentType>
```

预签名 URL 和上传 headers 由 Hub API 返回。Suncode 不自行拼接 MinIO 签名。

### 幂等

所有写入接口必须支持：

```http
Idempotency-Key: <stable-key>
```

同一个 key 重复请求时，Hub 应返回相同业务结果，不创建重复 task、submission、upload session 或 artifact 记录。

### 时间格式

所有时间使用 ISO-8601 UTC：

```text
2026-06-30T12:00:00Z
```

### 错误响应

所有非 2xx 响应建议统一结构：

```json
{
  "error": {
    "code": "REQUIREMENT_REVISION_CONFLICT",
    "message": "Local requirement revision is stale.",
    "retryable": false,
    "details": {
      "currentRequirementRevision": 8,
      "localRequirementRevision": 7
    }
  }
}
```

常见错误码：

| code | HTTP | 说明 |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | JWT 缺失或无效 |
| `FORBIDDEN` | 403 | 用户无项目/需求权限 |
| `NOT_FOUND` | 404 | project / requirement / task / document 不存在 |
| `VALIDATION_ERROR` | 400 | 请求参数不合法 |
| `REQUIREMENT_REVISION_CONFLICT` | 409 | 本地需求版本落后 |
| `PLAN_REVIEW_CONFIRMATION_REQUIRED` | 409 | 规划未审核通过，允许开始但需要用户二次确认 |
| `PLAN_REVIEW_BLOCKED` | 409 | 配置为强制审核通过，当前不允许开始 |
| `IDEMPOTENCY_CONFLICT` | 409 | 同一幂等键被不同 payload 使用 |
| `UPLOAD_SESSION_EXPIRED` | 410 | 上传会话或预签名 URL 已过期 |
| `ARTIFACT_OBJECT_MISSING` | 409 | submission 引用的 MinIO 对象不存在或未上传完成 |
| `ARTIFACT_HASH_MISMATCH` | 409 | MinIO 对象 hash 与声明不一致 |
| `RATE_LIMITED` | 429 | 请求过多 |
| `INTERNAL_ERROR` | 500 | Hub 内部错误 |

## 文档传输约定

### 控制面和数据面

| 层 | 负责内容 |
| --- | --- |
| Hub API | 需求/任务/审核/状态/提交记录、artifact 元数据、hash、MinIO 对象引用、预签名 URL 签发 |
| MinIO | 文档正文，包括需求文档、需求变更文档、评审附件、规划文档、spec 文档、完成总结文档 |

Hub API 请求/响应不得承载文档正文。简单短内容可以作为字符串字段传输。

### 文本或文档载荷

简单字符串载荷：

```json
{
  "kind": "text",
  "text": "Retry count changed from 3 to 5.",
  "document": null
}
```

文档载荷：

```json
{
  "kind": "document",
  "text": null,
  "document": {
    "documentId": "DOC-1001",
    "filename": "requirement.md",
    "contentType": "text/markdown",
    "sha256": "abc123",
    "size": 2048,
    "objectRef": {
      "provider": "minio",
      "objectKey": "projects/proj_123/requirements/REQ-1001/revisions/7/requirement.md",
      "versionId": "minio-version-1"
    }
  }
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `kind` | `text` 或 `document` |
| `text` | 简单字符串内容；`document` 载荷中必须为 `null` |
| `document.documentId` | Hub 文档 ID，用于后续签发下载 URL |
| `document.objectRef` | 稳定 MinIO 对象引用，不包含临时签名 |
| `sha256` | 文档正文 hash，Suncode 下载后必须校验 |
| `size` | 文档字节数，用于展示和快速校验 |

### Artifact 对象引用

Suncode 上传本地文档后，在 submission API 中提交 artifact 元数据：

```json
{
  "path": "prd.md",
  "type": "prd",
  "sha256": "abc123",
  "size": 1200,
  "contentType": "text/markdown",
  "storage": "minio",
  "objectRef": {
    "provider": "minio",
    "objectKey": "projects/proj_123/tasks/TASK-2001/plan/PLAN-3001/prd.md",
    "versionId": "minio-version-1"
  },
  "uploadSessionId": "UPLOAD-9001"
}
```

`type` 可选值：

```text
prd
design
implement
research
spec
implementation_summary
validation_summary
retrospective
reuse_assessment
```

## 0. 创建 artifact 上传会话

```http
POST /api/v1/projects/{projectId}/artifact-upload-sessions
Idempotency-Key: hub:prepare-upload:{remoteTaskId}:{artifactBundleHash}
```

用途：`submit-plan`、`submit-spec`、`submit-completion` 上传文档正文前，向 Hub 申请 MinIO 预签名上传 URL。

`submit-plan` / `submit-completion` 使用 `artifactScope=current_task`；`submit-spec` 使用 `artifactScope=project_spec`，因为 `.suncode/spec/**` 是项目级资产，不归属某个本地 task。

请求：

```json
{
  "developerId": "dev_456",
  "remoteTaskId": "TASK-2001",
  "localTaskId": "06-30-payment-retry",
  "localTaskPath": ".suncode/tasks/06-30-payment-retry",
  "artifactScope": "current_task",
  "submissionKind": "plan",
  "artifactBundleHash": "bundle_sha256",
  "artifacts": [
    {
      "path": "prd.md",
      "type": "prd",
      "sha256": "abc",
      "size": 1200,
      "contentType": "text/markdown"
    },
    {
      "path": "design.md",
      "type": "design",
      "sha256": "def",
      "size": 2400,
      "contentType": "text/markdown"
    }
  ]
}
```

响应：

```json
{
  "uploadSession": {
    "id": "UPLOAD-9001",
    "expiresAt": "2026-06-30T12:15:00Z",
    "artifactBundleHash": "bundle_sha256"
  },
  "uploads": [
    {
      "path": "prd.md",
      "uploadUrl": "https://minio.example.com/presigned-put-url",
      "method": "PUT",
      "headers": {
        "Content-Type": "text/markdown"
      },
      "objectRef": {
        "provider": "minio",
        "objectKey": "projects/proj_123/tasks/TASK-2001/plan/UPLOAD-9001/prd.md",
        "versionId": null
      },
      "expiresAt": "2026-06-30T12:15:00Z"
    }
  ]
}
```

约束：

- `uploadUrl` 是短期敏感凭据，Suncode 不写入 manifest 或普通日志。
- 同一个 `Idempotency-Key` 重复请求可以重新签发 URL，但 artifact path/type/sha256/size 不得改变。
- Hub 后端应在 submission API 中校验对象存在，并校验 hash。

## 0.1 获取文档下载 URL

```http
GET /api/v1/projects/{projectId}/documents/{documentId}/download-url
```

用途：需求、需求变更或评审附件是 `document` 载荷时，Suncode 根据 `documentId` 获取 MinIO 预签名下载 URL。

Suncode CLI 对应命令：

```bash
suncode hub download-document --document-id "DOC-1001" --filename "requirement.md"
```

如果文档属于已创建的本地任务，命令应带上当前任务，文件会写入该任务目录下的 `hub-sources/`：

```bash
suncode hub download-document --document-id "DOC-1001" --task "06-30-payment-retry"
```

如果任务尚未创建，命令默认写入 `.suncode/hub-inbox/<documentId>/hub-sources/`，供 AI 创建任务和编写 PRD 时引用。

响应：

```json
{
  "document": {
    "documentId": "DOC-1001",
    "filename": "requirement.md",
    "contentType": "text/markdown",
    "sha256": "abc123",
    "size": 2048
  },
  "download": {
    "url": "https://minio.example.com/presigned-get-url",
    "method": "GET",
    "expiresAt": "2026-06-30T12:15:00Z"
  }
}
```

Suncode 下载后必须按 `sha256` 校验正文，校验失败时不得把文件作为可信需求输入。

## 数据模型

### Requirement

```json
{
  "id": "REQ-1001",
  "projectId": "proj_123",
  "title": "Add payment retry",
  "summary": "Retry failed payment automatically.",
  "body": {
    "kind": "text",
    "text": "Retry failed payment up to 3 times.",
    "document": null
  },
  "status": "ready",
  "priority": "P1",
  "revision": 7,
  "assigneeDeveloperId": "dev_456",
  "updatedAt": "2026-06-30T12:00:00Z"
}
```

文档型需求只把长文档放入 `body.document`，不在 API 中返回正文。

### Remote Task

```json
{
  "id": "TASK-2001",
  "projectId": "proj_123",
  "requirementId": "REQ-1001",
  "localTaskId": "06-30-payment-retry",
  "localTaskName": "payment-retry",
  "taskRole": "parent",
  "parentTaskId": null,
  "title": "Add payment retry",
  "status": "planning",
  "createdByDeveloperId": "dev_456",
  "createdAt": "2026-06-30T12:00:00Z",
  "updatedAt": "2026-06-30T12:00:00Z"
}
```

## 1. 拉取开发者可处理需求

```http
GET /api/v1/projects/{projectId}/requirements?developerId={developerId}&status=ready,in_review,changes_requested
```

用途：`suncode hub pull`

响应：

```json
{
  "requirements": [
    {
      "id": "REQ-1001",
      "projectId": "proj_123",
      "title": "Add payment retry",
      "summary": "Retry failed payment automatically.",
      "body": {
        "kind": "document",
        "text": null,
        "document": {
          "documentId": "DOC-1001",
          "filename": "requirement.md",
          "contentType": "text/markdown",
          "sha256": "abc123",
          "size": 2048,
          "objectRef": {
            "provider": "minio",
            "objectKey": "projects/proj_123/requirements/REQ-1001/revisions/7/requirement.md",
            "versionId": "minio-version-1"
          }
        }
      },
      "status": "ready",
      "priority": "P1",
      "revision": 7,
      "assigneeDeveloperId": "dev_456",
      "updatedAt": "2026-06-30T12:00:00Z"
    }
  ]
}
```

## 2. 获取单个需求详情

```http
GET /api/v1/projects/{projectId}/requirements/{requirementId}
```

用途：创建 task 前确认需求详情、开发中处理变更前确认最新 revision。

响应：

```json
{
  "requirement": {
    "id": "REQ-1001",
    "projectId": "proj_123",
    "title": "Add payment retry",
    "summary": "Retry failed payment automatically.",
    "body": {
      "kind": "text",
      "text": "Retry failed payment up to 3 times.",
      "document": null
    },
    "acceptanceCriteria": [
      {
        "kind": "text",
        "text": "Retry failed payment up to 3 times.",
        "document": null
      }
    ],
    "status": "ready",
    "priority": "P1",
    "revision": 7,
    "updatedAt": "2026-06-30T12:00:00Z"
  }
}
```

## 3. 创建/绑定远端任务

```http
POST /api/v1/projects/{projectId}/requirements/{requirementId}/tasks
Idempotency-Key: hub:create-task:{projectId}:{requirementId}:{localTaskId}
```

用途：`after_create -> suncode hub create-task`

请求：

```json
{
  "developerId": "dev_456",
  "requirementRevision": 7,
  "taskRole": "parent",
  "parentRemoteTaskId": null,
  "parentLocalTaskId": null,
  "localTaskId": "06-30-payment-retry",
  "localTaskName": "payment-retry",
  "localTaskPath": ".suncode/tasks/06-30-payment-retry",
  "title": "Add payment retry",
  "source": "suncode"
}
```

响应：

```json
{
  "task": {
    "id": "TASK-2001",
    "projectId": "proj_123",
    "requirementId": "REQ-1001",
    "localTaskId": "06-30-payment-retry",
    "taskRole": "parent",
    "parentTaskId": null,
    "status": "planning",
    "createdAt": "2026-06-30T12:00:00Z"
  }
}
```

幂等要求：

- 同一 `Idempotency-Key` 重复请求返回同一个 `task.id`。
- 如果同一个 local task 已绑定，返回已有绑定。
- `taskRole=child` 时，Hub 必须校验 `parentRemoteTaskId` 存在且属于同一个 `projectId + requirementId`。

## 4. 提交规划工件

```http
POST /api/v1/projects/{projectId}/tasks/{remoteTaskId}/plan-submissions
Idempotency-Key: hub:submit-plan:{remoteTaskId}:{planRevision}:{artifactBundleHash}
```

用途：`suncode hub submit-plan`

前置条件：Suncode 已通过 `POST /artifact-upload-sessions` 获取上传 URL，并把变更工件正文上传到 MinIO。

请求：

```json
{
  "developerId": "dev_456",
  "requirementId": "REQ-1001",
  "requirementRevision": 7,
  "localTaskId": "06-30-payment-retry",
  "localTaskPath": ".suncode/tasks/06-30-payment-retry",
  "artifactScope": "current_task",
  "planRevision": 3,
  "artifactBundleHash": "bundle_sha256",
  "uploadSessionId": "UPLOAD-9001",
  "artifacts": [
    {
      "path": "prd.md",
      "type": "prd",
      "sha256": "abc",
      "size": 1200,
      "contentType": "text/markdown",
      "storage": "minio",
      "objectRef": {
        "provider": "minio",
        "objectKey": "projects/proj_123/tasks/TASK-2001/plan/UPLOAD-9001/prd.md",
        "versionId": "minio-version-1"
      },
      "uploadSessionId": "UPLOAD-9001"
    }
  ]
}
```

响应：

```json
{
  "submission": {
    "id": "PLAN-3001",
    "remoteRevision": 4,
    "reviewStatus": "pending",
    "createdAt": "2026-06-30T12:00:00Z"
  },
  "artifacts": [
    {
      "path": "prd.md",
      "remoteArtifactId": "ART-1",
      "remoteRevision": 3,
      "sha256": "abc",
      "storage": "minio",
      "objectRef": {
        "provider": "minio",
        "objectKey": "projects/proj_123/tasks/TASK-2001/plan/UPLOAD-9001/prd.md",
        "versionId": "minio-version-1"
      }
    }
  ]
}
```

冲突：

- 如果 `requirementRevision` 落后，返回 `409 REQUIREMENT_REVISION_CONFLICT`。
- 如果引用的 MinIO 对象不存在或 hash 不一致，返回 `ARTIFACT_OBJECT_MISSING` 或 `ARTIFACT_HASH_MISMATCH`。

## 5. 拉取审核意见

```http
GET /api/v1/projects/{projectId}/tasks/{remoteTaskId}/reviews?cursor={cursor}
```

用途：`suncode hub pull-review`

响应：

```json
{
  "reviewStatus": "changes_requested",
  "nextCursor": "review_cursor_002",
  "comments": [
    {
      "id": "REV-COMMENT-1",
      "artifactPath": "design.md",
      "line": 42,
      "severity": "blocking",
      "body": {
        "kind": "text",
        "text": "Please clarify rollback behavior.",
        "document": null
      },
      "createdBy": "reviewer_1",
      "createdAt": "2026-06-30T12:00:00Z"
    }
  ]
}
```

如果评论是长文档或附件，`body.kind` 使用 `document`，Suncode 通过下载 URL 接口拉取正文。

## 6. 拉取需求变更

```http
GET /api/v1/projects/{projectId}/requirements/{requirementId}/changes?cursor={cursor}
```

用途：`suncode hub sync`

响应：

```json
{
  "currentRevision": 8,
  "nextCursor": "change_cursor_002",
  "changes": [
    {
      "id": "REQ-CHANGE-1",
      "fromRevision": 7,
      "toRevision": 8,
      "summary": "Retry count changed from 3 to 5.",
      "body": {
        "kind": "text",
        "text": "Retry count changed from 3 to 5.",
        "document": null
      },
      "createdAt": "2026-06-30T12:00:00Z"
    }
  ]
}
```

文档型需求变更使用 `body.kind=document`，Suncode 下载正文后再修改本地规划或实现。

## 7. 开发前 preflight

```http
POST /api/v1/projects/{projectId}/tasks/{remoteTaskId}/preflight-start
Idempotency-Key: hub:preflight-start:{remoteTaskId}:{requirementRevision}:{artifactBundleHash}
```

用途：`suncode hub preflight-start`

请求：

```json
{
  "developerId": "dev_456",
  "requirementId": "REQ-1001",
  "requirementRevision": 8,
  "planSubmissionId": "PLAN-3001",
  "artifactBundleHash": "bundle_sha256",
  "startReviewPolicy": "confirm",
  "confirmUnapprovedReview": false
}
```

成功响应：

```json
{
  "allowed": true,
  "taskStatus": "ready_to_start",
  "requirementRevision": 8
}
```

需要二次确认的响应示例：

```json
{
  "error": {
    "code": "PLAN_REVIEW_CONFIRMATION_REQUIRED",
    "message": "Plan is not approved. User confirmation is required before starting.",
    "retryable": false,
    "details": {
      "reviewStatus": "changes_requested",
      "canOverrideWithConfirmation": true,
      "confirmationFlag": "confirmUnapprovedReview"
    }
  }
}
```

用户二次确认后，Suncode CLI 重新请求：

```json
{
  "developerId": "dev_456",
  "requirementId": "REQ-1001",
  "requirementRevision": 8,
  "planSubmissionId": "PLAN-3001",
  "artifactBundleHash": "bundle_sha256",
  "startReviewPolicy": "confirm",
  "confirmUnapprovedReview": true,
  "confirmationSource": "user",
  "confirmationSummary": "User explicitly confirmed starting before review approval in the AI session."
}
```

Hub 成功响应：

```json
{
  "allowed": true,
  "taskStatus": "ready_to_start",
  "requirementRevision": 8,
  "reviewOverride": {
    "accepted": true,
    "reviewStatus": "changes_requested",
    "confirmedByDeveloperId": "dev_456",
    "confirmedAt": "2026-06-30T12:00:00Z"
  }
}
```

## 8. 更新任务状态

```http
PATCH /api/v1/projects/{projectId}/tasks/{remoteTaskId}/status
Idempotency-Key: hub:mark-started:{remoteTaskId}:{localTaskStatusRevision}
```

用途：`after_start -> suncode hub mark-started`，以及后续状态同步。

请求：

```json
{
  "developerId": "dev_456",
  "status": "in_progress",
  "localStatus": "in_progress",
  "localTaskPath": ".suncode/tasks/06-30-payment-retry",
  "updatedAt": "2026-06-30T12:00:00Z"
}
```

响应：

```json
{
  "task": {
    "id": "TASK-2001",
    "status": "in_progress",
    "updatedAt": "2026-06-30T12:00:00Z"
  }
}
```

## 9. 提交 spec 变更

```http
POST /api/v1/projects/{projectId}/tasks/{remoteTaskId}/spec-submissions
Idempotency-Key: hub:submit-spec:{remoteTaskId}:{specBundleHash}
```

用途：`suncode hub submit-spec`

前置条件：项目级 spec 文档正文已经通过上传会话写入 MinIO。`.suncode/spec/**` 是项目级资产，当前 task 只作为本次 submission 的需求/远端任务关联上下文。

请求：

```json
{
  "developerId": "dev_456",
  "requirementId": "REQ-1001",
  "localTaskId": "06-30-payment-retry",
  "localTaskPath": ".suncode/tasks/06-30-payment-retry",
  "artifactScope": "project_spec",
  "specBundleHash": "spec_bundle_sha256",
  "uploadSessionId": "UPLOAD-9002",
  "artifacts": [
    {
      "path": ".suncode/spec/cli/backend/workflow-state-contract.md",
      "type": "spec",
      "sha256": "abc",
      "size": 2048,
      "contentType": "text/markdown",
      "storage": "minio",
      "objectRef": {
        "provider": "minio",
        "objectKey": "projects/proj_123/tasks/TASK-2001/spec/UPLOAD-9002/workflow-state-contract.md",
        "versionId": "minio-version-2"
      },
      "uploadSessionId": "UPLOAD-9002"
    }
  ]
}
```

响应：

```json
{
  "submission": {
    "id": "SPEC-4001",
    "remoteRevision": 2,
    "createdAt": "2026-06-30T12:00:00Z"
  },
  "artifacts": [
    {
      "path": ".suncode/spec/cli/backend/workflow-state-contract.md",
      "remoteArtifactId": "ART-SPEC-1",
      "remoteRevision": 2,
      "sha256": "abc",
      "storage": "minio",
      "objectRef": {
        "provider": "minio",
        "objectKey": "projects/proj_123/tasks/TASK-2001/spec/UPLOAD-9002/workflow-state-contract.md",
        "versionId": "minio-version-2"
      }
    }
  ]
}
```

## 10. 提交任务完成材料

```http
POST /api/v1/projects/{projectId}/tasks/{remoteTaskId}/completion-submissions
Idempotency-Key: hub:submit-completion:{remoteTaskId}:{completionBundleHash}
```

用途：`suncode hub submit-completion`

前置条件：完成材料正文已经通过上传会话写入 MinIO。

请求：

```json
{
  "developerId": "dev_456",
  "requirementId": "REQ-1001",
  "localTaskId": "06-30-payment-retry",
  "localTaskPath": ".suncode/tasks/06-30-payment-retry",
  "artifactScope": "current_task",
  "includedChildTaskIds": [],
  "completionBundleHash": "completion_bundle_sha256",
  "uploadSessionId": "UPLOAD-9003",
  "summary": {
    "status": "completed",
    "commit": "abc123",
    "prUrl": "https://github.com/org/repo/pull/1"
  },
  "artifacts": [
    {
      "path": "implementation-summary.md",
      "type": "implementation_summary",
      "sha256": "abc",
      "size": 1200,
      "contentType": "text/markdown",
      "storage": "minio",
      "objectRef": {
        "provider": "minio",
        "objectKey": "projects/proj_123/tasks/TASK-2001/completion/UPLOAD-9003/implementation-summary.md",
        "versionId": "minio-version-3"
      },
      "uploadSessionId": "UPLOAD-9003"
    }
  ]
}
```

响应：

```json
{
  "submission": {
    "id": "DONE-5001",
    "remoteRevision": 1,
    "taskStatus": "completed",
    "createdAt": "2026-06-30T12:00:00Z"
  }
}
```

## 11. 查询远端任务

```http
GET /api/v1/projects/{projectId}/tasks/{remoteTaskId}
```

用途：补跑命令时校验本地 `remoteTaskId` 是否仍有效。

响应：

```json
{
  "task": {
    "id": "TASK-2001",
    "projectId": "proj_123",
    "requirementId": "REQ-1001",
    "taskRole": "parent",
    "parentTaskId": null,
    "status": "in_progress",
    "reviewStatus": "approved",
    "requirementRevision": 8,
    "updatedAt": "2026-06-30T12:00:00Z"
  }
}
```

## 12. 通过本地 task 查询远端绑定

```http
GET /api/v1/projects/{projectId}/tasks/by-local-id/{localTaskId}
```

用途：`create-task` 补跑时，如果本地丢失 `remoteTaskId`，可通过 local task ID 找回远端绑定。

响应：

```json
{
  "task": {
    "id": "TASK-2001",
    "projectId": "proj_123",
    "requirementId": "REQ-1001",
    "localTaskId": "06-30-payment-retry",
    "taskRole": "parent",
    "parentTaskId": null,
    "status": "planning"
  }
}
```

## Suncode 命令到 Hub API / MinIO 映射

| Suncode 命令 | Hub API / MinIO |
| --- | --- |
| `suncode hub pull` | `GET /projects/{projectId}/requirements` |
| `suncode hub download-document` | `GET /documents/{documentId}/download-url` + MinIO GET + SHA-256 校验 |
| `suncode hub create-task` | `POST /projects/{projectId}/requirements/{requirementId}/tasks` |
| `suncode hub submit-plan` | `POST /artifact-upload-sessions` + MinIO PUT + `POST /tasks/{remoteTaskId}/plan-submissions` |
| `suncode hub pull-review` | `GET /tasks/{remoteTaskId}/reviews`；文档型审核附件再调用 `download-document` |
| `suncode hub sync` | `GET /requirements/{requirementId}` + `GET /requirements/{requirementId}/changes`；文档型变更再调用 `download-document` |
| `suncode hub preflight-start` | `POST /projects/{projectId}/tasks/{remoteTaskId}/preflight-start` |
| `suncode hub mark-started` | `PATCH /projects/{projectId}/tasks/{remoteTaskId}/status` |
| `suncode hub submit-spec` | `POST /artifact-upload-sessions` + MinIO PUT + `POST /tasks/{remoteTaskId}/spec-submissions` |
| `suncode hub submit-completion` | `POST /artifact-upload-sessions` + MinIO PUT + `POST /tasks/{remoteTaskId}/completion-submissions` |

## Hub 后端实现要求

- 必须支持 JWT 身份认证。
- 必须支持幂等键。
- 必须能签发 MinIO 预签名上传/下载 URL。
- 必须保存 artifact 的 `path`、`type`、`sha256`、`size`、`remoteRevision`、`objectRef`。
- 必须在 submission 时校验 MinIO 对象存在，并校验对象 hash。
- 必须支持 requirement revision 冲突检测。
- 必须支持 review cursor 和 change cursor。
- 必须区分 `reviewStatus` 与 task `status`。
- 必须保证同一 project 内 `localTaskId` 可唯一定位一个远端 task。
- 必须支持一个 requirement 绑定一个 parent/single 主任务，并允许多个 child task 挂到该 parent。
- child task 必须校验 `parentTaskId` 与 `requirementId` 一致。
- 不应要求 Suncode 上传 JWT、token、secret 或 MinIO 凭据到 artifact 或 API payload 中。
- 不得要求 Suncode 通过 Hub API 上传或下载文档正文。
