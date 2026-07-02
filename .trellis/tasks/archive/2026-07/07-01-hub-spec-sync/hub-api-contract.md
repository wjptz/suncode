# Hub 对接接口文档：Spec 同步

本文只整理本次 `hub-spec-sync` 任务需要 Hub 后端配合的接口。

核心新增接口只有一个：

```http
GET /api/v1/projects/{projectId}/specs/bundle
```

其余 `login`、`health`、`requirements` 是现有 Hub 工作流已经使用的接口，本次只复用，不要求改变语义。

## 1. 通用约定

### Base URL

CLI 中配置的是 Hub 服务根地址，例如：

```text
https://hub.example.test
```

除登录接口外，CLI 会自动拼接 `/api/v1`：

```text
{apiBaseUrl}/api/v1{apiPath}
```

例如：

```text
https://hub.example.test/api/v1/projects/proj_123/specs/bundle
```

### 认证

本次接口使用 `suncode hub login` 的登录态。

```http
Authorization: Bearer <token>
Accept: application/json
```

不再使用 `SUNCODE_HUB_TOKEN`。

### 错误响应

推荐 Hub 统一返回：

```json
{
  "error": {
    "code": "SPEC_BUNDLE_NOT_FOUND",
    "message": "No approved spec bundle found for project.",
    "details": {
      "projectId": "proj_123"
    }
  }
}
```

CLI 会读取 `error.message` 作为主要错误信息，`error.code` 和 `error.details` 作为辅助信息。

建议状态码：

| 状态码 | 场景 |
| --- | --- |
| `401` | token 缺失、无效或过期 |
| `403` | 当前用户无权访问该项目 spec |
| `404` | project 不存在，或没有 approved spec bundle |
| `409` | 项目 spec 仍在审核中，暂无可拉取的权威版本 |
| `500` | Hub 服务异常 |

## 2. 复用接口：登录

该接口已存在，本次直接复用。

```http
POST /api/auth/login
Content-Type: application/json
```

请求：

```json
{
  "email": "admin@example.com",
  "password": "admin123"
}
```

响应：

```json
{
  "token": "jwt",
  "user": {
    "id": 1,
    "email": "admin@example.com",
    "display_name": "Admin",
    "role": "admin",
    "created_at": "2026-06-29T12:18:41.892335+08:00",
    "updated_at": "2026-06-29T12:18:41.892335+08:00"
  }
}
```

CLI 行为：

- 本地保存 `String(user.id)` 为 `developerId`。
- 本地保存 `user.display_name` 为展示名。
- token 按 `apiBaseUrl` 维度保存到全局登录态。
- 如果 JWT 有 `exp`，CLI 会用它计算本地 `expiresAt`。

## 3. 复用接口：健康检查

`suncode hub state --json` 会调用该接口判断 Hub 服务是否可用。

```http
GET /api/v1/health
Authorization: Bearer <token>
```

推荐响应：

```json
{
  "status": "ok",
  "name": "suncode-hub",
  "version": "2026.07.01"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `status` | string | 否 | 推荐返回 `ok`。缺失时 CLI 默认视为 `ok`。 |
| `name` | string | 否 | 服务名，仅用于状态展示。 |
| `version` | string | 否 | 服务版本，仅用于状态展示。 |

## 4. 复用接口：可接需求列表

`suncode hub state --json` 和 `suncode hub pull` 会调用该接口判断当前开发者是否有可接需求。

```http
GET /api/v1/projects/{projectId}/requirements?developerId={developerId}&status=ready,in_review,changes_requested
Authorization: Bearer <token>
```

参数：

| 参数 | 位置 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectId` | path | 是 | 当前项目 ID，来自 `.suncode/config.yaml` 的 `hub.projectId`。 |
| `developerId` | query | 是 | 当前登录用户 ID，来自登录响应 `user.id`。 |
| `status` | query | 是 | CLI 固定传 `ready,in_review,changes_requested`。 |

CLI 可接受三种响应形态：

```json
[
  {
    "id": "req_001",
    "title": "实现批量导入",
    "status": "ready"
  }
]
```

或：

```json
{
  "requirements": [
    {
      "id": "req_001",
      "title": "实现批量导入",
      "status": "ready"
    }
  ]
}
```

或：

```json
{
  "items": [
    {
      "id": "req_001",
      "title": "实现批量导入",
      "status": "ready"
    }
  ]
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` / `requirementId` | string | 是 | 需求 ID。CLI 优先读 `id`，缺失时读 `requirementId`。 |
| `title` | string | 否 | 需求标题，用于状态展示。 |
| `status` | string | 否 | 需求状态，用于状态展示。 |

