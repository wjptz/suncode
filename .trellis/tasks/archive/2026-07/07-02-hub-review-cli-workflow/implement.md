# Hub Review CLI workflow 实施计划

## 1. 规格与模板

- [x] 新增 `packages/cli/src/templates/common/bundled-skills/suncode-hub-review/SKILL.md`。
- [x] 确认所有平台 configurator 的 bundled skill 收集路径会自动安装该 skill。
- [x] 为 `suncode init --engineer` 增加测试，确认 `.engineer/skills/suncode-hub-review/SKILL.md` 生成。

## 2. 配置解析

- [x] 扩展 Hub config 类型，支持 `hub.review`。
- [x] 解析 `enabled`、`provider`、`required`、`trigger`、`unavailablePolicy` 和 `engineer` provider 配置。
- [x] 增加配置默认值：`required=false`、`trigger=manual`、`unavailablePolicy=bypass`。
- [ ] 增加无效配置测试。

## 3. Review artifact 模型

- [x] 扩展 `HubArtifact["type"]`，第一版优先新增 `"review"`。
- [x] 新增 review artifact collector，收集 `reviews/round-NNN/**`。
- [x] 新增 review round 计算、`review.json` 生成、diff hash/head commit 采集。
- [x] 将 `result.md` 改为结构化 review 结果渲染出的逐条问题报告，provider 原始输出只作为可选 `raw-output.md` 保存。
- [x] 扩展 `HubManifest` 记录 last review bundle/submission/status/round/approved diff。

## 4. Provider adapter

- [x] 定义 review provider interface。
- [x] 实现 Engineer provider 可用性探测。
- [x] 实现 Engineer 调用，优先采用 stdin 或 prompt 文件传递 prompt。
- [x] 执行前后检查工作树，检测 reviewer 是否修改文件。
- [x] 解析 provider 输出中的结构化 review result。
- [x] 支持 `hub.review.engineer.saveRawOutput` 控制是否保存 provider 原始 stdout/stderr。

## 5. `suncode hub review`

- [x] 在 Hub command registry 中新增 `review` 子命令。
- [x] 自动定位 current task 或解析 `--task`。
- [x] 支持 `--module` 和第一版 `--provider engineer` override。
- [x] 执行 round 编排、provider 调用、artifact 落盘。
- [x] review 可用时复用现有 task status 更新为 `in_review`。
- [x] 根据结果更新为 `changes_requested`、`approved` 或 `blocked`。
- [x] provider 不可用且 `bypass` 时返回 skipped，不改变状态。

## 6. Hub submission 复用

- [x] 泛化 submission kind 支持 `"review"`。
- [x] 复用 artifact upload session + MinIO 上传 review artifacts。
- [x] 新增 review submission path 映射。
- [x] 记录 review submission 到 manifest。
- [x] 增加测试覆盖 request payload 和 manifest 写入。

## 7. Completion gate

- [x] 在 `submit-completion` 前增加 `hub.review.required` gate。
- [x] 校验最近 review 是否 approved。
- [x] 校验 approved diff/head 是否仍匹配当前代码。
- [x] gate 不通过时返回明确错误并提示运行 `suncode hub review`。
- [x] review disabled 或 unavailable bypass 时保持旧 completion 行为。

## 8. 文档与验证

- [x] 更新 docs-site Hub/team 或 advanced configuration 文档。
- [x] 更新 CLI help 文案。
- [x] 增加单元测试和集成测试。
- [x] 运行 `pnpm typecheck`、相关 CLI tests、lint。

## 风险点

- Provider CLI 的真实命令形态需验证；当前本机未安装 `engineer`。
- review prompt 输出 JSON 解析必须稳健，不能把自然语言误判为 approved。
- task status 新值需要 Hub 后端接受。
- review submission 需要和 Hub 后端约定最小 schema。
