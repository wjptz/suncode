# 增加 Hub 引导配置、登录和状态识别

## 目标

让 Suncode Hub 更容易被开发者和 AI Agent 正确使用，新增：

- `suncode hub init`：引导式设置启用 Hub 所需的项目配置。
- `suncode hub login` / `suncode hub logout`：管理本机 Hub 登录态。
- `suncode hub state`：用一个命令汇总 Hub 配置、登录、服务和待处理工作的状态。
- 每轮 hook 注入 `<hub-state>...</hub-state>`，让 AI Agent 第一时间识别 Hub 是否关闭、未配置、未登录、服务不可用，或是否有可接任务。

这项功能的核心价值是降低 Hub 初始化门槛，并避免 AI 在 Hub 不可用时盲目进入 Hub 专用流程。

## 已确认事实

- Hub 命令在 `packages/cli/src/commands/hub/index.ts` 注册。
- 当前 Hub 配置由 `packages/cli/src/commands/hub/config.ts` 从 `.suncode/config.yaml` 读取。
- Hub 是可选能力；当 `.suncode/config.yaml` 不存在，或 `hub.enabled` 不为 `true` 时，当前逻辑视为 Hub 关闭。
- 当前既有鉴权依赖 `SUNCODE_HUB_TOKEN`；本任务要移除该环境变量鉴权路径，改为只使用 `suncode hub login` 写入的本地登录态。
- 当前 `suncode hub status` 只报告 Hub 配置是否启用，不检查登录态、远端服务健康状态或待处理需求。
- 现有 Hub 命令通过 `createHubApiClient` 调用 `{apiBaseUrl}/api/v1` 下的接口。
- 现有需求拉取接口是 `GET /projects/{projectId}/requirements?developerId=...&status=ready,in_review,changes_requested`。
- 现有 Hub 任务通过 `task.json` 的 `meta.hub.requirementId` / `remoteTaskId` / `bindingStatus` 等字段识别；普通本地任务没有这些字段时，`hub create-task` 会跳过并提示 ordinary local task。
- 现有 workflow-state hook 已经通过共享 Python hook 和 OpenCode JS plugin 注入 `<workflow-state>...</workflow-state>`。
- 每轮 hook 必须跨平台、快速、尽力而为，并且适合在每个用户输入回合运行。
- 密钥、token、密码、API key 等敏感内容不得打印、提交，也不得写入 `.suncode/config.yaml`。

## 需求

- R1. `suncode hub init` 必须引导用户填写启用 Hub 所需的最小信息：全局默认 `apiBaseUrl`、项目级 `projectId`、可选项目级 `apiBaseUrl` 覆盖、可选 `developerId`，以及现有同步和评审策略默认值。
- R2. `suncode hub init` 必须支持通过 flags 非交互运行，方便测试和自动化。
- R3. `suncode hub login` 在缺少 flags 时必须提示输入邮箱和密码，使用解析出的 `apiBaseUrl` 调用 Hub 登录接口，并且只在用户全局目录按 `apiBaseUrl` 持久化 token / session 元数据。
- R4. `suncode hub logout` 必须删除指定 `apiBaseUrl` 对应的全局 Hub 登录态，但不能删除项目级 Hub 配置或项目级 state。
- R5. `suncode hub state` 必须汇总以下状态：
  - 全局配置状态：是否存在默认 `apiBaseUrl`。
  - 项目/配置状态：关闭、未配置、已配置、配置无效、项目是否覆盖 `apiBaseUrl`。
  - 登录状态：当前 `apiBaseUrl` 是否已登录；如果可检测，也要识别过期或无效。
  - 服务状态：可访问、不可访问/异常；当配置或登录缺失时跳过服务探测。
  - 任务/需求状态：服务探测成功时，报告是否存在可接需求或待选任务。
  - 当前任务状态：没有活动任务、活动任务是 Hub task、活动任务是普通本地任务。
- R6. 每轮 hook 必须在 `<workflow-state>` 之外追加 `<hub-state>`，内容保持紧凑，且不得暴露任何凭据。
- R7. `<hub-state>` 必须能指导 AI 行为：
  - 没有配置或 Hub 关闭：提示使用本地普通 Suncode 工作流。
  - 配置缺失或无效：提示需要先配置 Hub。
  - 未登录：提示用户运行 `suncode hub login`。
  - 服务不可用：提示当前 Hub 不可用，不进入 Hub 专用流程。
  - 有可接需求：提示用户接任务或运行 Hub 拉取流程。
  - 当前活动任务不是 Hub task：显式提示不要运行 `submit-plan`、`submit-completion`、`mark-started` 等 Hub 任务命令，除非用户明确要求把该任务绑定到 Hub 需求。
