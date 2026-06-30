# Suncode Hub 团队协作实现计划

## 当前状态

- MVP CLI、隐式 Hub hooks、Hub 元数据 task 创建、MinIO 上传/下载 helper、两个 Hub skill、中文接口文档和核心测试已实现。
- `prd.md` / `design.md` / `implement.md` / `research/**` / 完成总结只按当前 task 目录收集，不扫描 sibling task。
- `spec` 按项目级 `.suncode/spec/**` 收集，状态写入 `.suncode/hub-spec-manifest.json`；当前 task 只作为 Hub 关联上下文。
- 仍未实现的优化：基于 git diff 缩小 spec 候选集；当前实现是扫描 `.suncode/spec/**` 后按 hash 幂等跳过未变化文件。

## 阶段 1：规划与接口合同

- [x] 完成中文 `prd.md`。
- [x] 完成中文 `design.md`。
- [x] 完成中文 `hub-api.md`，列出 Hub 后端需要实现的接口，明确文档正文走 MinIO，Hub API 不传正文。
- [x] 用户确认规划方向和接口边界。

## 阶段 2：配置与状态结构

- [x] 在 Suncode 生成模板的 `.suncode/config.yaml` 中增加 `hub` 配置块，默认关闭。
- [x] 设计并实现 Hub 配置读取 helper。
- [x] 实现 Hub disabled guard：
  - disabled 时 exit 0 / skipped。
  - enabled 但配置缺失时 exit 1。
- [x] 扩展 task 创建流程，支持预写 `task.json.meta.hub`：
  - `projectId`
  - `developerId`
  - `requirementId`
  - `requirementRevision`
  - `taskRole`
  - `parentLocalTaskId`
  - `parentRemoteTaskId`
  - `bindingStatus`
- [x] 支持一个 Hub requirement 拆成本地 parent/child task：
  - `single` task 直接绑定 requirement。
  - `parent` task 作为 requirement 主绑定 task。
  - `child` task 继承 parent 的 Hub 元数据并上报 `parentRemoteTaskId`。
  - parent 尚未绑定时 child 标记为 `pending_parent`，后续补跑同步。
- [x] 明确普通本地 task 没有 Hub 元数据时的跳过行为。
- [x] 明确 `.suncode/config.yaml` 第一版不保存 MinIO endpoint、bucket、access key 或 secret key；文档上传/下载使用 Hub 签发的预签名 URL。

## 阶段 3：Hub 命令骨架

- [x] 新增 `suncode hub status`。
- [x] 新增 `suncode hub pull`。
- [x] 新增 `suncode hub download-document`。
- [x] 新增 `suncode hub create-task`。
- [x] 新增 `suncode hub submit-plan`。
- [x] 新增 `suncode hub pull-review`。
- [x] 新增 `suncode hub sync`。
- [x] 新增 `suncode hub preflight-start`。
- [x] 新增 `suncode hub mark-started`。
- [x] 新增 `suncode hub submit-spec`。
- [x] 新增 `suncode hub submit-completion`。

## 阶段 4：Hub HTTP client 与 MinIO 传输

- [x] 实现统一 API client：
  - base URL 读取
  - 从 `SUNCODE_HUB_TOKEN` 环境变量读取 JWT 并注入 `Authorization: Bearer <jwt>`
  - JSON 请求/响应
  - timeout
  - 错误响应解析
  - `Idempotency-Key` 头
- [x] 实现 MinIO 预签名 URL 传输 helper：
  - 使用 Hub 返回的 `uploadUrl` 执行 PUT。
  - 使用 Hub 返回的 `downloadUrl` 执行 GET。
  - 上传/下载后按 SHA-256 校验。
  - 预签名 URL 不写入 manifest 或普通日志。
- [x] 实现 artifact upload session client：
  - `POST /artifact-upload-sessions`
  - 按 bundle hash 幂等。
  - 支持 URL 过期后重新申请。
