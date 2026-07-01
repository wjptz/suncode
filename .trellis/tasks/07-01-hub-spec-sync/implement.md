# Implement Plan

## 1. 更新规格文档

- 在 `.trellis/spec/cli/backend/suncode-hub-collaboration.md` 新增 `Hub Spec Pull` 场景。
- 写清楚：
  - `suncode hub pull-spec --json`
  - `suncode hub spec-deletions list/keep/discard`
  - `remote_wins` 策略
  - AI 不参与常规 spec diff/merge
  - deletion candidates 不阻塞任务
  - local-only spec 不阻塞任务
  - 失败/超时/校验失败 fail closed

## 2. 新增 CLI 同步实现

- 新增 `packages/cli/src/commands/hub/specs.ts`。
- 实现：
  - `pullHubSpecs(options)`
  - `listSpecDeletions(options)`
  - `keepSpecDeletion(options)`
  - `discardSpecDeletion(options)`
- 复用：
  - `resolveHubConfig`
  - `createHubApiClient`
  - `hash.ts`
  - 现有 Hub command result / error handling patterns
- 新增必要类型到 `types.ts`。

## 3. 注册命令

- 在 `packages/cli/src/commands/hub/index.ts` 注册：
  - `pull-spec`
  - `spec-deletions list`
  - `spec-deletions keep`
  - `spec-deletions discard`
- `pull-spec --json` 输出机器可读结果。
- 普通输出使用简体中文摘要，不打印敏感信息。

## 4. 更新 Hub state 与 hook

- `packages/cli/src/commands/hub/state.ts` 保持 Hub 可用性聚合职责，只返回配置、登录、服务、当前任务和待选需求状态，不读取或输出 spec 摘要。
- 更新 `packages/cli/src/templates/shared-hooks/inject-workflow-state.py` 的 `<hub-state>` 格式化逻辑：输出 `workflow:primary`、`hub-task:*` 和 `Flow add-on:`，让 Hub 状态成为 `<workflow-state>` 的补充。
- 同步检查 OpenCode plugin 对应实现，如果它有独立 `<hub-state>` 逻辑，也要保持一致。
- spec 同步摘要只由 `suncode hub pull-spec --json`、`.suncode/.runtime/hub-specs.json` 和 `spec-deletions` 命令承载。

## 5. 新增 bundled skills

- 新增 `packages/cli/src/templates/common/bundled-skills/suncode-hub-spec-sync/SKILL.md`。
- 可选新增 `suncode-hub-spec-deletion-review/SKILL.md`；如果范围过大，可先把删除复盘规则写入 `suncode-hub-spec-sync` 的参考段落。
- 更新 `suncode-hub-requirements`：创建/绑定 Hub 任务后、写规划 artifacts 前调用 spec sync。
- 确认 bundled skill 自动发现机制无需手工注册。

## 6. 测试

- 更新 `packages/cli/test/commands/hub.test.ts`：
  - 成功拉取并写入 spec
  - remote-wins 覆盖本地不同内容
  - 远端删除 Hub-managed spec 时生成 deletion candidate 并删除权威路径
  - local-only spec 不阻塞、不删除
  - 未登录/登录过期/服务失败/bundle 校验失败不写成功 manifest
  - `spec-deletions keep` 只能写入 `.suncode/spec/local/**`
  - `spec-deletions discard` 标记或移除候选
- 更新 configurator/template 测试：
  - 新 bundled skill 被安装
  - `suncode-hub-requirements` 包含 spec sync 步骤
- 更新 hook/state 测试：
  - `hub state --json` 不包含 spec 摘要
  - `<hub-state>` 使用 workflow-state 附加层话术，包含 `workflow:primary` / `hub-task:*`
  - hook 输出不包含 token/password/auth header

## 7. 验证命令

最小验证：

```bash
pnpm --filter @wjptz/suncode test packages/cli/test/commands/hub.test.ts
pnpm --filter @wjptz/suncode test packages/cli/test/configurators/shared.test.ts
pnpm --filter @wjptz/suncode test packages/cli/test/regression.test.ts
pnpm --filter @wjptz/suncode typecheck
```

如果定向测试命令与项目脚本不匹配，先用现有 package scripts 调整为等效最小命令，并记录实际执行命令。

## 8. 风险与回滚点

- 风险：误删 `.suncode/spec/**`。缓解：只删除 manifest 中 Hub-managed 且远端删除的文件，删除前写 deletion candidate。
- 风险：AI 继续读取被删除候选。缓解：候选放 `.suncode/.runtime/**`，不在 `.suncode/spec/**`。
- 风险：local-only spec 与 Hub 权威规则冲突。缓解：不阻塞但在 `<hub-state>` 明确 Hub 优先。
- 风险：hook 每轮做重网络请求。缓解：hook 仍只调用 `hub state --json`；`hub state` 不拉全量 spec，也不读取 spec manifest。
