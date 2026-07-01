# Hub State 服务端接口说明

本文只整理本次 `suncode hub state` / `<hub-state>` 需要 Hub 服务端提供或确认的接口。

登录接口已复用现有 `POST /api/auth/login`，不在本文展开。除登录接口外，下面接口统一使用：

```text
{apiBaseUrl}/api/v1
```

认证头：

```http
Authorization: Bearer <token>
Accept: application/json
```

`token` 来自 `suncode hub login` 写入的本地登录态。CLI 不再读取 `SUNCODE_HUB_TOKEN`。

## 1. 服务健康接口

用于 `suncode hub state` 判断 Hub 服务是否可用，并获取服务基础信息。

```http
GET /api/v1/health
Authorization: Bearer <token>
Accept: application/json
```

### 成功响应

最小可用响应：

```json
{
  "status": "ok"
}
```

推荐响应：

```json
{
  "status": "ok",
  "name": "Suncode Hub",
  "version": "1.2.3",
  "time": "2026-07-01T12:00:00Z"
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `status` | string | 否 | 服务状态；缺省时 CLI 视为 `ok`。 |
| `name` | string | 否 | 服务名称，会写入项目级 `.suncode/.runtime/hub-state.json`。 |
| `version` | string | 否 | 服务版本，会写入项目级 state cache。 |
| `time` | string | 否 | 服务端时间；当前 CLI 不强依赖。 |

### CLI 行为

- 只有 Hub 已启用、`apiBaseUrl` 已解析、且当前 `apiBaseUrl` 已登录时，CLI 才会请求该接口。
- 如果该接口返回非 2xx 或请求失败，`suncode hub state` 会报告：

```text
service: unavailable
work: skipped
```

- hook 本身不会请求该接口，只读取 `suncode hub state` 写入的本地缓存。

## 2. 可接需求查询接口

用于 `suncode hub state` 判断当前项目是否存在可接需求或待选任务；也复用现有 `suncode hub pull` 的需求列表能力。

```http
GET /api/v1/projects/{projectId}/requirements?developerId={developerId}&status=ready,in_review,changes_requested
Authorization: Bearer <token>
Accept: application/json
```

### 路径参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectId` | string | 是 | 当前项目绑定的 Hub 项目 ID，来自 `.suncode/config.yaml` 的 `hub.projectId`。 |

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `developerId` | string | 是 | 当前开发者 ID。若项目配置未显式指定，来自登录响应 `user.id` 的字符串形式。 |
| `status` | string | 是 | CLI 固定传 `ready,in_review,changes_requested`，逗号分隔。 |

### 成功响应

CLI 支持三种返回结构，服务端任选一种即可。

结构 A：直接返回数组。

```json
[
  {
    "id": "REQ-1001",
    "title": "登录流程优化",
    "status": "ready"
  }
]
```

结构 B：返回 `requirements` 字段。

```json
{
  "requirements": [
    {
      "id": "REQ-1001",
      "title": "登录流程优化",
      "status": "ready"
    }
  ]
}
```

结构 C：返回 `items` 或 `data` 字段。

```json
{
  "items": [
    {
      "requirementId": "REQ-1001",
      "title": "登录流程优化",
      "status": "ready"
    }
  ]
}
```

### 需求条目字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 推荐 | 需求 ID；优先使用。 |
| `requirementId` | string | 可选 | 当 `id` 不存在时，CLI 使用该字段作为需求 ID。 |
| `title` | string | 可选 | 需求标题，用于 `hub state` / `<hub-state>` 摘要展示。 |
| `status` | string | 可选 | 需求状态，用于摘要展示。 |

### CLI 行为

- CLI 在健康接口成功后才请求该接口。
- CLI 只把数量和前 5 条需求摘要写入 `.suncode/.runtime/hub-state.json`，不缓存完整需求内容。
- 当返回条目数量大于 0 时：

```text
work: available
```

- 当返回条目数量等于 0 时：

```text
work: none
```

- 如果该接口失败，当前实现会把本次 `hub state` 视为 Hub 服务不可用，并提示 AI 不要进入 Hub 专用流程。

## 3. 通用错误响应建议

Hub API 返回非 2xx 时，建议使用统一错误结构：

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Login required",
    "details": {}
  }
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `error.code` | string | 否 | 机器可读错误码。 |
| `error.message` | string | 推荐 | CLI 会优先展示该消息。 |
| `error.details` | object | 否 | 附加信息；不要包含 token、密码、Authorization header 或其它敏感内容。 |

## 4. 不需要服务端接口的部分

| 功能 | 是否请求服务端 | 说明 |
| --- | --- | --- |
| `suncode hub init` | 否 | 只写用户级 Hub config 和项目级 `.suncode/config.yaml`。 |
| `suncode hub logout` | 否 | 只删除当前 `apiBaseUrl` 对应的本地登录态。 |
| `<hub-state>` hook | 间接 | hook 不直接请求服务端；Hub 关闭、配置缺失、未登录或登录过期时只读本地状态。配置和登录态完整时，hook 短超时调用本地 `suncode hub state --json`，由 CLI 统一访问服务端并刷新项目级 state。调用失败、超时或返回无效 JSON 时，hook 直接判断 Hub 当前不可用，不使用旧缓存显示可用。 |
