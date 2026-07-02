# 设计并实现 Hub spec 同步流程

## Goal

为 Suncode Hub 团队任务增加固定的 spec 拉取与同步流程：每次从 Hub 接取、绑定或开始 Hub 任务前，CLI 自动从 Hub 拉取当前项目的全量线上 spec，并以线上审核版本作为权威约束更新本地 `.suncode/spec/**`。AI 只负责调度命令和读取结构化结果，不参与逐文件 diff、合并或裁判常规 spec 更新。

## Background / Confirmed Facts

- 现有 Hub 命令集中在 `packages/cli/src/commands/hub/**`，`index.ts` 已注册 `init`、`login`、`logout`、`state`、`pull`、`sync`、`submit-spec` 等命令。
- 当前已有 `suncode hub submit-spec`，用于把本地项目 spec 上传到 Hub；还没有对应的 `pull-spec` / 全量线上 spec 拉取命令。
- 当前 `<hub-state>` 由 hook 调用 `suncode hub state --json` 注入，已约定 hook 自身不直接访问 Hub 网络 API。
- 现有 Hub 规则要求登录态只来自 `suncode hub login`，不使用 `SUNCODE_HUB_TOKEN`。
- 用户已明确产品策略：Hub 线上 spec 是审核人员确认后的权威版本，本地 spec 冲突时线上胜出；本地被线上删除的旧内容需要保留为候选，供 AI 事后判断是否转成本地补充。

## Requirements

- R1. 新增固定 CLI 同步命令 `suncode hub pull-spec --json`，从 Hub 拉取项目全量 spec bundle。
- R2. `pull-spec` 必须使用现有 Hub 配置解析和 `suncode hub login` 登录态；Hub disabled、未登录、登录过期、服务异常、请求超时、bundle 校验失败时不得继续 Hub 任务。
- R3. spec 同步采用 `remote-wins` 策略：Hub 新增/更新的 spec 自动写入 `.suncode/spec/**`；Hub 删除的 Hub-managed spec 自动从 `.suncode/spec/**` 删除。
- R4. AI 不得参与常规 spec 同步的逐文件内容比较、手工合并、手工编辑或手工删除；AI 只调度 CLI 并基于 JSON 结果决定继续或停止。
- R5. CLI 必须根据 Hub bundle、上次同步 manifest、本地文件 hash 机械计算新增、更新、删除、未变、本地额外文件和删除候选。
- R6. Hub 删除的 Hub-managed spec 在删除前必须保存到 `.suncode/.runtime/hub-spec-deletions/<revision>/`，并写入删除候选 manifest。
- R7. 删除候选不阻塞当前 Hub 任务；AI 仅在用户要求复盘时判断候选是否值得保留为 local-only 补充。
- R8. 删除候选不能恢复到原 Hub-managed 路径；若保留，只能通过固定命令转成 `.suncode/spec/local/**`，并带有“本地补充、Hub 冲突时以 Hub 为准”的说明。
- R9. 本地比 Hub 多出来、且从未被 Hub 管理过的 spec 不阻塞任务、不自动删除，只在 `pull-spec --json` 和删除候选管理命令中提示；`hub state` / `<hub-state>` 不承载 spec 摘要。
- R10. `hub state --json` 只展示 Hub 配置、登录、服务、待选需求和当前任务绑定情况；`<hub-state>` 需要用 `hub:*`、`workflow:primary`、`hub-task:*`、`work:*` 和精简 `Flow add-on:` / `Do not:` 作为 `<workflow-state>` 的补充提示，不再输出 spec 状态。
- R11. 新增 bundled skill `suncode-hub-spec-sync`，用于在 Hub 任务接取/绑定/规划/恢复前调用 `pull-spec`；skill 明确 AI 不参与同步本体。
- R12. 可选新增 bundled skill 或命令说明 `suncode-hub-spec-deletion-review`，只在用户要求复盘删除候选时触发。
- R13. 新增删除候选管理命令：
  - `suncode hub spec-deletions list --json`
  - `suncode hub spec-deletions keep --id <id> --as .suncode/spec/local/<name>.md`
  - `suncode hub spec-deletions discard --id <id>`
- R14. `suncode-hub-requirements` 流程应在创建/绑定 Hub 任务后、写 PRD/design/implement 前触发 spec 同步。
- R15. 任务文档、skill 文档、错误提示和 AI 面向用户提示默认使用简体中文作为第一语言；命令名、字段名、API 路径、错误原文保留英文。

## Acceptance Criteria

- [ ] `suncode hub pull-spec --json` 存在，并在 Hub enabled + logged-in 情况下拉取线上 spec bundle。
- [ ] `pull-spec` 成功时写入 `.suncode/spec/**`、`.suncode/.runtime/hub-specs.json`，输出 revision、bundleHash、policy、actions、localOnly、deletionCandidates。
- [ ] `pull-spec` 对 Hub-managed spec 执行 `remote-wins`：远端更新覆盖本地，远端删除删除本地权威路径。
- [ ] 远端删除本地 Hub-managed spec 时，旧内容被保存到 `.suncode/.runtime/hub-spec-deletions/<revision>/`，并可通过命令列出。
- [ ] local-only spec 不阻塞 `pull-spec`，也不被默认删除。
- [ ] `spec-deletions keep` 只能把候选内容保留到 `.suncode/spec/local/**`，不能恢复到原 Hub-managed 路径。
- [ ] `hub state --json` 不包含 spec 同步摘要；hook 注入的 `<hub-state>` 用短状态码显示 Hub 可用性、当前任务绑定和待选需求，且不泄露 token、auth header、堆栈或敏感配置。
- [ ] `suncode-hub-spec-sync` skill 存在，并明确“AI 只调度 CLI，不逐文件 diff/合并 spec”。
- [ ] `suncode-hub-requirements` 在 Hub 任务规划前要求先完成 spec 同步。
- [ ] 命令测试覆盖成功同步、remote-wins 覆盖、远端删除备份、本地 local-only 不阻塞、未登录/服务失败/校验失败 fail closed。
- [ ] Hook/state 测试覆盖 ok、local-only、not-login、server-error、unavailable 等 Hub 展示状态，并确认不会输出 spec 摘要。
- [ ] 相关 Hub collaboration spec 文档更新，描述 pull-spec、删除候选和 skill 触发边界。

## Out of Scope

- 不实现 Hub 后台审核流程。
- 不让 AI 自动审查、合并或重写全量 spec 内容。
- 不把删除候选自动提交回 Hub。
- 不在公共 docs-site 暴露内部接口路径、鉴权 header、JSON payload 或部署信息。
- 不改变现有 `suncode hub submit-spec` 的上传语义，除非为了复用 manifest/hash 工具做内部重构。

## Open Questions

- 无阻塞问题。当前产品策略已定：Hub 线上权威、remote-wins、本地额外 spec 不阻塞、远端删除内容保留为 deletion candidate 供事后复盘。
