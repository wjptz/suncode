# Design

## Architecture

本任务把 Hub spec 同步拆成三层：

1. CLI 同步层：`suncode hub pull-spec` 和 `suncode hub spec-deletions ...` 负责所有网络请求、hash 对账、文件写入、删除候选保存和 manifest 更新。
2. 状态展示层：`suncode hub state --json` 展示 Hub 配置、登录、服务、当前任务和待选需求；`<hub-state>` 作为 `<workflow-state>` 的附加层，只展示 Hub 短状态码、当前任务绑定、待选需求和精简 `Flow add-on:` / `Do not:` 提示，不展示 spec 摘要。
3. AI 调度层：`suncode-hub-spec-sync` skill 只负责在 Hub 任务进入规划/实现前调用 CLI；不做逐文件 diff、合并、删除或覆盖。

## Hub API Contract

新增项目级全量 spec bundle 接口：

```http
GET /api/v1/projects/{projectId}/specs/bundle
Authorization: Bearer <token>
If-None-Match: "<optional etag>"
```

推荐响应：

```json
{
  "revision": "spec-rev-42",
  "etag": "\"sha256:bundle\"",
  "bundleHash": "sha256:bundle",
  "basePath": ".suncode/spec",
  "files": [
    {
      "path": "cli/backend/index.md",
      "sha256": "sha256:file",
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
  "deleted": ["old/path.md"]
}
```

`304 Not Modified` 可作为优化；MVP 可以先接受 200 全量响应。

## Local Files

权威 spec 路径仍是：

```text
.suncode/spec/**
```

同步状态 manifest：

```text
.suncode/.runtime/hub-specs.json
```

示例：

```json
{
  "version": 1,
  "projectId": "proj_123",
  "apiBaseUrl": "https://hub.example.test",
  "policy": "remote_wins",
  "revision": "spec-rev-42",
  "etag": "\"sha256:bundle\"",
  "bundleHash": "sha256:bundle",
  "syncedAt": "2026-07-01T12:00:00.000Z",
  "files": {
    ".suncode/spec/cli/backend/index.md": {
      "sha256": "sha256:file",
      "managedBy": "hub"
    }
  }
}
```

删除候选目录：

```text
.suncode/.runtime/hub-spec-deletions/<revision>/
  manifest.json
  <previous spec relative path>
```

删除候选 manifest：

```json
{
  "version": 1,
  "revision": "spec-rev-42",
  "deletedAt": "2026-07-01T12:00:00.000Z",
  "items": [
    {
      "id": "del_001",
      "previousPath": ".suncode/spec/cli/backend/old-rule.md",
      "backupPath": ".suncode/.runtime/hub-spec-deletions/spec-rev-42/cli/backend/old-rule.md",
      "previousSha256": "sha256:old",
      "reason": "remote deleted this Hub-managed spec",
      "status": "pending"
    }
  ]
}
```

## Sync Algorithm

固定输入：

```text
remoteFiles = Hub 返回的全量 spec 文件集合
previousFiles = hub-specs.json 记录的上次 Hub-managed 文件集合
localFiles = 当前 .suncode/spec/** 文件集合
```

固定分类：

```text
added = remoteFiles - localFiles
updated = remoteFiles 中本地 sha256 != remote sha256 的文件
deleted = previousFiles - remoteFiles
localOnly = localFiles - previousFiles - remoteFiles
unchanged = remoteFiles 中本地 sha256 == remote sha256 的文件
```

执行策略：

| 分类 | 行为 |
| --- | --- |
| added | 写入远端内容 |
| updated | 远端覆盖本地 |
| deleted | 先保存删除候选，再删除权威路径 |
| localOnly | 只报告，不阻塞，不删除 |
| unchanged | 跳过 |

所有 apply 操作应先计算 plan，再写临时目录或临时文件，最后尽量原子替换目标文件和 manifest。任何校验失败都不得写半成品 manifest。

## Validation / Security

CLI 必须验证：

- `path` 必须是相对路径，不能包含 `..`，不能越过 `.suncode/spec/`。
- 文件必须是 UTF-8 文本。
- 文件数量和单文件大小需要有上限。
- `download.url` 必须是可 GET 的短期 MinIO signed URL。
- MinIO 下载文本规范化后的 sha256 必须等于响应中的 sha256。
- `bundleHash` 应由规范化文件列表计算或校验。
- state/cache/manifest 中不得写入 token、password、Authorization header、signed URL、私钥或完整堆栈。

## CLI Output

`suncode hub pull-spec --json` 成功示例：

```json
{
  "status": "updated",
  "policy": "remote_wins",
  "revision": "spec-rev-42",
  "bundleHash": "sha256:bundle",
  "actions": {
    "added": [".suncode/spec/backend/index.md"],
    "updated": [".suncode/spec/frontend/components.md"],
    "deleted": [".suncode/spec/old.md"],
    "unchanged": 12
  },
  "localOnly": [".suncode/spec/local/debugging.md"],
  "deletionCandidates": [
    {
      "id": "del_001",
      "previousPath": ".suncode/spec/old.md",
      "backupPath": ".suncode/.runtime/hub-spec-deletions/spec-rev-42/old.md"
    }
  ],
  "message": "Hub specs synced. Remote spec is authoritative."
}
```

失败示例：

```json
{
  "status": "unavailable",
  "reason": "Hub spec bundle validation failed"
}
```

## `hub state` / `<hub-state>`

`HubStateResult` 不包含 spec 同步摘要。spec 的 revision、local-only、deletion candidate 等信息只出现在 `suncode hub pull-spec --json`、`.suncode/.runtime/hub-specs.json` 和 `spec-deletions` 命令结果中。

`<hub-state>` 需要贴合 `<workflow-state>`，避免像另一套独立流程。示例：

```text
hub:ok
workflow:primary
hub-task:hub-bound
work:none
Flow add-on: follow workflow-state; Hub lifecycle commands are allowed for this Hub task.
```

## Skills

新增 `suncode-hub-spec-sync`：

- 触发：Hub 任务接取、绑定、规划、恢复、用户要求刷新 Hub spec。
- 流程：读取 `<hub-state>`，确认 Hub 可用，运行 `suncode hub pull-spec --json`，成功后继续，失败后停止 Hub 任务流程。
- 禁止：AI 逐文件 diff、合并、删除、恢复 Hub-managed spec。

可选新增 `suncode-hub-spec-deletion-review`：

- 触发：用户要求复盘被 Hub 删除的 spec 内容。
- 行为：读取 deletion candidates，判断是否值得保留为 local-only 补充。
- 文件操作：通过 `suncode hub spec-deletions keep/discard` 执行。

## Compatibility

- `submit-spec` 保持上传语义不变；可复用 hash/artifact helper，但不改变用户命令行为。
- local-only spec 默认不阻塞 Hub 任务；如果用户显式要求，AI 可以后续复盘。
- 远端删除的旧内容保存到 `.suncode/.runtime/**`，属于运行时恢复材料，不作为权威 spec 自动读取。

## Rollback

- 若 `pull-spec` 写入错误，可用 `.suncode/.runtime/hub-spec-deletions/**` 和 VCS 恢复删除内容。
- manifest 写入应在文件 apply 成功后进行；失败时不要更新 revision，避免把半同步状态标成成功。
- 删除候选保留命令只写 `.suncode/spec/local/**`，不会污染 Hub-managed 路径。
