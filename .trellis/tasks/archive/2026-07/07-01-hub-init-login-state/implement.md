# Hub 引导配置、登录和状态识别实施计划

## 前置检查

1. 进入实现前读取相关规范：
   - `.trellis/spec/cli/backend/suncode-hub-collaboration.md`
   - `.trellis/spec/cli/backend/workflow-state-contract.md`
   - `.trellis/spec/guides/cross-platform-thinking-guide.md`
   - `.trellis/spec/guides/code-reuse-thinking-guide.md`
   - `.trellis/spec/cli/unit-test/conventions.md`
2. 按项目 GitNexus 要求，修改具体函数/类前先尝试运行对应 symbol 的 impact analysis；如果本会话仍没有 GitNexus MCP 工具，需要在执行记录中说明工具不可用，并用源码调用点检索替代。
3. 确认工作树只包含当前任务规划文件或当前任务相关代码。

## 实施步骤

### 1. Hub 配置和登录态基础能力

1. 新增全局 Hub 配置工具：
   - 定义用户级 `~/.suncode/hub/config.json`
   - 读取/写入 `defaultApiBaseUrl`
   - 规范化 `apiBaseUrl`，保证 auth session key 稳定
2. 新增或扩展项目 Hub 配置写入工具：
   - 读取 `.suncode/config.yaml`
   - 定位活动 `hub:` 块
   - 替换或追加 Hub 配置
   - 保留无关配置和注释
   - 项目配置保存 `projectId`，`apiBaseUrl` 默认不写，只有覆盖全局默认时写入
3. 新增全局 Hub auth 模块：
   - 定义用户级 `~/.suncode/hub/auth.json` 路径
   - 按 `apiBaseUrl` 读取、写入、删除登录态
   - 解析过期时间
   - 对输出错误做脱敏
4. 扩展 `resolveHubConfig` 或新增统一 auth resolver：
   - 移除 `SUNCODE_HUB_TOKEN` 鉴权读取
   - 解析项目 `apiBaseUrl` 覆盖或全局默认 `apiBaseUrl`
   - 只读取当前 `apiBaseUrl` 对应的全局 auth session
   - `requireAuth` 语义改为要求全局登录态存在且未过期

### 2. CLI 子命令

1. 在 `packages/cli/src/commands/hub/index.ts` 注册：
   - `hub init`
   - `hub login`
   - `hub logout`
   - `hub state`
2. `hub init` 支持交互和 flags：
   - `--api-base-url`
   - `--project-api-base-url`
   - `--project-id`
   - `--developer-id`
   - `--start-review-policy`
   - `--yes`
3. `hub login` 支持交互和 flags：
   - `--api-base-url`
   - `--email`
   - `--username` 兼容别名
   - `--password`
   - 不打印密码和 token
4. `hub logout` 删除当前 `apiBaseUrl` 对应的全局登录态，并支持 `--api-base-url`。
5. `hub state` 支持：
   - 默认文本输出
   - `--json`
   - `--no-network` 或等价内部模式，便于 hook/local-only 检查

### 3. Hub state 聚合和缓存

1. 实现状态分类：
   - `hub off`
   - `global apiBaseUrl missing`
   - `config missing`
   - `config invalid`
   - `login missing`
   - `login expired`
   - `service unavailable`
   - `service ok + no work`
   - `service ok + work available`
   - `current task none`
   - `current task hub-bound`
   - `current task hub-pending`
   - `current task local-only`
2. 实现 `GET /api/v1/health` 调用。
3. 复用现有 requirements 拉取接口获取待选任务/需求数量。
4. 读取当前 session active task，并根据 `task.json.meta.hub` 判断当前任务是否 Hub-bound。
5. 写入项目级 `.suncode/.runtime/hub-state.json`：
   - 不包含 token
   - 不包含密码
   - 不包含 Authorization header
   - 不包含 MinIO signed URL 或 secret
   - 包含 `projectId`、解析后的 `apiBaseUrl`、`apiBaseUrlSource` 和当前任务 Hub 状态
6. 保证 Hub 关闭、配置缺失、缺少全局 base URL、未登录、token 过期时不访问网络。

### 4. Hook 注入 `<hub-state>`

1. 修改 `packages/cli/src/templates/shared-hooks/inject-workflow-state.py`：
   - 读取全局 config/auth 摘要和项目 config，先处理 Hub off / 配置缺失 / 未登录 / 登录过期等本地状态
   - 对配置和登录态完整的 Hub 项目，短超时调用 `suncode hub state --json` 获取实时状态
   - 调用失败、超时或返回无效 JSON 时输出 `Service: unavailable`，不得用旧 cache 显示 Hub 可用
   - 生成紧凑 `<hub-state>`
   - JSON envelope 平台追加到 `additionalContext`
   - Kiro bare-text 输出也包含 `<hub-state>`
   - 当前任务为 `local-only` 时明确提示不要执行 Hub 任务命令
