# Trellis 上游持续同步 Skill 调研

## 调研结论

新能力应作为 Suncode 仓库维护者使用的项目本地 skill，放在 `.agents/skills/sync-trellis-upstream/`。它不应进入 `packages/cli/src/templates/common/bundled-skills/`，也不应由 `suncode init/update` 分发到下游项目。

同步起点应由机器可读的 `references/sync-state.json` 提供：当前已完成检查和语义采纳至官方 `v0.6.7` / `e7c5ead4d0dfd717d11a40b6bc0c80d8af94c49a`。人类可读的详细结论放在追加式 `references/sync-ledger.md`；下次发现新版本时从 `last_reviewed` 之后开始，不重新审核已分类的历史变更。

## 项目级 Skill 归属证据

- `.agents/skills/trellis-meta/SKILL.md` 将 `.agents/skills/` 定义为共享 skill 层，并明确项目私有规则应放在项目本地 skill，不放进公共 bundled skill。
- `.agents/skills/trellis-meta/references/customize-local/change-skills-or-commands.md` 区分了 bundled skill 和 project-local skill：后者由项目拥有，不受 `trellis update` 刷新。
- 同一文档明确 Codex 和 Gemini CLI 都可读取 `.agents/skills/`；对当前 Suncode 维护场景，该共享层比只复制到 `.codex/skills/` 更合适。
- `.trellis/.template-hashes.json` 仅跟踪 Trellis 已分发的 bundled skill 资产；新名称 `sync-trellis-upstream` 不与 `trellis-meta` / `trellis-channel` / `trellis-session-insight` / `trellis-spec-bootstrap` 冲突。
- `packages/cli/src/templates/common/index.ts` 会枚举 `packages/cli/src/templates/common/bundled-skills/` 并将其中技能发往各个下游平台。上游同步是 Suncode fork 维护职责，下游项目没有这一仓库关系，因此不应进入该分发链路。

## Skill 结构与校验证据

`skill-creator` 要求新 skill：

- 用 `init_skill.py` 初始化，目录名与 frontmatter `name` 一致，使用小写连字符命名。
- `SKILL.md` 仅保留触发信息、核心流程和不可违背的门禁；历史、详细边界和机器状态放入 `references/`。
- 反复且易出错的状态校验/前移由 `scripts/` 中的可测试工具承担，不让代理每次临时重写。
- 生成 `agents/openai.yaml`，仅写 `display_name` / `short_description` / `default_prompt`，默认 prompt 显式引用 `$sync-trellis-upstream`。
- 最终运行 `quick_validate.py`，并实际执行新脚本的测试。

## 已确认的 Git 与同步基线

### 官方远端

- 当前远端 `upstream` 的 fetch/push URL 均是 `https://github.com/mindfold-ai/Trellis.git`。
- 为避免覆盖本仓同名 tag，前次已将官方发布抓取到隔离 ref：
  - `refs/remotes/upstream/releases/v0.6.5` → `01ec8d6503b2338194e9bd2e9dbbcf22054c1bba`
  - `refs/remotes/upstream/releases/v0.6.6` → `41b6a460d298861991b082c7a7fbfa1f9f42fc6f`
  - `refs/remotes/upstream/releases/v0.6.7` → `e7c5ead4d0dfd717d11a40b6bc0c80d8af94c49a`
- `refs/remotes/upstream/main` 当前仍停在 fork 基线 `v0.6.5`，因此下次不能把该本地 ref 直接当作“官方最新”；必须先查询/抓取官方 tag。

### 已完成的首次同步

- 归档任务：`.trellis/tasks/archive/2026-07/07-20-review-upstream-trellis-updates/`。
- 主仓实现提交：`842056c1bc9eae17cae85f3d81df0dceed01ee21`。
- marketplace 子模块提交：`3619bfedf1a96569db3fe95cc805af0424092007`。
- 任务归档提交：`edfbe24777840f2040d0f82240dd6ce68a2a3b78`。
- journal 提交：`36796e378dec728b93de14b4c6293fbce788d5bb`。
- 完成 14 项语义采纳；core `302/302`、CLI `1468/1468`，合计 `1770/1770` 测试通过，lint/typecheck/build 通过。证据位于归档 `implement.md` 与 `.trellis/workspace/kangmeng/journal-1.md`。
- 唯一有意未扩展项是 OMP memory 离线索引：官方 `v0.6.6` 并未提供稳定落盘目录和 JSONL schema，因此未伪装成 Pi memory source。这不是漏采纳已有上游功能。

## 检查点模型选择

### 为什么同时需要 JSON 和 Markdown

- 只用 Markdown：人可读，但代理需每次重新解析段落，容易选错起点。
- 只用 JSON：起点稳定，但不适合记录变更矩阵、有意不采纳项和验证结果。
- 采用 JSON 当当前 cursor，Markdown 当追加式 ledger；JSON 通过 `ledger_entry` 引用 Markdown 中的唯一 marker。

### “已检查”与“已采纳”必须分开

- `last_reviewed` 是下次发现新上游 commit 的起点；它表示截止该 commit 的变更均已分类，可能包括“已采纳”、“已有等价实现”和“有意不采纳”。
- `latest_adoption` 记录最近一次真正改动 Suncode 的上游范围和本地提交。如果新上游变更全部被判定为无需采纳，只前移 `last_reviewed`，不伪造新的 adoption commit。
- 详细的逐 commit 决策不塞入 cursor JSON，而是永久留在 ledger 和对应 Trellis 任务研究文档中。

## 检查点工具边界

脚本只提供 `show` / `validate` / `advance`，且不执行网络请求、`git fetch`、代码移植、提交或推送：

- `show`：以稳定文本或 JSON 展示当前检查起点。
- `validate`：校验 schema、完整 40 位 commit ID、ledger marker、官方/本地 Git 对象存在性和祖先关系。
- `advance`：只允许将 `last_reviewed` 前移到当前 cursor 的后代；发生实现采纳时额外要求已存在的本地 commit。先校验 ledger marker，再用同目录临时文件 + `os.replace` 原子替换 JSON。
- 重复以同一 commit 和 ledger entry 执行 `advance` 时成功 no-op，便于不确定上次命令是否已完成时安全重试。

## 建议目录

```text
.agents/skills/sync-trellis-upstream/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── references/
│   ├── fork-boundaries.md
│   ├── sync-ledger.md
│   └── sync-state.json
└── scripts/
    ├── checkpoint_model.py
    ├── checkpoint_store.py
    ├── sync_checkpoint.py
    └── test_sync_checkpoint.py
```

实施时将类型化 schema、Git/ledger 校验和 CLI 拆开，避免单个脚本同时承担数据模型、外部进程、原子持久化和参数解析；这些仍是 skill 内部模块，不形成新的公共包或分发面。

## 本轮不需要的能力

- 不创建第二套公共 bundled skill，不修改 `getBundledSkillTemplates()` 或 Suncode 平台配置器。
- 不自动查找、下载、merge 或 cherry-pick 官方提交；这些是 skill 指导的审核流程，不是检查点工具的副作用。
- 不将完整上轮研究拷贝进 skill；ledger 保留结论与原任务路径，需要细节时再按需读取。
- 不在本任务中启动对 `v0.6.7` 之后的新一轮同步。
