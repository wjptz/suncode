# Hub 引导配置、登录和状态识别技术设计

## 总体方案

这次改动把 Hub 能力拆成三层状态：

- 全局 Hub 配置和登录态：用户级，保存默认 `apiBaseUrl`，并按 `apiBaseUrl` 保存登录 session。
- 项目 Hub 配置：项目级，保存 `projectId`、是否启用 Hub、同步策略，以及可选 `apiBaseUrl` 覆盖。
- 项目 Hub state：项目级，保存当前项目视角下的配置、登录、服务、待选需求和当前任务是否 Hub-bound。

核心约束：

- Hub 关闭时零网络请求。
- token 不进入 `.suncode/config.yaml`，也不进入项目 `.suncode/.runtime/hub-state.json`。
- 登录态按 Hub 服务地址绑定；多个项目指向同一个 `apiBaseUrl` 时复用登录态。
- `hub state` 和 `<hub-state>` 必须明确区分“项目启用了 Hub”和“当前活动任务是 Hub task”。普通本地任务不能被 AI 误提交到 Hub。
- hook 每轮运行必须快速、可失败、不可泄密；hook 不直接实现网络访问，而是短超时调用本地 CLI 的 `suncode hub state --json` 获取权威状态。
- hook 刷新 `hub state` 失败、超时或返回无效 JSON 时，必须 fail-closed：报告 Hub 当前不可用，不得读取旧缓存并显示 Hub 可用。
- 任务目录名和 `task.json.id` 仍然是稳定 ASCII slug；面向人和 Hub 展示的任务名使用 `task.json.title` / `task.json.name` 的中文标题。
- 任务/spec 相关文档默认以简体中文为第一语言；技术标识符、协议字段、命令名和外部原文不翻译。

## 配置和状态边界

### 全局配置

建议路径：

```text
~/.suncode/hub/config.json
```

结构：

```json
{
  "version": 1,
  "defaultApiBaseUrl": "https://hub.example.test"
}
```

`defaultApiBaseUrl` 是用户全局默认 Hub 服务地址。`suncode hub init` 可以写入或更新它。

### 全局登录态

建议路径：

```text
~/.suncode/hub/auth.json
```

结构：

```json
{
  "version": 1,
  "sessions": {
    "https://hub.example.test": {
      "developerId": "dev_456",
      "displayName": "kangmeng",
      "token": "jwt",
      "expiresAt": "2026-07-08T12:00:00Z",
      "loggedInAt": "2026-07-01T12:00:00Z"
    }
  }
}
```

登录态按规范化后的 `apiBaseUrl` 绑定。写入时尽量使用 `0600` 文件权限。命令输出、项目 state 和 hook 输出都不得包含 token。

### 任务显示名和语言策略

`task.py create` 写入：

- `task.json.id`：ASCII slug，用于目录、脚本参数和稳定标识。
- `task.json.name`：优先写入用户输入的中文标题。
- `task.json.title`：同样写入用户输入的中文标题。

`hub create-task` 提交给 Hub 时：

- `localTaskId` 使用本地 slug。
- `localTaskName` 优先使用 `task.title`，其次 `task.name`，最后回退到 `localTaskId`。
- `title` 使用同一中文展示标题。

workflow 模板和新建 PRD 默认提示 AI 使用简体中文编写任务文档、需求、设计、实施计划和 spec 更新。

### 项目配置

`.suncode/config.yaml` 继续保存项目级 Hub 信息：

```yaml
hub:
  enabled: true
  mode: team
  projectId: proj_123
  # 可选；为空时使用全局 defaultApiBaseUrl
  apiBaseUrl: null
  developerId: null
  startReviewPolicy: confirm
```

解析顺序：

1. 读取项目 `hub.enabled`、`projectId`、可选 `apiBaseUrl`。
2. `apiBaseUrl` 优先使用项目配置；为空时使用全局 `defaultApiBaseUrl`。
3. 用最终 `apiBaseUrl` 到全局 `auth.json.sessions` 里查登录态。
4. 用项目 `projectId` 执行项目级 state 和需求查询。

### 项目状态缓存

`.suncode/.runtime/hub-state.json` 是当前项目视角的缓存：

```json
{
  "version": 1,
  "refreshedAt": "2026-07-01T12:00:00Z",
  "project": {
    "projectId": "proj_123",
    "apiBaseUrl": "https://hub.example.test",
    "apiBaseUrlSource": "global"
  },
  "summary": {
    "hub": "on",
    "config": "ok",
    "login": "ok",
    "service": "ok",
    "work": "available",
    "currentTask": "local-only"
  },
  "message": "Hub 可用，有 3 个可接需求；当前任务未绑定 Hub。",
  "nextAction": "当前任务是普通本地任务，不要执行 Hub 任务提交命令；如要接 Hub 任务，运行 `suncode hub pull`。",
  "service": {
    "name": "Suncode Hub",
    "version": "1.2.3"
  },
  "work": {
    "availableCount": 3,
    "items": [
      { "id": "REQ-1001", "title": "登录流程优化", "status": "ready" }
    ]
  },
  "currentTask": {
    "state": "local-only",
    "taskId": "07-01-personal-refactor",
    "reason": "task.json has no meta.hub.requirementId or remoteTaskId"
  }
}
```

