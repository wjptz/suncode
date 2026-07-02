# Hub skill package pull and push

## Goal

为 Suncode Hub 增加无需 AI 参与的技能包同步命令：

- `suncode hub skill-pull <skill-name>`
- `suncode hub skill-push <skill-name>`

用户可以把本地 Suncode 技能目录中的同名技能包上传到 Hub，或从 Hub 拉取同名技能包覆盖到本地技能目录。

## Confirmed Facts

- 接口文档来自仓库根目录 `skill-package-api(1).md`。
- 技能包是一个目录，根目录必须包含 `SKILL.md`，可包含任意子目录和文件。
- 上传按文件逐个执行三步：`presign-upload` -> MinIO `PUT` -> `finalize-upload`。
- 同一个 `skill_name` 下同名 `relative_path` 在 Hub finalize 时覆盖更新。
- 拉取可通过项目技能包列表、技能包详情、文件内容流式接口完成。
- 现有 Hub CLI 位于 `packages/cli/src/commands/hub/**`。
- 现有 Hub 鉴权通过 `suncode hub login` 写入 `~/.suncode/hub/auth.json`，命令应复用 `resolveHubConfig(..., requireAuth: true)` 与登录 token，不应使用环境变量 token。
- 现有 Hub 命令在 `packages/cli/src/commands/hub/index.ts` 注册，并通过 `HubCommandResult` 或 JSON 输出做用户反馈。
- 默认本地技能根目录已确认使用 `.agents/skills/<skill-name>/`。
- 技能包接口文档的 Base URL 是 `/api/agent-hub`，不同于现有 Hub task/spec API 使用的 `/api/v1`。
- 现有项目配置字段名是 `hub.projectId`；技能包 API 文档使用 `project_key`。本任务默认把 `hub.projectId` 作为 `project_key` 传给技能包 API。

## Requirements

- 新增 `suncode hub skill-push <skill-name>`：
  - 从本地 `.agents/skills/<skill-name>/` 读取技能包。
  - 如果本地目录不存在，或缺少 `SKILL.md`，抛出面向用户的错误。
  - 递归收集普通文件，跳过目录；路径统一使用 POSIX `/`。
  - 对每个文件调用接口文档中的 presign、MinIO PUT、finalize。
  - 同名 Hub 技能包按接口幂等/覆盖语义更新。
  - 默认使用项目级 scope。
- 新增 `suncode hub skill-pull <skill-name>`：
  - 从 Hub 查询当前项目可用技能包，找到同名包。
  - 获取详情中的文件列表，逐个下载文件内容。
  - 写入本地 `.agents/skills/<skill-name>/`，同名文件覆盖。
  - 防止非法相对路径写出技能目录。
- 复用现有 Hub 配置、登录、错误处理、测试风格。
- 不增加原生依赖。
- 代码改动保持在 Hub CLI 与对应测试范围内。

## Acceptance Criteria

- [x] `suncode hub skill-push <skill-name>` 会把本地技能包目录内所有文件上传到 Hub，并输出上传文件数量。
- [x] `suncode hub skill-pull <skill-name>` 会把 Hub 上同名技能包下载到 `.agents/skills/<skill-name>`，同名文件覆盖。
- [x] 未登录、Hub 未启用、项目配置缺失时，行为与现有 Hub 命令一致。
- [x] 本地技能目录缺失、缺少 `SKILL.md`、Hub 找不到同名技能包、Hub 返回多义/非法文件路径时有清晰错误。
- [x] 单元测试覆盖 push 的 presign/PUT/finalize 请求顺序与 payload。
- [x] 单元测试覆盖 pull 的列表、详情、文件下载、覆盖写入与路径逃逸防护。
- [x] `pnpm --filter @wjptz/suncode typecheck` 通过。
- [x] 相关 Hub 测试通过。

## Out of Scope

- 不做 AI 自动执行或自动选择技能。
- 不实现技能包删除。
- 不实现批量同步所有技能包。
- 不改变现有 `suncode hub init/login/state/pull-spec/review` 语义。
- 不引入新的平台技能安装流程。