- R8. Hub 鉴权必须只使用 `suncode hub login` 写入的本地登录态；不再读取或要求 `SUNCODE_HUB_TOKEN`。
- R9. 对于 Hub 关闭的本地项目，命令和 hook 都不得访问 Hub 网络服务。
- R10. 测试必须覆盖全局配置读写、项目配置读写、登录/登出状态、按 `apiBaseUrl` 匹配登录态、项目级 state 分类、当前任务 Hub-bound/local-only 判断和 hook 注入。

## 已确认产品决策

- D1. `suncode hub login` 使用以下登录接口契约：

```http
POST /api/auth/login
Content-Type: application/json
```

请求体：

```json
{
  "email": "admin@example.com",
  "password": "..."
}
```

响应体：

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

CLI 会把 `user.id` 转成字符串作为本地登录态的 `developerId`，把 `user.display_name` 作为展示名；若 JWT 中存在 `exp`，会解析成 `expiresAt` 供 `hub state` 判断过期。

- D2. `SUNCODE_HUB_TOKEN` 不再作为鉴权来源；所有 Hub 命令、状态检查和 hook 状态判断都只依据本地登录态。
- D3. `apiBaseUrl` 是用户全局默认属性，存放在用户全局 Hub 配置中；项目级 `.suncode/config.yaml` 主要绑定 `projectId`，并允许可选覆盖 `apiBaseUrl`。
- D4. 本地登录态是用户全局状态，按 `apiBaseUrl` 绑定；不同项目如果解析到同一个 Hub 服务地址，可以复用同一份登录态。
- D5. `suncode hub state` 是项目级状态，写入当前项目的 `.suncode/.runtime/hub-state.json`，因为它依赖当前项目的 `projectId`、当前任务和待选需求。
- D6. 当前活动任务不是 Hub task 时，hook 必须明确提醒 AI 不要走 Hub 任务命令，防止个人任务误提交到 Hub。
- D7. Hub 任务绑定时，本地任务目录名和 `task.json.id` 继续使用 ASCII slug；`task.json.name` / `title` 使用面向人的中文标题，提交到 Hub 的 `localTaskName` / `title` 也优先使用中文标题。
- D8. 新建任务文档、规划文档和 spec 更新默认以简体中文作为第一语言；代码标识符、API 字段、命令、错误原文和外部引用术语保留原文。
- D9. 对已启用且已配置登录态的 Hub 项目，hook 每轮通过短超时调用 `suncode hub state --json` 获取实时状态；调用失败、超时或返回非 JSON 时必须判断 Hub 当前不可用，不能读取旧缓存并把 Hub 显示为可用。

## 验收标准

- [ ] `suncode hub init` 只写入或更新 `.suncode/config.yaml` 的 Hub 配置部分，并保留无关配置。
- [ ] `suncode hub init` 能写入用户全局默认 `apiBaseUrl`，并允许项目级 `apiBaseUrl` 覆盖。
- [ ] `suncode hub login` 支持交互和非交互两种方式，不回显密码，不打印 token，并且不把认证信息写入 `.suncode/config.yaml` 或项目 `.runtime`。
- [ ] `suncode hub logout` 删除当前 `apiBaseUrl` 对应的全局认证状态后，`suncode hub state` 能报告未登录。
- [ ] `suncode hub state` 在 Hub 关闭时成功退出，报告 `hub off`，且不发起网络请求。
- [ ] `suncode hub state` 能区分全局 base URL 缺失、项目配置缺失、未登录、服务异常、存在可接需求、当前任务是 Hub task、当前任务是普通本地任务。
- [ ] 即使设置了 `SUNCODE_HUB_TOKEN`，Hub 命令也不把它作为鉴权来源；未登录时必须提示运行 `suncode hub login`。
- [ ] 共享 Python hook 在普通 JSON envelope 平台和 Kiro bare-text 输出中都包含 `<hub-state>`。
- [ ] OpenCode plugin 输出中包含 `<hub-state>`。
- [ ] 启用且已登录的 Hub 项目中，hook 会实时调用 `suncode hub state --json`；刷新失败、超时或返回无效 JSON 时，`<hub-state>` 报告 `Service: unavailable`，不使用旧缓存兜底为可用。
- [ ] 当前活动任务是普通本地任务时，`<hub-state>` 明确提示不要执行 Hub 任务提交/状态同步命令。
- [ ] Hub 任务绑定 payload 的 `localTaskName` / `title` 使用中文任务标题，而不是目录 slug。
- [ ] 新建任务的 `task.json.name` / `title` 使用中文标题，`task.json.id` 继续使用 slug。
- [ ] 新建任务默认 PRD、任务创建提示和 workflow 语言策略明确要求任务/spec 文档优先使用简体中文。
- [ ] hook 输出不泄露凭据，且长度有明确上限。
- [ ] Hub 命令逻辑和 hook 注入的定向测试通过。

## 说明

- 这是复杂任务；进入实现前必须补齐 `design.md` 和 `implement.md`。
- 后续规划文档统一使用中文编写。
- 项目说明提到 GitNexus 工具要求，但本会话当前没有可用的 GitNexus MCP 工具入口。
