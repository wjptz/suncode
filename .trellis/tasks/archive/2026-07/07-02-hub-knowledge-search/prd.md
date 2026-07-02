# Hub knowledge search

## Goal

为 Suncode Hub 增加知识库检索命令，让 AI 在不确定词汇概念、接口契约、页面契约时，可以通过 CLI 查询当前项目在 Hub 中维护的知识库。

目标命令：

```text
suncode hub knowledge <query...>
```

## User Value

- AI 可以在实现、排查或理解需求前先检索团队知识库，减少凭命名猜测接口/页面契约。
- 用户不需要手工打开 Hub 页面查概念，CLI 可以直接返回结构化检索结果。
- 该能力与现有 Hub 登录、项目配置、鉴权边界一致，不额外引入 token 来源。

## Confirmed Facts

- 接口文档来自仓库根目录 `kb-api(1).md`。
- `kb-api(1).md` 的 Base URL 是 `{apiBaseUrl}/api/agent-hub`。
- 文档中 `:key` 指 `project_key`，当前项目可使用现有 Hub 配置里的 `hub.projectId` 作为 `project_key`。
- 用户描述的核心场景是：AI 不知道某些词汇概念，或不确定接口/页面契约时，调用知识库检索。
- 最小匹配接口是 `POST /projects/:key/knowledge/vector-search`，请求体包含 `query` 与可选 `top_k`。
- 现有 Hub 登录态来自 `suncode hub login` 写入的全局 auth session，不使用 `SUNCODE_HUB_TOKEN`。
- 现有 `packages/cli/src/commands/hub/skills.ts` 已有 `/api/agent-hub` 专用请求逻辑，但当前是私有 helper。
- 现有 `createHubApiClient()` 固定走 `/api/v1`，不能直接用于 `/api/agent-hub` 知识库接口。

## Requirements

- 新增 `suncode hub knowledge <query...>`：
  - 使用当前项目 Hub 配置解析 `apiBaseUrl`、`projectId` 和登录 token。
  - 调用 `POST /api/agent-hub/projects/{projectId}/knowledge/vector-search`。
  - 请求体发送 `{ query, top_k }`，其中 `top_k` 默认 `5`。
  - 支持 `--top-k <n>`，校验范围 `1..20`。
  - 查询词为空时抛出清晰错误。
  - 默认输出结构化 JSON，保留 Hub 返回的 `artifacts`、`count`，并补充本次 `projectKey`、`query`、`topK`，便于 AI 读取。
- 复用现有 Hub 配置、登录和错误处理习惯：
  - Hub 未启用时返回 disabled 风格结果。
  - 未登录、登录过期、服务错误时沿用现有 Hub 命令的用户可读错误。
  - 不输出或持久化 token、Authorization header。
- 抽取或复用 `/api/agent-hub` 请求 helper，避免在 knowledge 与 skill package 中复制协议代码。
- 不实现 AI 自动判断何时调用；本任务只提供确定性的 CLI 检索能力。

## Acceptance Criteria

- [x] `suncode hub knowledge 登录接口字段` 会向 `/api/agent-hub/projects/{projectId}/knowledge/vector-search` 发送 `POST` 请求。
- [x] 默认 `top_k` 为 `5`，`--top-k` 可以设置 `1..20`，越界或非整数会报错。
- [x] 输出 JSON 包含 `projectKey`、`query`、`topK`、`count`、`artifacts`。
- [x] Hub 请求使用 `suncode hub login` 的 token，并忽略 `SUNCODE_HUB_TOKEN`。
- [x] Hub disabled 时不访问网络。
- [x] 查询为空时不访问网络，并抛出清晰错误。
- [x] 单元测试覆盖请求 URL、method、Authorization、body、默认 `top_k`、自定义 `top_k`、空查询、越界 `top_k`。
- [x] `pnpm --filter @wjptz/suncode typecheck` 通过。
- [x] 相关 Hub 命令测试通过。

## Out of Scope

- 不实现 `/knowledge/embed`。
- 不实现 `/knowledge/qa` SSE 问答。
- 不实现 `/knowledge/qa/config`、`/knowledge/vector-status`、`/knowledge/qa/index` 的 CLI 子命令。
- 不自动触发索引重建。
- 不新增 MCP 工具，不修改 AI 自动调度逻辑。
- 不提交或删除用户提供的 `kb-api(1).md` 文档。
