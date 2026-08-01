# Suncode v0.6.12 验证记录

## 2026-08-02 实施前快照

### 主仓

- branch：`main`
- `HEAD`：`135623b8e47daabc1650fe0737eb0d9183740514`
- `origin/main`：`4274fa5ef218a2084bcf5c94acfd05db4e6d120f`
- `v0.6.11`：`275618c62b5f9b93b0cca6babc9e4e2c0dbcdc68`
- merge base：`be52b89e3f723123a0ce8210a5014913a1260f44`
- divergence：local ahead 17 / behind 4
- 已有非任务 dirty paths：
  - `.claude/skills/gitnexus/gitnexus-cli/SKILL.md`
  - `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md`
  - `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`
  - `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`
  - `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md`
  - `AGENTS.md`
  - `CLAUDE.md`
  - `docs-site`（release docs 修改）
  - `drafts/kb-design-philosophy.md`
- 当前任务目录 `.trellis/tasks/08-02-release-suncode-v0-6-12/` 为本轮新增，任务状态已变为 `in_progress`。

### 子模块

- 主仓记录的 docs-site gitlink：`2e7e5dcb5649aa9d15e0d423cd384bfcb9798e96`
- docs-site `HEAD` / `origin/main`：`2e7e5dcb5649aa9d15e0d423cd384bfcb9798e96`
- docs-site 工作树：25 个 tracked 双语文档改动，2 个未跟踪 v0.6.12 changelog。
- 主仓记录的 marketplace gitlink：`3a78f3e092624d09748d6175d65c19e4867725c3`
- marketplace `HEAD`：`3a78f3e092624d09748d6175d65c19e4867725c3`
- marketplace `origin/main`：`62f7bf94df10557936b01708f431013c66538d22`
- marketplace 工作树 clean，local ahead 1。

### 公共发布基线

- `@wjptz/suncode`：version `0.6.11`，`latest=0.6.11`。
- `@wjptz/suncode-core`：version `0.6.11`，`latest=0.6.11`。
- 三个仓库 `git fetch --tags --prune` 均成功。

### GitNexus

- 修改前 `_write_text_atomic` upstream impact：`HIGH`。
- blast radius：1 个直接调用者、3 个上游符号、2 类受影响执行流。
- d=1：`build_node_context`。
- d=2：`claim_execution_node`。
- d=3：`task_execution._cmd_claim`。
- 已使用 `node .gitnexus/run.cjs analyze --index-only` 重建本地索引：11,757 nodes、21,057 edges、422 clusters、300 flows。
- MCP 资源仍缓存旧 staleness 文本，但重建后复跑 impact 得到相同精确结果。