- [x] 实现 document download URL client：
  - `GET /documents/{documentId}/download-url`
  - 下载到当前 task 的 Hub 来源资料目录；任务尚未创建时可下载到 `.suncode/hub-inbox/`。
- [x] 保证日志不输出 JWT。
- [x] 区分配置错误、认证错误、网络错误、MinIO 传输错误、业务冲突。

## 阶段 5：Artifact manifest 与 hash

- [x] 新增 `hub-manifest.json` 读写 helper。
- [x] 实现文本 hash：
  - CRLF -> LF
  - SHA-256
  - POSIX 路径 key
- [x] 实现规划工件收集：
  - `prd.md`
  - `design.md`
  - `implement.md`
  - 可选 `research/**`
- [ ] 实现 spec 候选文件收集优化：
  - git diff 工作区
  - git diff staged
  - git diff base branch
- [x] 当前 MVP 收集项目级 `.suncode/spec/**`，并通过 hash 跳过未变化文件。
- [x] 成功上传后更新 `lastSubmittedSha256` 和远端 revision。
- [x] manifest 记录稳定对象引用：
  - `storage`
  - `objectKey`
  - `objectVersionId`
  - `remoteArtifactId`
  - `remoteRevision`
- [x] manifest 不记录预签名 URL。

## 阶段 6：生命周期 hook 接入

- [x] 团队 Hub 项目启用后配置：

```yaml
hooks:
  after_create:
    - "suncode hub create-task --task-json \"$TASK_JSON_PATH\""
  after_start:
    - "suncode hub mark-started --task-json \"$TASK_JSON_PATH\""
  after_archive:
    - "suncode hub submit-completion --task-json \"$TASK_JSON_PATH\" --best-effort"
```

- [x] 明确 `after_finish` 不代表任务完成，不默认用于最终 completion。
- [x] hook 命令必须在 Hub disabled 时快速跳过。

## 阶段 7：MVP Hub skills 与 workflow 引导

- [x] 新增内置 skill `suncode-hub-requirements`：
  - 检查 Hub enabled 和 `SUNCODE_HUB_TOKEN`。
  - 调用 `suncode hub pull`。
  - 识别需求载荷是 `text` 还是 `document`；文档型需求先下载 MinIO 文档。
  - 引导 AI 选择需求并创建本地 task。
  - 检查或补跑 `suncode hub create-task`。
- [x] 新增内置 skill `suncode-hub-finish`：
  - 生成或校验 `implementation-summary.md`。
  - 生成或校验 `validation-summary.md`。
  - 生成或校验 `retrospective.md`。
  - 生成或校验 `reuse-assessment.md`。
  - 调用 `suncode hub submit-spec`。
  - 调用 `suncode hub submit-completion`。
- [ ] `suncode-hub-planning`、`suncode-hub-sync`、`suncode-hub-start` 暂作为后续可选 skill，不列为第一版必须交付。
- [ ] 在 planning breadcrumb / brainstorm skill 中提示：
  - Hub enabled 且 binding 未完成时先补 `suncode hub create-task`。
  - 规划完成后调用 `suncode hub submit-plan`。
  - 开发前调用 `suncode hub preflight-start`。
  - 如果审核未通过或未完成，AI 必须向用户二次确认；确认后执行 `suncode hub preflight-start --confirm-unapproved-review`，再 `task.py start`。
- [ ] 在 in-progress breadcrumb / finish-work skill 中提示：
  - 有需求变更时调用 `suncode hub sync`。
  - 文档型需求变更先下载 MinIO 文档，再由 AI 修改规划或代码。
  - 结束前调用 `suncode hub submit-spec`。
  - 归档/完成前调用 `suncode hub submit-completion`。
- [ ] Hub disabled 时不显示团队协作流程负担。

## 阶段 8：测试

- [ ] Hub disabled：
  - 所有 Hub 命令不联网。
  - hook 调用时 exit 0 / skipped。
- [ ] Hub config validation：
  - 缺 `projectId` 报错。
  - 缺 `apiBaseUrl` 报错。
  - Hub enabled 但缺 `SUNCODE_HUB_TOKEN` 报错。
