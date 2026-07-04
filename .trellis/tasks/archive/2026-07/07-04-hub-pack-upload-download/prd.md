# Hub skill 与 agent pack 上传下载接口

## Goal

按照 `skill-package-api.md` 的 v2 文件传输协议更新现有 Hub skill 上传/下载实现，并新增 agent pack 的上传/下载命令与最小实现，让本地 `.agents/skills` 下的 skill 资源包和 `.suncode/agents` 下的默认 agent markdown 能通过 Hub 后端托管文件接口同步。

## Confirmed Facts

- 现有 skill 上传实现位于 `packages/cli/src/commands/hub/skills.ts:75`，已经支持遍历 `.agents/skills/<skill-name>` 并逐文件执行 prepare、PUT、finalize。
- 现有 skill finalize 仍回传 `object_key`，而 `skill-package-api.md:215` 到 `skill-package-api.md:218` 要求 finalize 必填 `upload_session_id`、`upload_id`、`file_ref`，`object_key` 仅为兼容字段且服务端不信任。
- 现有 skill 下载实现位于 `packages/cli/src/commands/hub/skills.ts:133`，通过项目列表、包详情和单文件正文接口写入 `.agents/skills/<skill-name>`；v2 下载端点应使用 `GET /files/skill-package-files/:id/download`。
- 现有 CLI 只注册了 `skill-push` 与 `skill-pull`，位置是 `packages/cli/src/commands/hub/index.ts:598` 到 `packages/cli/src/commands/hub/index.ts:621`。
- `agent-pack-api.md` 与 skill 包协议基本同构：上传使用 `/agent-packs/presign-upload`、`PUT /uploads/:uploadSessionId/files/:uploadId`、`/agent-packs/finalize-upload`，字段名从 `skill_name` 换成 `agent_name`，下载使用 `/projects/:key/agent-packs`、`/agent-packs/:id`、`/files/agent-pack-files/:id/download`。

## Requirements

- 更新 skill 上传协议：
  - presign 响应模型接受 `upload_session_id`、`upload_id`、`file_ref`。
  - PUT 上传仍使用 presign 返回的 `upload_url`、`method`、`headers`。
  - finalize 请求必须提交 `scope`、`project_key`、`skill_name`、`file_path`、`upload_session_id`、`upload_id`、`file_ref`。
  - 不再要求或主动回传裸 `object_key`。
- 新增 agent pack 上传：
  - 命令形态与 skill 保持一致，新增 `suncode hub agent-push <agent-name>`。
  - 默认本地路径使用 `.suncode/agents/<agent-name>.md`。
  - 上传到 Hub 时使用当前 API 主流程的单文件形态，包内 `file_path` 为 `AGENT.md`。
  - 兼容读取 `.suncode/agents/<agent-name>/AGENT.md` 作为本地 fallback，但默认下载仍写回 `.suncode/agents/<agent-name>.md`。
  - 每个文件大小限制沿用 1 到 50 MiB。
  - 请求字段使用 `agent_name`。
- 新增 agent pack 下载：
  - 命令形态与 skill 保持一致，新增 `suncode hub agent-pull <agent-name>`。
  - 从 Hub 查询项目可见 agent pack，优先选择同名项目级包，回退唯一同名包；歧义时报错。
  - 下载单个 markdown 文件写入 `.suncode/agents/<agent-name>.md`，并拒绝绝对路径、反斜杠、空片段、`.`、`..`、目录路径和非 markdown 文件名。
- 代码应尽量复用 skill 上传/下载路径中的通用逻辑，避免复制出第二套分叉协议实现。
- 更新或新增 Vitest 覆盖：
  - skill finalize 使用 v2 upload refs。
  - agent-push 的 prepare、PUT、finalize 顺序和请求体。
  - agent-push 缺少 `.suncode/agents/<agent-name>.md` 的错误。
  - agent-pull 下载写入本地默认 agent markdown。
  - agent-pull 拒绝越界路径。

## Acceptance Criteria

- [x] `hub skill-push` 对 v2 presign 响应不依赖 `object_key`，finalize 请求包含 `upload_session_id`、`upload_id`、`file_ref`。
- [x] `hub agent-push <agent-name>` 可上传 `.suncode/agents/<agent-name>.md`，本地缺少默认 agent markdown 时失败。
- [x] `hub agent-pull <agent-name>` 可下载 Hub agent pack 的单个 markdown 文件到 `.suncode/agents/<agent-name>.md` 并覆盖同名文件。
- [x] agent pack 下载路径安全校验与 skill 下载同等级，不允许写出目标 agent 目录。
- [x] `registerHubCommand` 注册 `agent-push` 与 `agent-pull`。
- [x] 相关 `hub.test.ts` 测试通过。
- [x] CLI 类型检查通过。

## Out Of Scope

- 不新增全局 scope 参数、绑定管理、删除接口、下载 attachment endpoint 选项或交互式选择。
- 不实现知识库文件上传下载。
- 不改 Hub 后端 API。