项目 state 只存无敏感信息。错误信息必须脱敏：不得包含 token、密码、Authorization header、signed URL、MinIO secret 或完整堆栈。

## 命令设计

### `suncode hub init`

交互模式询问：

- `apiBaseUrl`：默认写入全局 `defaultApiBaseUrl`。
- 是否把 `apiBaseUrl` 固定到当前项目：默认否；只有多 Hub 服务场景才写项目级覆盖。
- `projectId`：写入当前项目 `.suncode/config.yaml`。
- `developerId`：可选；默认取登录响应或 `.suncode/.developer`，不强制写入项目配置。
- `startReviewPolicy`：默认 `confirm`。
- 是否启用默认 sync hooks：默认沿用现有模板中的 `afterCreate=true`、`afterStart=true`、`afterFinish=false`、`afterArchive=true`。

非交互 flags：

```bash
suncode hub init \
  --api-base-url https://hub.example.test \
  --project-id proj_123 \
  --developer-id dev_456 \
  --start-review-policy confirm \
  --yes
```

可选：

```bash
suncode hub init --project-api-base-url https://team-hub.example.test
```

写入策略：

- 全局 `defaultApiBaseUrl` 写入 `~/.suncode/hub/config.json`。
- 项目级 `hub:` 块只写 `enabled`、`mode`、`projectId`、可选 `apiBaseUrl` 覆盖、`developerId`、`startReviewPolicy` 和 sync 配置。
- 如果 `.suncode/config.yaml` 已有活动 `hub:` 块，则只替换该块。
- 如果不存在活动 `hub:` 块，则追加一个新的 `hub:` 块。
- 其他配置保持原样。
- 不写 token、密码、MinIO key 或任何 secret。

### `suncode hub login`

登录接口：

```http
POST /api/auth/login
Content-Type: application/json
```

请求体复用 Hub 既有登录接口：

```json
{
  "email": "admin@example.com",
  "password": "admin123"
}
```

响应体复用 Hub 既有登录接口：

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

- `--api-base-url` 可指定登录的 Hub 服务；未指定时用项目覆盖地址或全局默认地址。
- `--email` / `--password` 存在时走非交互登录；`--username` 保留为邮箱兼容别名。
- 缺少字段时交互询问；密码输入必须尽量隐藏回显。
- 登录成功后写入全局 `~/.suncode/hub/auth.json` 的对应 `sessions[apiBaseUrl]`。
- 输出只显示登录用户、developerId、Hub 地址、过期时间，不显示 token。
- CLI 将 `user.id` 转成字符串作为本地登录态 `developerId`，将 `user.display_name` 作为展示名；若 token 是 JWT 且 payload 含 `exp`，解析为本地 `expiresAt`。

Hub 鉴权只认全局登录态。即使环境中存在旧的 `SUNCODE_HUB_TOKEN`，Hub 命令也不读取它；未登录时统一提示用户运行 `suncode hub login`。

### `suncode hub logout`

`logout` 删除指定 `apiBaseUrl` 对应的全局登录态，不修改项目级 `.suncode/config.yaml`，也不删除项目 state。

默认解析当前项目使用的 `apiBaseUrl`；也支持 `--api-base-url` 指定要退出的 Hub 服务。

`logout` 后，在解析到同一个 `apiBaseUrl` 的项目里，`hub state` 都应报告未登录。

### `suncode hub state`

`state` 是新的权威状态命令，默认输出适合人读的文本，并支持 `--json` 输出结构化结果。

判断顺序：

1. 读取项目 Hub 配置；Hub 关闭或未配置时直接返回 `hub off`，不访问网络。
2. 解析 `apiBaseUrl`：项目覆盖优先，否则使用全局默认。
3. 读取全局登录态中该 `apiBaseUrl` 对应的 session。
4. 如果登录态缺失或 token 已过期，返回未登录或过期，不访问网络。
5. 读取当前活动任务，判断是否存在 `meta.hub.requirementId` 或 `remoteTaskId`。
6. 调用 `GET /api/v1/health` 获取服务信息。
7. 服务可用后，调用现有需求列表接口获取当前 developer 的可接需求。
8. 把无敏感字段的结果写入当前项目 `.suncode/.runtime/hub-state.json`。

服务信息接口：

