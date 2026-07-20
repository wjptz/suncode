# 建立 Trellis 上游持续同步 Skill

## 目标与用户价值

将 Suncode 跟踪并语义采纳官方 Trellis 更新的方法固化为项目级 skill，并记录可机器读取、可审计的同步检查点。下次执行同步时，代理应直接从已检查的官方 `v0.6.7` 之后开始，不再重做 fork 基线和本地同名 tag 分叉调查，也不会因为某一轮没有代码采纳而反复审查同一批上游提交。

## 背景与已确认事实

- 上一次同步任务已归档至 `.trellis/tasks/archive/2026-07/07-20-review-upstream-trellis-updates/`。
- 官方上游为 `https://github.com/mindfold-ai/Trellis.git`。
- fork 共同基线为官方 `v0.6.5` / `01ec8d6503b2338194e9bd2e9dbbcf22054c1bba`。
- 本次已完成语义采纳：
  - 官方 `v0.6.6` / `41b6a460d298861991b082c7a7fbfa1f9f42fc6f`。
  - 官方 `v0.6.7` / `e7c5ead4d0dfd717d11a40b6bc0c80d8af94c49a`。
  - 本地主仓采纳提交 `842056c1bc9eae17cae85f3d81df0dceed01ee21`。
  - marketplace 提交 `3619bfedf1a96569db3fe95cc805af0424092007`。
- 本地同名 tag 与官方 tag 已分叉；后续不能依赖同名本地 tag，也不能整体 merge/cherry-pick 官方发布。
- Suncode 与 Trellis 保持命名和运行时隔离，不引入 `.trellis` 兼容桥。
- Oh My Pi 支持已按 `.omp` 所有权规则纳入；因当时无稳定落盘 schema，未宣称支持 OMP memory 会话索引。
- 项目本地 skill 的正确归属是 `.agents/skills/`。若放入 `packages/cli/src/templates/common/bundled-skills/`，它会被 `suncode init/update` 下发给无此维护职责的下游项目，因此本任务不得进入 bundled skill 分发链路。

## 需求

1. 在 `.agents/skills/sync-trellis-upstream/` 新增 Suncode 仓库维护者使用的项目本地 skill；不得注册为公共 bundled skill 或随 CLI 下发。
2. skill 的 frontmatter 必须覆盖“同步/检查/采纳 Trellis 上游更新”“比较新 Trellis 版本”“从上次同步点继续”等中英文触发语义，并在执行开始时先校验和读取检查点。
3. 检查点必须区分 `last_reviewed` 和 `latest_adoption`：前者是下次发现新区间的起点，后者记录最近一次实际改动 Suncode 的上游范围与本地提交。
4. 同步流程必须通过官方 `upstream` 远端和隔离的 `refs/remotes/upstream/releases/*` 识别官方 commit，拒绝以本地同名 tag 或未刷新 `upstream/main` 作为官方最新基准。
5. 同步流程必须先产出可审核的 commit-level 采纳矩阵，再做 Suncode 语义转换；不允许盲目 merge、整段 cherry-pick 或用 `trellis update/upgrade` 同步源码。
6. `last_reviewed` 只能在目标区间全部完成分类并写入 ledger 后前移；若发生代码采纳，`latest_adoption` 还必须引用已经完成验证且真实存在的本地 commit。工具必须防止回退、旁路历史、半更新和与实际 Git 对象不一致。
7. 保留一份人类可读的追加式同步 ledger，并将本次 `v0.6.6`/`v0.6.7` 同步作为首条完整记录，包含日期、版本/提交、逐类结论、本地提交、验证、隔离约束和有意不采纳项。
8. skill 应保持精简；详细 fork 边界、检查点数据和历史放入按需加载的 `references/`，重复且易出错的检查点操作由可测试的 Python 标准库脚本承担。
9. 不回滚、覆盖、格式化或提交当前工作树中无关的用户改动。

## 验收标准

- [x] 指定语句“检查 Trellis 新版本并从上次同步点继续”可触发 `sync-trellis-upstream`，且 skill 会先运行检查点校验并读取 `last_reviewed`。
- [x] 初始检查点准确记录已检查至官方 `v0.6.7` / `e7c5ead4d0dfd717d11a40b6bc0c80d8af94c49a`，并将最近一次采纳关联到本地主仓 `842056c1bc9eae17cae85f3d81df0dceed01ee21` 和 marketplace `3619bfedf1a96569db3fe95cc805af0424092007`。
- [x] 人类可读记录包含 fork 基线、`v0.6.6`/`v0.6.7` 上游提交、本地提交、采纳内容、隔离约束和有意未采纳项。
- [x] 检查点工具提供 `show`、`validate`、`advance`，能够校验 schema、40 位提交 ID、Git 对象、ledger marker、祖先/前移规则、review-only 与 adoption 分流，并且替换失败时不留下部分写入。
- [x] `SKILL.md` 和 `agents/openai.yaml` 通过 `skill-creator` 的 `quick_validate.py`。
- [x] 新增脚本的正常前移、review-only、幂等重试、拒绝回退/旁路/无效数据和原子写失败路径均有可重复、无网络的定向验证。
- [x] `sync-trellis-upstream` 未出现在 `packages/cli/src/templates/common/bundled-skills/`、bundled 注册逻辑或 `.trellis/.template-hashes.json` 中。
- [x] 变更范围经 GitNexus `detect_changes()` 核对，且 Git diff 不包含无关用户改动。

## 非目标

- 不在本任务中执行 `v0.6.7` 之后的新一轮 Trellis 上游版本同步、发布 npm 包、创建 PR 或推送远端。
- 不新增公共 Suncode bundled skill，不修改 `getBundledSkillTemplates()`、平台 configurator、`.trellis/.template-hashes.json` 或下游生成文件。
- 不自动 fetch、merge、cherry-pick、提交或推送；检查点脚本只校验和原子更新本地状态，网络发现与代码采纳仍由 skill 工作流在用户门禁下驱动。
- 不复制上一轮完整研究文档到 skill；ledger 保存可继续工作的摘要与归档路径，细节仍由任务档案提供。
