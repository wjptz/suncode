# 同步 Trellis 上游最新稳定版本

## Goal

从已验证的官方 Trellis `v0.6.8` checkpoint 继续，完整审查并语义采纳
`v0.6.9`、`v0.6.10`、`v0.6.11` 中适用于 Suncode 的稳定行为，同时保留
Suncode 的 runtime identity、所有权边界、Hub/Channel/Memory 扩展和独立发布生命周期。

目标不是合并上游 Git 历史，而是让 Suncode 在自身架构中获得同等或更严格的用户行为，并留下可恢复、可审计的下一次同步 checkpoint。

## Verified Upstream Scope

| 角色 | 版本 | 官方 commit |
| --- | --- | --- |
| Exclusive checkpoint | `v0.6.8` | `dc68f5a92a68489b681c511f4a784e413d724e85` |
| Intermediate release | `v0.6.9` | `12e279a8af00456b1d0d4e3d0f7f59e7b702202e` |
| Intermediate release | `v0.6.10` | `c94d6fc289b7a6fdd9480bdfae4d4639c9ac2d4c` |
| Target stable release | `v0.6.11` | `a82d4d4c75abf85c6200c4528f750798d531a70f` |

范围共 43 个 commit。`v0.7.0-beta.*` 不属于本轮稳定版目标。

## Requirements

### R1. 官方身份和范围必须可证明

- `upstream` URL 必须等于 `https://github.com/mindfold-ai/Trellis.git`。
- 使用官方远端 tag commit，不使用 Suncode 同名本地 tag。
- release ref 只放在 `refs/remotes/upstream/releases/<tag>`，不创建或覆盖本地 tag。
- checkpoint 必须是目标 commit 的祖先，43 个 commit 必须逐项分类且不能静默遗漏。

### R2. 采纳 15 个稳定行为包

实施必须覆盖研究矩阵中的 A1-A15：

1. Python/Pi/OpenCode 有界、UTF-8 和二进制安全的子代理上下文；
2. `no-suncode` 单轮 workflow-state skip；
3. task meta、孤儿 task tree 和结构化 journal CLI；
4. Codex agent model keys 在 init/update 中持久化；
5. Suncode-namespaced Snow CLI class-1 平台；
6. symlinked `.suncode/tasks` / `.suncode/workspace` trusted roots；
7. additive-only journal `merge=union`；
8. Kimi research 通过可写 coder 持久化；
9. resolved fallback session 精确清理、Codex saved hook recovery、Python 3.9 CI；
10. Pi invoking model 继承与 `max` thinking；
11. Codex channel turn failure 传播和去重；
12. 完成 turn 后仍执行 idle timeout；
13. polyrepo repo 数量和 Git probe timeout 上限；
14. Python hook stdin 独立 UTF-8 解码；
15. 基于 Suncode template hash / ownership marker 的平台检测。

### R3. Suncode fork 契约不可退化

- 产品 runtime 始终使用 `.suncode`、`SUNCODE_*`、`suncode-*`、`@wjptz/suncode*`。
- 本仓 `.trellis/` 只是开发工作流，不得被 mass rename 成 `.suncode`，也不得被当作产品兼容桥。
- 不读取、迁移、重写、删除或认领用户的 Trellis runtime 数据、managed block、环境变量或 channel 数据。
- 保留 Hub/Agent Hub、中文 planning artifacts、Suncode workflow/spec injection、session identity、Channel/Memory、ZCode pull-based 适配和 OMP ownership-aware 检测。
- 共享平台目录的存在本身不是 Suncode 所有权证据。

### R4. Live 开发脚本与生成模板必须保持契约一致

- 对上游开发工作流脚本有意义的行为，需要同步到本仓 `.trellis/scripts/`。
- 对 Suncode 用户产品有意义的行为，需要适配到 `packages/cli/src/templates/suncode/` 及相应 platform templates。
- 两者可以有不同 identity，但状态机、失败语义和测试覆盖必须等价。

### R5. 明确排除上游 identity 与 bookkeeping

