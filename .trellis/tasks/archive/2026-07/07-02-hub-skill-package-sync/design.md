# Hub skill package pull and push design

## Overview

新增一个 Hub skill package 同步模块，负责把本地 `.agents/skills/<skill-name>/` 作为一个技能包上传到 Hub，或把 Hub 上的同名技能包下载并覆盖到本地同一路径。

该功能不进入 AI workflow，不读取或修改 task 状态，也不触发现有 plan/spec/review/completion 提交流程。它只复用 Hub 的项目配置、登录态和命令错误处理。

## Command Surface

```text
suncode hub skill-push <skill-name>
suncode hub skill-pull <skill-name>
```

默认约定：

- `scope = "project"`
- `project_key = resolveHubConfig(...).projectId`
- 本地技能根目录为 `<cwd>/.agents/skills`
- 技能包目录为 `<cwd>/.agents/skills/<skill-name>`

## API Boundary

现有 `createHubApiClient()` 固定拼接 `/api/v1`，而技能包文档的 Base URL 是 `/api/agent-hub`。因此新增技能包专用请求 helper，不改变现有 Hub client 行为。

技能包 JSON API：

- `POST {apiBaseUrl}/api/agent-hub/skill-packages/presign-upload`
- `POST {apiBaseUrl}/api/agent-hub/skill-packages/finalize-upload`
- `GET {apiBaseUrl}/api/agent-hub/projects/{project_key}/skill-packages`
- `GET {apiBaseUrl}/api/agent-hub/skill-packages/{id}`
- `GET {apiBaseUrl}/api/agent-hub/skill-package-files/{fileId}/content`

MinIO 上传使用 presign 响应中的 `upload_url` 和 `headers` 直接 `PUT`，不带 Hub Authorization。

## Push Flow

1. 解析 Hub 配置与登录态。
2. 校验 `<cwd>/.agents/skills/<skill-name>/` 存在且是目录。
3. 校验根目录存在 `SKILL.md`。
4. 递归收集普通文件，生成 POSIX `relative_path`。
5. 对每个文件：
   - 读取文件大小和 MIME 类型。
   - `POST /skill-packages/presign-upload`。
   - `PUT upload_url` 上传原始文件 bytes。
   - `POST /skill-packages/finalize-upload`。
6. 返回 `submitted`，消息包含上传文件数量。

## Pull Flow

1. 解析 Hub 配置与登录态。
2. `GET /projects/{project_key}/skill-packages`，按 `name === skillName` 找包。
3. 找不到时报错。
4. 若列表返回多个同名包，优先 `scope === "project"` 且 `project_key === projectKey`；仍多义则报错。
5. `GET /skill-packages/{id}` 获取文件列表。
6. 对每个文件：
   - 校验 `relative_path` 不是绝对路径，不包含 `..`，不为空。
   - `GET /skill-package-files/{fileId}/content` 下载 bytes。
   - 写入 `<cwd>/.agents/skills/<skill-name>/<relative_path>`。
7. 返回 `downloaded`，消息包含下载文件数量。

## Safety and Compatibility

- 不删除本地目录里 Hub 没有返回的额外文件；本次只要求同名覆盖，不做 remote-wins 删除同步。
- 文件内容按二进制 Buffer 传输，避免破坏图片、压缩包等非文本资产。
- 持久化和 API 中的相对路径统一使用 POSIX `/`。
- filesystem 写入使用 `path.join`，并用 `path.resolve` 校验目标仍在技能包目录内。
- 不把 token、presigned URL 或 Authorization header 写入项目 cache、manifest 或日志。
- 不添加依赖，MIME 类型使用内置扩展名映射，未知类型用 `application/octet-stream`。

## Test Strategy

- 在 `packages/cli/test/commands/hub.test.ts` 增加函数级测试。
- 使用真实临时目录和真实 fs，不 mock 内部模块。
- 只 mock `fetch`，覆盖 Hub JSON API 与 MinIO PUT。
- 测试 push 请求顺序、payload、Content-Type、文件数量和 `SKILL.md` 校验。
- 测试 pull 的列表/详情/内容下载、文件覆盖、路径逃逸拒绝。