- [ ] `create-task` 幂等：
  - 已有 `remoteTaskId` 不重复创建。
  - 重复 idempotency key 返回一致结果。
  - child task 使用包含 `parentRemoteTaskId` 的幂等键。
  - parent 未绑定时 child task 不创建远端脏数据。
- [ ] `submit-plan`：
  - 只上传 hash 变化文件。
  - 先创建 upload session，再通过 MinIO PUT 上传正文，最后向 Hub API 提交对象引用。
  - Hub API payload 不包含文档正文。
  - 只上传目标 task 目录下的规划工件，不能扫描 sibling task。
  - 无变化时 no-op。
- [ ] 文档下载：
  - `text` 需求/变更不触发 MinIO 下载。
  - `document` 需求/变更通过下载 URL 拉取正文。
  - 下载后 hash 不匹配必须失败。
  - 下载得到的 Hub 来源资料默认不被 `submit-plan` 当作规划 artifact 上传。
- [ ] `preflight-start`：
  - requirement revision 落后时失败。
  - review 未 approved 且策略为 `confirm` 时，未带确认标记应返回需要二次确认。
  - review 未 approved 且策略为 `confirm` 时，带 `--confirm-unapproved-review` 后应通过并同步 override。
  - review 未 approved 且策略为 `block` 时失败。
- [ ] `submit-spec`：
  - 只处理项目级 `.suncode/spec/**` 变更候选。
  - spec 不归属单个 task；当前 task 只作为本次 Hub submission 的关联上下文。
  - spec hash 状态写入项目级 `.suncode/hub-spec-manifest.json`。
  - 不扫描或上传 `.suncode/tasks/**` 下其他 task 的 PRD、design、implement、summary 文档。
  - hash 未变不上传。
  - spec 正文通过 MinIO 上传，Hub API 只接收对象引用。
- [ ] `submit-completion`：
  - 只上传目标 task 目录下的总结/评估文档。
  - 总结正文通过 MinIO 上传，Hub API 只接收对象引用。
  - 默认不包含 child task；只有显式 `--include-children` 且归属校验通过才包含 child 摘要。
- [ ] hook 集成：
  - `after_create` 调用命令。
  - `after_start` 调用命令。
  - disabled 时 hook 不制造错误。
- [ ] skill 集成：
  - `suncode-hub-requirements` 能从 pull 到创建 task 串起流程。
  - `suncode-hub-finish` 不上传空白总结或不相关 task 文档。

## 阶段 9：验证命令

实现完成后至少运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

如果只改 CLI 局部逻辑，优先先跑定向 Vitest，再跑全量验证。

## 风险与回滚点

| 风险 | 处理 |
| --- | --- |
| Hub hook 失败但本地 task 已创建 | `bindingStatus=failed`，后续可补跑 `suncode hub create-task` |
| Hub disabled 项目被误联网 | Hub guard 必须在命令入口第一步执行 |
| 重复上传产生脏数据 | 所有写入请求强制幂等键 |
| MinIO 上传成功但 submission 失败 | 保留 upload session 和对象 hash，补跑 submission，不重复上传未变化对象 |
| 预签名 URL 泄露 | URL 不进 manifest、不进普通日志，错误输出脱敏 |
| Hub API 误传文档正文 | API client 和测试禁止 artifact payload 出现正文内容字段 |
| spec 全量 hash 性能差 | git diff 找候选，再 hash |
| `after_finish` 被误解为完成 | 文档和 workflow 明确完成以显式 completion / archive 为准 |
| JWT 泄露 | JWT 只来自 `SUNCODE_HUB_TOKEN` 环境变量，日志脱敏 |
| 上传不相关 task 文档 | 所有上传命令必须先解析目标 task，并限制 artifact scope |

## 暂不实现

- Hub 后端服务。
- 双向实时推送或 websocket。
- 文件 watcher。
- 业务二进制附件上传。
- Trellis 到 Suncode Hub 的历史数据迁移。
