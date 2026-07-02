# Hub knowledge search design

## Overview

新增一个 Hub knowledge search 模块，提供项目级知识库语义检索。该功能面向 AI 和脚本使用，默认输出结构化 JSON，不进入 task workflow，不创建或修改 Trellis/Suncode 任务状态。

## Command Surface

```text
suncode hub knowledge <query...> [--top-k <n>]
```

默认值：

- `project_key = resolveHubConfig(...).projectId`
- `top_k = 5`
- `top_k` 有效范围 `1..20`
- 输出 JSON，便于 AI 直接解析

## API Boundary

知识库接口位于 `/api/agent-hub`，不能走现有 `/api/v1` 的 `createHubApiClient()`。

本任务优先把 `skills.ts` 中的 agent-hub 请求逻辑抽成共享模块，例如：

```text
packages/cli/src/commands/hub/agent-hub-client.ts
```

共享模块提供：

- `requestAgentHubJson<T>()`
- `requestAgentHubRaw()`
- 统一 30s timeout
- 统一 Authorization header
- 统一 `HubHttpError` 解析
- 可复用错误前缀或 `serviceName`，避免知识库错误仍显示 skill package 字样

## Data Flow

1. CLI 收集 `<query...>` 参数并拼接成单个查询字符串。
2. 解析 `--top-k`，校验是整数且范围 `1..20`。
3. `hubKnowledgeSearch()` 调用 `resolveHubConfig({ requireAuth: true })`。
4. Hub disabled 则返回 disabled 结构，不访问网络。
5. 校验 query 非空。
6. `POST /api/agent-hub/projects/{projectId}/knowledge/vector-search`：

```json
{
  "query": "登录接口字段",
  "top_k": 5
}
```

7. 返回结构化结果：

```json
{
  "projectKey": "proj_123",
  "query": "登录接口字段",
  "topK": 5,
  "count": 1,
  "artifacts": [
    {
      "artifact": {
        "id": 12,
        "title": "登录接口",
        "side": "backend",
        "module": "auth",
        "endpoint_path": "POST /api/auth/login",
        "tags": ["登录", "鉴权"]
      },
      "score": 0.9125,
      "snippet": "..."
    }
  ]
}
```

## Compatibility

- 保持现有 Hub 命令的 auth 和 disabled 行为。
- 不改 `createHubApiClient()`，避免影响 `/api/v1` 的 task/spec/review 流程。
- `skills.ts` 改为导入共享 agent-hub helper 后，skill package 行为和测试应保持不变。
- 不新增依赖。
- 不缓存知识库结果，避免陈旧契约被当作事实。

## Errors and Safety

- 空 query：本地抛错，不访问 Hub。
- `top_k` 非整数或不在 `1..20`：本地抛错，不访问 Hub。
- Hub 4xx/5xx：冒泡为 `HubHttpError`，显示服务返回的错误消息。
- 请求超时：返回明确的 agent-hub API timeout 错误。
- 不记录 token、Authorization header 或完整响应中的敏感字段。

## Tests

在 `packages/cli/test/commands/hub.test.ts` 追加 command-level function tests：

- 注册层包含 `knowledge`。
- 默认 `top_k = 5` 的 vector-search 请求。
- 自定义 `--top-k` 传入请求体。
- 空查询本地报错且 fetch 未调用。
- 非法 `top_k` 本地报错且 fetch 未调用。
- Hub disabled 时不访问网络。

测试沿用现有模式：真实临时目录 + 真实 Hub config/auth 文件，只 mock `fetch`。
