# Trellis 上游持续同步 Skill 设计

## 设计目标

为 Suncode 维护者提供一条可重入、可审核、不污染本地 tag 的 Trellis 上游同步流程。同步流程的起点由受校验的检查点给出，每轮细节由追加式 ledger 与 Trellis 任务档案承载。

## 边界与所有权

- skill 的单一真源为 `.agents/skills/sync-trellis-upstream/`，由 Suncode 仓库拥有。
- skill 不进入 `packages/cli/src/templates/common/bundled-skills/`，不修改 init/update 分发链，不出现在下游 Suncode 用户项目中。
- `.trellis/tasks/` 仍是每轮同步的 PRD、调研和验证详情所在地；skill 只保留长期不变的流程、边界和检查点。
- 官方 Trellis 只作为行为规格来源。实现目标始终是当前 Suncode 架构，不恢复 Trellis 品牌、包名、`.trellis`、`TRELLIS_*` 或兼容桥。

## 目录与职责

```text
.agents/skills/sync-trellis-upstream/
├── SKILL.md                         # 触发与核心流程
├── agents/openai.yaml              # Codex UI 元数据
├── references/fork-boundaries.md   # Suncode 隔离/所有权/排除规则
├── references/sync-ledger.md       # 追加式同步详情
├── references/sync-state.json      # 当前机器可读 cursor
├── scripts/checkpoint_model.py     # 类型化 schema 与边界解析
├── scripts/checkpoint_store.py     # Git 校验、前移与原子写入
├── scripts/sync_checkpoint.py      # 轻量 show/validate/advance CLI
└── scripts/test_sync_checkpoint.py # 无网络标准库测试
```

`SKILL.md` 不复制 ledger 和 fork 历史，只在相应步骤明确要求读取这三份 reference，保持渐进披露。

## 检查点数据契约

`references/sync-state.json` 使用一个稳定的顶层结构：

```json
{
  "schema_version": 1,
  "upstream": {
    "repository": "https://github.com/mindfold-ai/Trellis.git",
    "remote": "upstream",
    "release_ref_namespace": "refs/remotes/upstream/releases"
  },
  "fork_baseline": {
    "version": "v0.6.5",
    "commit": "01ec8d6503b2338194e9bd2e9dbbcf22054c1bba"
  },
  "last_reviewed": {
    "version": "v0.6.7",
    "commit": "e7c5ead4d0dfd717d11a40b6bc0c80d8af94c49a",
    "date": "2026-07-20",
    "ledger_entry": "2026-07-20-v0.6.6-v0.6.7",
    "task": ".trellis/tasks/archive/2026-07/07-20-review-upstream-trellis-updates"
  },
  "latest_adoption": {
    "from_upstream_exclusive": {
      "version": "v0.6.5",
      "commit": "01ec8d6503b2338194e9bd2e9dbbcf22054c1bba"
    },
    "through_upstream_inclusive": {
      "version": "v0.6.7",
      "commit": "e7c5ead4d0dfd717d11a40b6bc0c80d8af94c49a"
    },
    "local_commit": "842056c1bc9eae17cae85f3d81df0dceed01ee21",
    "related_commits": [
      {
        "repository": "marketplace",
        "commit": "3619bfedf1a96569db3fe95cc805af0424092007"
      }
    ],
    "date": "2026-07-20",
    "ledger_entry": "2026-07-20-v0.6.6-v0.6.7"
  }
}
```

### 字段语义

- `fork_baseline` 是初次 fork 共同基线，初始化后不允许通过 `advance` 改写。
- `last_reviewed` 是下次官方 commit 发现区间的排他起点。它表示该点之前每个实质变更都有分类结论，不表示每个上游改动都原样进入 Suncode。
- `latest_adoption` 记录最近一次实际发生 Suncode 代码/文档采纳的范围。当新一轮只有“已有等价实现”或“有意不采纳”时，保持此对象不变。
- `ledger_entry` 对应 `sync-ledger.md` 中的唯一标记 `<!-- sync-entry:<id> -->`，使机器状态能找到详细决策。
- 所有 commit ID 必须是 40 位小写十六进制字符串，避免短 hash 随历史增长后变得歧义。

## 检查点工具设计

### 公开界面