## 5. 新增接口：拉取项目权威 Spec Bundle

这是本次需要 Hub 新增或确认实现的核心接口。

```http
GET /api/v1/projects/{projectId}/specs/bundle
Authorization: Bearer <token>
Accept: application/json
```

### 5.1 语义

该接口必须返回“当前项目最新已审核通过的全量权威 spec bundle”。

重要约束：

- 必须返回全量文件集合，不要只返回增量变更。
- Hub 返回的 `files` 就是线上审核版本的完整 spec 文件集。
- CLI 会用 `files` 和本地 `.suncode/.runtime/hub-specs.json` 机械计算新增、更新、删除和 local-only。
- 如果 Hub 只返回 changed files，CLI 会把上次由 Hub 管理、但这次没出现在响应里的文件判断为“远端删除”。

### 5.2 请求参数

| 参数 | 位置 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectId` | path | 是 | 当前项目 ID。 |

当前 MVP 不要求 `If-None-Match` / `304 Not Modified`。

后续可以做 ETag 优化，但需要 CLI 先显式支持 `If-None-Match` 和 `304`。在当前实现下，请 Hub 返回 `200` + 全量 JSON。

### 5.3 成功响应

```json
{
  "revision": "spec-rev-42",
  "etag": "\"sha256:bundle\"",
  "bundleHash": "sha256:bundle",
  "basePath": ".suncode/spec",
  "files": [
    {
      "path": "cli/backend/index.md",
      "sha256": "sha256:8c8f0e...",
      "size": 1234,
      "contentType": "text/markdown",
      "download": {
        "url": "https://minio.example.test/presigned/specs/proj_123/spec-rev-42/index.md",
        "method": "GET",
        "expiresAt": "2026-07-01T12:10:00+08:00"
      },
      "objectRef": {
        "provider": "minio",
        "bucket": "suncode-hub",
        "objectKey": "specs/proj_123/spec-rev-42/cli/backend/index.md"
      },
      "language": "zh-CN",
      "updatedAt": "2026-07-01T12:00:00+08:00"
    }
  ],
  "deleted": [
    "old/path.md"
  ]
}
```

### 5.4 顶层字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `revision` | string | 推荐 | Hub 侧 spec 权威版本号。CLI 会写入本地 manifest 和 `<hub-state>`。 |
| `etag` | string | 否 | 后续缓存优化用。当前 CLI 只保存，不发送 `If-None-Match`。 |
| `bundleHash` | string | 推荐 | 全量 bundle 内容 hash。CLI 会保存并展示。 |
| `basePath` | string | 否 | 推荐返回 `.suncode/spec`。CLI 会把它作为路径前缀剥离。 |
| `files` | array | 是 | 最新已审核通过的全量 spec 文件列表。 |
| `deleted` | array | 否 | 可选审计字段。当前 CLI 不依赖它判断删除。 |

### 5.5 files 字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 是 | spec 文件路径。推荐相对 `basePath`，如 `cli/backend/index.md`。 |
| `sha256` | string | 否但强烈推荐 | MinIO 文件内容规范化后的 sha256。CLI 支持 `64 hex` 或 `sha256:<hex>`。 |
| `size` | number | 否但推荐 | MinIO 文件内容规范化后的 UTF-8 字节数。提供时 CLI 会校验。 |
| `contentType` | string | 否 | 推荐 `text/markdown`。 |
| `download` | object | 是 | MinIO 临时下载信息。CLI 使用 `download.url` 拉取文件内容。 |
| `download.url` | string | 是 | MinIO signed URL。 |
| `download.method` | string | 否 | 当前只需要 `GET`；缺失时 CLI 默认 `GET`。 |
| `download.expiresAt` | string | 否 | signed URL 过期时间，仅用于排查。 |
| `objectRef` | object | 否 | MinIO 对象引用，仅用于审计或后续扩展；CLI 当前不依赖。 |
| `language` | string | 否 | 推荐 `zh-CN`，当前 CLI 不依赖。 |
| `updatedAt` | string | 否 | 文件更新时间，当前 CLI 不依赖。 |

### 5.6 路径规则

Hub 可以返回以下两种 path，CLI 都能接受：

```text
cli/backend/index.md
.suncode/spec/cli/backend/index.md
```

推荐使用第一种，并设置：

```json
{
  "basePath": ".suncode/spec"
}
```

禁止返回：

```text
/absolute/path.md
C:\absolute\path.md
../escape.md
cli/../escape.md
```

如果 path 为空、绝对路径或包含 `..`，CLI 会拒绝整个 bundle，不写本地成功 manifest。

### 5.7 Hash 与 size 规则

Hub 先把 spec 文件内容存入 MinIO，再在 bundle 中返回 signed URL。Hub 和 CLI 需要使用同一套规范化规则：

1. 将 MinIO 文件文本中的 CRLF 统一为 LF。
2. 用 UTF-8 字节计算 size。
3. 对规范化后的文本计算 sha256。

伪代码：

```ts
const normalized = minioText.replace(/\r\n/g, "\n");
const sha256 = sha256Hex(normalized);
const size = Buffer.byteLength(normalized, "utf-8");
```

`bundleHash` 推荐按排序后的文件摘要计算：

```json
[
  {
    "path": ".suncode/spec/cli/backend/index.md",
    "sha256": "8c8f0e...",
    "size": 1234,
    "contentType": "text/markdown"
  }
]
```

按 `path` 升序排序后 JSON 序列化，再 sha256。

当前 CLI 会从 `download.url` 拉取文本，然后校验文件级 `sha256` 和 `size`；`bundleHash` 当前主要用于记录和展示，不作为阻塞校验。

### 5.8 删除语义

CLI 不依赖响应里的 `deleted` 字段判断本地删除。

本地删除判断来自：

```text
deleted = 上次 hub-specs.json 记录的 Hub-managed 文件 - 本次 files 文件集合
```

因此 Hub 只需要保证 `files` 是全量权威文件集合。

当 CLI 发现某个上次 Hub-managed 文件本次不在 `files` 中时，会：

1. 把本地旧内容保存到 `.suncode/.runtime/hub-spec-deletions/<revision>/`。
2. 从 `.suncode/spec/**` 权威路径删除该文件。
3. 在 `pull-spec --json` 中返回 deletion candidate。

### 5.9 无变更场景

MVP 推荐仍然返回：

```http
200 OK
Content-Type: application/json
```

并返回完整 bundle。CLI 会自己计算 `unchanged`。

当前不要返回 `304 Not Modified`，否则现有 CLI 会把它视为非成功响应。

## 6. 本地命令但不需要 Hub 接口

以下命令是纯本地删除候选管理，不需要 Hub 新增接口：

```text
suncode hub spec-deletions list --json
suncode hub spec-deletions keep --id <id> --as .suncode/spec/local/<name>.md
suncode hub spec-deletions discard --id <id>
```

它们只读写本地：

```text
.suncode/.runtime/hub-spec-deletions/**
.suncode/spec/local/**
```

不会调用 Hub API，也不会把删除候选自动提交回 Hub。

## 7. 本次暂不要求变更的接口

### submit-spec

现有：

```text
suncode hub submit-spec
```

当前仍按已有上传流程工作：CLI 上传 project-level spec artifacts，并提交 object refs 给 Hub。

本次 `pull-spec` 不要求修改 `submit-spec` 后端接口。

如果 Hub 后续希望通过 `submit-spec` 自动判断“本地删除了哪些 spec”，需要另行扩展 payload，让客户端提交完整 inventory 或 tombstone。原因是当前 `submit-spec` 主要上传 changed artifacts，单靠 changed files 无法可靠判断删除。

### 304 / ETag 优化

`etag` 字段可以先返回并保存，但本次不要求服务端实现 `304 Not Modified`。

如果后续要做缓存优化，需要同步改 CLI：

```http
If-None-Match: "<etag>"
```

以及对：

```http
304 Not Modified
```

做专门处理。

## 8. 最小验收清单

Hub 后端本次只要满足以下条件，CLI 侧 spec 同步即可工作：

- `POST /api/auth/login` 维持现有响应格式。
- `GET /api/v1/health` 登录后返回 `2xx`。
- `GET /api/v1/projects/{projectId}/requirements?...` 登录后返回数组或 `{ requirements/items/data: [] }`。
- `GET /api/v1/projects/{projectId}/specs/bundle` 返回 `200` + 全量 approved spec bundle 元数据。
- `specs/bundle.files[*].path` 是安全相对路径。
- `specs/bundle.files[*].download.url` 是可 GET 的短期 MinIO signed URL。
- 如果返回 `sha256` / `size`，必须和 MinIO 文件规范化后的文本一致。
- 不在任何响应中返回 token、Authorization header、私钥或完整堆栈。