```http
GET /api/v1/health
Authorization: Bearer <token>
```

响应字段保持宽松解析，至少支持：

```json
{
  "status": "ok",
  "version": "1.2.3",
  "name": "Suncode Hub",
  "time": "2026-07-01T12:00:00Z"
}
```

需求接口继续复用现有约定：

```http
GET /api/v1/projects/{projectId}/requirements?developerId={developerId}&status=ready,in_review,changes_requested
```

`state` 不把完整需求内容塞进 hook 缓存；只缓存数量、前几个 ID / 标题 / 状态，以及推荐动作。

## 当前任务 Hub-bound 判断

当前任务状态分四类：

- `none`：没有活动任务。
- `hub-bound`：`task.json.meta.hub.remoteTaskId` 存在，或有有效 `requirementId` / `bindingStatus`。
- `hub-pending`：有 `meta.hub.requirementId`，但尚未绑定远端 task。
- `local-only`：存在活动任务，但没有 `meta.hub` 绑定信息。

`local-only` 必须在 `<hub-state>` 中显式提示：

```xml
<hub-state>
Hub: on
Project: proj_123
Login: ok
Current task: local-only
AI: 当前任务未绑定 Hub；不要运行 submit-plan、submit-completion、mark-started 等 Hub 任务命令，除非用户明确要求绑定 Hub 需求。
</hub-state>
```

Hub 任务类命令也应继续守住边界：目标 task 没有 Hub metadata 或没有 remote binding 时，只能跳过或提示，不得上传普通本地任务内容。

## Hook 设计

共享 Python hook 和 OpenCode JS plugin 都要追加 `<hub-state>`。

Hook 原则：

- 不直接实现 Hub API 网络访问；启用且本地配置/登录态完整时，短超时调用 `suncode hub state --json`，由 CLI 统一执行状态聚合和缓存写入。
- 不调用登录接口。
- 不打印 token。
- 读取全局 Hub 配置、全局登录态摘要和项目配置；Hub 关闭、配置缺失、未登录或登录过期时不触发 CLI 网络探测路径。
- `suncode hub state --json` 调用失败、超时或返回无效 JSON 时，`<hub-state>` 输出 `Service: unavailable`，并提示 AI 不要进入 Hub 专用流程。
- 当前任务是 `local-only` 时，显式提示不要走 Hub 任务流程。

输出示例：

```xml
<hub-state>
Hub: off
Reason: hub.enabled is not true
AI: use the local Suncode workflow; do not run Hub-specific commands.
</hub-state>
```

```xml
<hub-state>
Hub: on
Project: proj_123
Login: missing for https://hub.example.test
AI: ask the user to run `suncode hub login` before using Hub workflows.
</hub-state>
```

```xml
<hub-state>
Hub: on
Project: proj_123
Service: ok
Work: 3 available requirements
Current task: none
AI: ask the user whether to pull/select Hub work with `suncode hub pull`.
</hub-state>
```

为了控制 token 成本，hook 输出只保留少量行；完整详情由 `suncode hub state --json` 提供。

## 兼容性

- `suncode hub status` 继续保留。实现上可以让它调用轻量版 `hub state`，但输出仍保持短文本。
- 现有命令不再支持 `SUNCODE_HUB_TOKEN`；这是 Hub 鉴权模型的显式变更。
- `.suncode/config.yaml` 中现有注释需要从“使用 `SUNCODE_HUB_TOKEN`”更新为“使用 `suncode hub login`；`apiBaseUrl` 默认来自全局配置”。
- `suncode-hub-requirements` / `suncode-hub-finish` skill 文案需要更新，避免继续要求用户提供 `SUNCODE_HUB_TOKEN`，并提醒普通本地任务不得执行 Hub 任务提交流程。

## 风险和取舍

- 不使用系统 keychain：跨平台实现简单、可测试，但安全性弱于 OS keychain。通过用户目录、`0600` 和不提交文件降低风险。
- hook 调用 CLI 实时刷新：相比纯读缓存更准确，但可能遇到 CLI 缺失、远端慢或网络异常；通过短超时和 fail-closed 的 `Service: unavailable` 控制风险，避免 AI 被旧缓存误导。
- 全局默认 `apiBaseUrl` 简化多项目使用；项目级 override 处理多 Hub 服务或测试环境。
- `GET /api/v1/health` 是新增 Hub API 契约；如果后端暂未实现，`state` 会报告服务检查失败。后端可先返回最小 `{ "status": "ok" }`。

## 回滚

如果实现后需要回滚：

- 删除新增全局 Hub config/auth 模块和 CLI 子命令注册。
- 恢复 hook 中 `<hub-state>` 注入改动。
- 如需恢复旧行为，再单独回滚 `SUNCODE_HUB_TOKEN` 鉴权路径；默认交付不保留该路径。