```text
python3 scripts/sync_checkpoint.py show [--json]
python3 scripts/sync_checkpoint.py validate
python3 scripts/sync_checkpoint.py advance \
  --reviewed-version <tag> \
  --reviewed-commit <40-hex> \
  --date <YYYY-MM-DD> \
  --ledger-entry <id> \
  --task <repo-relative-path> \
  [--local-commit <40-hex>] \
  [--related-commit <repository>=<40-hex>]... \
  [--dry-run]
```

测试和非默认布局可使用隐藏在 help 中的通用路径参数 `--state` / `--ledger` / `--repo`，默认值始终从脚本自身位置解析，不依赖当前工作目录。

### 内部模型

- 用 frozen dataclass 表示 commit point、review cursor 和 adoption record，避免在校验层间传递可随意改写的原始 `dict`。
- 用两个按职责拆分的深模块分别封装类型化 JSON schema，以及 Git/ledger 校验、祖先关系和原子写。CLI 层只负责 argparse 与稳定错误输出。
- 只在文件/Git 边界做运行时校验；内部操作使用已解析类型。
- 不抽取通用框架或公共包：这些模块只服务一个项目检查点，直接执行 `sync_checkpoint.py` 时从同目录加载。

### 校验与前移规则

1. 读取现有 JSON，拒绝无效 JSON、缺少字段、未知 `schema_version` 和错误类型。
2. 验证 upstream URL/remote/ref namespace 与 fork baseline 不被 `advance` 改写。
3. 验证 baseline、last reviewed、latest adoption 的上游 commit 均是当前 Git 对象库中的 commit；验证 adoption 的主仓 local commit 存在。
4. 验证 `fork_baseline <= latest_adoption.through <= last_reviewed` 的祖先关系。
5. 验证所有 `ledger_entry` 在 ledger 中有精确 marker。
6. `advance` 先验证目标 reviewed commit 存在，且当前 reviewed commit 是其祖先。回退或旁路历史均 fail-closed。
7. 带 `--local-commit` 时创建新 `latest_adoption`，其 range 从原 `last_reviewed` 排他开始，至新 `last_reviewed` 包含结束。不带该参数时仅更新 reviewed cursor。
8. 先验证新 ledger marker 和完整 candidate state，再将 JSON 写入同目录临时文件，flush + `os.fsync`，最后 `os.replace`。任何异常都清理临时文件并保留旧状态。
9. 目标 commit 和 ledger entry 与当前状态完全一致时返回成功 no-op；同 commit 但元数据冲突时拒绝。

## Skill 执行流程

### 1. 建立现状

1. 读取 `.trellis/workflow.md` 并通过 `trellis-start` 恢复任务上下文。
2. 运行 `sync_checkpoint.py validate`，然后读取 `sync-state.json`。
3. 读取 `fork-boundaries.md`。只有需要了解旧决策细节时才读 `sync-ledger.md` 和已归档任务。
4. 核对 Git 根、分支、工作树和 `upstream` URL；不触碰无关脏文件。

### 2. 发现官方新区间

1. 用 `git ls-remote --tags upstream` 查询官方 tag，对 annotated tag 使用 peeled commit。
2. 按 SemVer 选定目标发布，不依赖本地同名 tag。
3. 用 `git fetch --no-tags upstream refs/tags/<tag>:refs/remotes/upstream/releases/<tag>` 抓取到隔离 namespace，不覆盖 `refs/tags/*`。
4. 核对抓取后 `^{commit}` 与 `ls-remote` 结果一致，并验证当前 `last_reviewed` 是目标祖先。不是祖先时停止，不自动接受上游改写历史。

### 3. 调研与决策

1. 遵循 Trellis Phase 1 创建同步任务，将官方 commit/release/test 证据写入 `research/`。
2. 以 `last_reviewed..target` 生成 commit-level 矩阵，排除纯 release/journal/archive/submodule pointer/dogfood 噪声，但每个排除都要记录理由。
3. 逐项在当前 Suncode 中定位，分为“直接语义采纳”、“按 Suncode 契约改造后采纳”、“已有等价实现”、“有意不采纳”。
4. 以当前 Suncode 代码为实现基线，不整 tag merge/cherry-pick，不用 `trellis update/upgrade` 当作源码同步。
5. 用户审阅 PRD/design/implement 并批准后才进入实施。

### 4. 语义采纳与质量门