- 不复制 upstream version bump、release manifest 原文、tag、npm identity。
- 不复制 upstream task/journal、QR/截图、raw docs-site/marketplace submodule pointer。
- 不采纳 `c3596dd9...` 的 per-task workflow 中间态，因为官方稳定版内已由 `c143c260...` 回滚。
- 不 merge 整个 tag、不 cherry-pick 整个区间、不执行 `trellis update/upgrade`。

### R6. 保护当前用户工作

- 不修改、回滚、格式化或提交任务创建前已有的主仓脏文件。
- 不修改当前脏的 `docs-site` / `marketplace` 工作树；任何子模块扩展必须另行协调，不能覆盖 `v0.6.12` docs 或 workflow 修改。
- 暂存和提交必须使用显式路径白名单，并在提交前复核 staged diff。

### R7. 实施前后质量门

- 用户必须在看过最终 `prd.md`、`design.md`、`implement.md` 后，于后续消息明确批准实施；批准前任务保持 `planning`。
- 写代码前读取适用 spec，并对每个将修改的现有 symbol 运行 GitNexus upstream impact；HIGH/CRITICAL 必须先告知用户。
- 每个行为包必须有 success/failure/boundary/ownership 回归测试。
- 运行 CLI 定向测试、完整 CLI tests、Python 3.9 syntax gate、basedpyright、ESLint、TypeScript typecheck、build 和 `git diff --check`。
- 提交前运行 GitNexus `detect_changes(scope=compare, base_ref=main)` 并核对受影响流程。

### R8. Checkpoint 只能在可复现的实施提交后推进

- 先形成经过验证的 implementation commit。
- 再追加 ledger entry，记录完整官方范围、采纳/等价/排除结论、实际验证与本地 commit。
- checkpoint state 更新和 validate 必须放在单独 bookkeeping commit。
- 任何未分类、未提交、ref 不匹配、ledger 缺失或任务改动未解决时，都不得推进 checkpoint。

## Acceptance Criteria

- [ ] 官方 remote、三个稳定 tag、release refs、祖先链和 43-commit 范围均与 `research/release-evidence.md` 一致。
- [ ] 43 个 commit 在 `research/upstream-v0.6.9-v0.6.11-adoption.md` 中逐项出现，分类总数为 43。
- [ ] A1-A15 全部按 Suncode identity 和 ownership contract 实现；没有 whole-range merge/cherry-pick。
- [ ] Snow、Codex、Pi、Kimi、OpenCode、Channel、Python scripts、task/journal 和 platform detection 的新增行为均有定向回归测试。
- [ ] Live `.trellis` 与 packaged `.suncode` 脚本在适用行为上等价，Suncode-specific Hub/Memory/Channel 能力无回归。
- [ ] 裸平台目录、mixed ownership、symlink escape、binary context、ambiguous session、duplicate Codex error 等失败路径均被测试。
- [ ] Python 3.9 compile、basedpyright、ESLint、TypeScript typecheck、CLI full tests、build、whitespace checks 全部通过；未执行项必须明确说明且不得伪装为通过。
- [ ] GitNexus impact/detect_changes 已复核，HIGH/CRITICAL blast radius 有测试和人工证据。
- [ ] 用户原有脏文件、`docs-site` 和 `marketplace` 内部改动没有出现在 staged diff 或 implementation commit。
- [ ] implementation commit 已存在并记录到 ledger；随后 checkpoint 独立推进到官方 `v0.6.11` / `a82d4d4...`，validate 成功。
- [ ] 任务归档和 journal 记录只在 checkpoint commit 完成后执行。

## Non-goals

- 不同步 `v0.7.0-beta.*`。
- 不代替正在进行的 Suncode `v0.6.11` release task，也不决定 Suncode package version。
- 不在本轮重构与 A1-A15 无关的 DAG、Hub、Memory 或文档架构。
- 不处理用户正在编辑的 docs-site v0.6.12 文档和 marketplace workflow。

## Evidence

- 官方 release 证据：`research/release-evidence.md`。
- 完整 commit matrix：`research/upstream-v0.6.9-v0.6.11-adoption.md`。