2. 修改 `packages/cli/src/templates/opencode/plugins/inject-workflow-state.js`：
   - 使用同样的实时 CLI 刷新和 fail-closed 规则
   - 注入 `<hub-state>`
3. 保持 hook 不直接实现 Hub API 调用、不长时间阻塞、不泄露凭据。

### 5. 模板和文案更新

1. 更新 `packages/cli/src/templates/suncode/config.yaml` Hub 注释：
   - 移除 `SUNCODE_HUB_TOKEN` 鉴权说明
   - 说明必须使用 `suncode hub login`
   - 说明 `apiBaseUrl` 默认来自全局配置，项目配置只在需要覆盖时填写
   - 明确不要把 token 写入 config
2. 更新 Hub 相关 bundled skills：
   - `suncode-hub-requirements`
   - `suncode-hub-finish`
   - 明确普通本地任务不得执行 Hub 任务提交/状态同步命令
3. 更新任务创建模板和 workflow：
   - `task.py create` 写入 `task.json.name = <中文标题>`，`id` 继续保持 slug。
   - 默认 `prd.md` 使用中文标题、中文小节和简体中文优先说明。
   - `workflow.md` 和 marketplace workflow 写明任务/spec 文档默认使用简体中文。
4. 如测试覆盖要求，更新 docs-site 或 README 中涉及 Hub 登录/状态的文案。

### 6. 测试

1. `packages/cli/test/commands/hub.test.ts`
   - `hub init` 写入全局 `defaultApiBaseUrl`
   - `hub init` 替换/追加项目 Hub 配置且保留无关配置
   - 项目级 `apiBaseUrl` 覆盖优先于全局默认
   - `hub login` 调用既有 `POST /api/auth/login`
   - 请求体为 `{ email, password }`，响应从 `{ token, user }` 中解析登录态
   - 登录态按 `apiBaseUrl` 写入用户级 auth
   - `logout` 删除指定 `apiBaseUrl` 的登录态
   - 即使设置了 `SUNCODE_HUB_TOKEN`，也不会作为鉴权来源
   - `state` 在 Hub off / 缺少全局 base URL / 未登录 / 服务异常 / 有需求时分类正确
   - `state` 能识别当前任务 none / hub-bound / hub-pending / local-only
   - Hub off、缺少 base URL、未登录时不触发 fetch
   - `hub create-task` 提交的 `localTaskName` / `title` 优先使用中文任务标题
2. `packages/cli/test/regression.test.ts`
   - 共享 Python hook 输出 `<hub-state>`
   - `<hub-state>` 不包含 token
   - Hub off / 未登录 / live work available / local-only task 四种 hook 文案正确
   - 启用且登录态完整时，Python hook 调用 `suncode hub state --json`；失败和超时按 `Service: unavailable`
3. `packages/cli/test/templates/opencode.test.ts`
   - OpenCode plugin 注入 `<hub-state>`
   - OpenCode plugin 调用 `suncode hub state --json`；失败按 `Service: unavailable`
   - 不影响现有 `<workflow-state>` 注入
4. 需要时更新 template/configurator 断言，适配 Hub 注释改为只使用 `suncode hub login`。
5. `packages/cli/test/scripts/task-create-hub.integration.test.ts`
   - 新建中文标题任务时，`task.json.name` / `title` 使用中文标题，`id` 保持 slug
   - 默认 PRD 包含中文小节和简体中文优先说明

## 验证命令

优先运行定向验证：

```bash
pnpm --filter @wjptz/suncode test -- test/commands/hub.test.ts
pnpm --filter @wjptz/suncode test -- test/templates/opencode.test.ts
pnpm --filter @wjptz/suncode test -- test/regression.test.ts
```

最后运行 CLI 包级检查：

```bash
pnpm --filter @wjptz/suncode typecheck
pnpm --filter @wjptz/suncode lint
pnpm --filter @wjptz/suncode build
```

如果改动影响 core 包或根级契约，再补：

```bash
pnpm test
```

## 回滚点

- 完成配置/auth 模块后先跑 `hub.test.ts` 的配置和 auth 子集。
- 完成 hook 注入后先跑 regression/opencode 定向测试。
- 如果 hook 输出引起平台兼容问题，先回滚 hook 注入，保留 CLI 的 `init/login/logout/state`。
- 如果登录态持久化出现安全问题，暂停 Hub 登录态功能并回到“未登录则不可用”的安全失败模式；不要重新引入环境变量 token 作为隐式 fallback。

## 进入实现前检查

- [ ] 用户已 review 并批准 `prd.md`、`design.md`、`implement.md`。
- [ ] `task.py start` 尚未执行前，不修改功能代码。
- [ ] inline 模式下无需维护 `implement.jsonl` / `check.jsonl`。