1. 实施前加载 `trellis-before-dev`，对将修改的每个符号做 GitNexus upstream impact；HIGH/CRITICAL 先向用户报告。
2. 小批移植，按 Suncode 命名、持久化、managed block、平台和所有权契约转换。
3. 每批做定向测试，最后跑受影响包全量测试、lint、typecheck、build 与 `git diff --check`。
4. 提交前运行 GitNexus `detect_changes(scope="compare", base_ref="main")`，确认只有预期符号和执行流受影响。

### 5. 记录与前移

1. 先按 Phase 3.4 完成实现提交，获取稳定的本地 commit ID。
2. 在 `sync-ledger.md` 追加新条目，包含官方范围、commit 矩阵结论、本地提交、验证和有意不采纳项。
3. 运行 `sync_checkpoint.py advance`；无代码采纳时不传 `--local-commit`。
4. 再次运行 `validate`，将 ledger + state 作为一个独立的检查点记录 commit。
5. 最后由 `trellis-finish-work` 归档任务并记录 journal。

## 初始 Ledger 条目

首条完整记录包含：

- 同步日期 `2026-07-20`。
- fork 基线 `v0.6.5` / `01ec8d6...`。
- 官方范围 `v0.6.5..v0.6.7`，并单列 `v0.6.6` / `41b6a46...` 和 `v0.6.7` / `e7c5ead...`。
- 14 项采纳概要：文件/用户数据安全、Channel 可靠性、Pi/ZCode/Codex/task/journal 修复、完整 OMP 与 `.omp` 所有权隔离。
- 主仓实现提交 `842056c1bc9eae17cae85f3d81df0dceed01ee21`，marketplace 提交 `3619bfedf1a96569db3fe95cc805af0424092007`。
- 归档任务和完整研究路径。
- core `302/302`、CLI `1468/1468`，总计 `1770/1770`，以及 lint/typecheck/build 结果。
- 有意不扩展 OMP memory 离线索引，原因是官方当时无稳定磁盘 schema。
- 明示下次从 `e7c5ead4d0dfd717d11a40b6bc0c80d8af94c49a` 的后继 commit 开始。

## 测试设计

### 脚本单元/集成测试

`scripts/test_sync_checkpoint.py` 使用 Python 标准库 `unittest`、`tempfile` 和临时 Git 仓库，不需要网络或第三方依赖：

- 有效初始状态通过 `validate`。
- 后代 reviewed commit 能正常前移，带 local commit 时更新 latest adoption。
- 不带 local commit 的 review-only 前移保留 latest adoption。
- 相同目标的重试为幂等 no-op。
- 旧 commit 回退、旁路 commit、不存在 commit、无效 hash、缺失 ledger marker 均被拒绝。
- 模拟 `os.replace` 失败时，原状态字节保持不变，临时文件被清理。

### Skill 校验

- `quick_validate.py .agents/skills/sync-trellis-upstream`。
- 检查 `agents/openai.yaml` 与 `SKILL.md` 的名称、描述和默认 prompt 一致。
- 运行新 skill 目录中的检查点 `validate`。
- 使用 `rg` 确认新 skill 未出现于 bundled skill 分发注册或 `.trellis/.template-hashes.json`。

## 兼容、回滚与失败处理

- 创建 project-local skill 不改变已有 Trellis/Suncode 运行时，回滚时只需删除新 skill 目录；实际操作必须使用安全 Git 回退而不清理用户工作树。
- 检查点校验失败时不进入上游比较；先对照 ledger 和 Git 对象修复状态。
- 官方 tag 与已存隔离 ref 不一致，或新 commit 不再是 last reviewed 后代时，按上游历史异常处理并停止自动前移。
- 未通过实现验证、尚无本地提交或 ledger 未完成时，不允许写入新 adoption。
- 脚本不自动 `git add/commit/push`，保留 Trellis Phase 3.4 的人工审核提交边界。

## 主要权衡

- 两份记录比单文件多，但 JSON cursor 与 Markdown ledger 分别解决稳定机读和完整审计，二者都是本需求的基本真实。
- 检查点记录独立于实现 commit，会增加一个小型 bookkeeping commit；但只有这样才能在状态中写入已存在、可验证的实现 commit ID。
- 项目 skill 只直接覆盖读取 `.agents/skills/` 的平台；为 Claude/OMP 等平台复制同一 skill 会制造多个可写检查点真源，当前不做该扩展。
