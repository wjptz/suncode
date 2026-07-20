# Trellis 上游持续同步 Skill 实施计划

## 实施原则

- 仅新增 `.agents/skills/sync-trellis-upstream/` 及本任务规划文档，不修改公共 bundled skill、CLI 模板分发或无关用户文件。
- 先用 `skill-creator` 的 `init_skill.py` 初始化合法目录与 `agents/openai.yaml`，随后用 `apply_patch` 完成精确内容。
- 检查点工具使用 Python 标准库，不引入新包、网络请求或自动 Git 写操作。
- 初始状态和 ledger 必须来自已归档任务、真实 Git 对象和 journal 验证结果，不使用未核对的短 hash 或记忆。
- 这些文件都是新增，默认没有已存符号的 blast radius。若实施中发现必须修改任何已有函数、类或方法，先按 AGENTS 规则做 GitNexus upstream impact；HIGH/CRITICAL 先向用户报告并回到规划边界。

## 实施清单

- [x] [P1] 初始化项目 Skill: 运行 `skill-creator/scripts/init_skill.py sync-trellis-upstream --path .agents/skills --resources scripts,references`，通过 `--interface` 生成只含 `display_name`、`short_description`、`default_prompt` 的 `agents/openai.yaml`，不生成 examples 或 assets。
- [x] [P2] 编写触发与同步流程: 将 `SKILL.md` 收敛为检查点加载、官方隔离 ref 发现、Trellis 规划门禁、commit-level 采纳矩阵、Suncode 语义移植、验证、提交与检查点前移，并明确何时按需读取各 reference。
- [x] [P3] 固化 Fork 边界与首次同步记录: 创建 `fork-boundaries.md`、`sync-ledger.md` 和 `sync-state.json`，记录官方 URL、`v0.6.5` 基线、`v0.6.6`/`v0.6.7` 官方 commit、14 项采纳概要、主仓/marketplace 完整 commit ID、验证结果、OMP memory 有意不扩展理由与“下次从 `v0.6.7` 后继开始”。
- [x] [P4] 实现原子检查点工具: 使用 `checkpoint_model.py`、`checkpoint_store.py` 与轻量 CLI 实现 `show`、`validate`、`advance`，验证 schema、40 位 hash、Git commit 存在性、祖先关系、ledger marker、review-only/adoption 分流与幂等重试，通过同目录临时文件、flush/fsync 和 `os.replace` 原子写入。
- [x] [P5] 添加无网络回归测试: 使用 `unittest` 和临时本地共享克隆覆盖有效状态、正常前移、review-only、幂等、回退/旁路/缺失 commit 拒绝、ledger marker 拒绝、严格 schema 类型与原子替换失败保留原文件。
- [x] [P6] 校验 Skill 与当前检查点: `quick_validate.py` 通过；11 个 Python 测试通过；`sync_checkpoint.py validate` 通过；py_compile 与 basedpyright 均为零错误；`git diff --check` 通过；`openai.yaml` 与 `SKILL.md` 一致。
- [x] [P7] 执行 Trellis 全范围质量检查: 已按 `trellis-check` 审查 PRD/design/implement；新 skill 未进入 bundled/template-hash 链路；精确暂存仅含本任务 16 个新增文件；GitNexus compare/staged 检查均为 low risk，staged 范围为 0 个既有符号和 0 条执行流。
- [ ] [P8] 提交并收尾: 按 Phase 3.4 将 skill、检查点和任务规划组成用户审核后的逻辑提交，不纳入事先存在的脏文件；随后运行 `trellis-finish-work` 归档并写 journal。

## 建议命令

### 初始化

```bash
rtk python3 /home/kangmeng/.codex/skills/.system/skill-creator/scripts/init_skill.py sync-trellis-upstream --path .agents/skills --resources scripts,references --interface 'display_name=Sync Trellis Upstream' --interface 'short_description=Resume safe Trellis-to-Suncode upstream adoption' --interface 'default_prompt=Use $sync-trellis-upstream to inspect official Trellis releases after the recorded checkpoint and plan a safe semantic adoption.'
```

### 定向验证

```bash
rtk python3 -m unittest discover -s .agents/skills/sync-trellis-upstream/scripts -p 'test_*.py' -v
rtk python3 .agents/skills/sync-trellis-upstream/scripts/sync_checkpoint.py validate
rtk python3 -m py_compile .agents/skills/sync-trellis-upstream/scripts/checkpoint_model.py .agents/skills/sync-trellis-upstream/scripts/checkpoint_store.py .agents/skills/sync-trellis-upstream/scripts/sync_checkpoint.py .agents/skills/sync-trellis-upstream/scripts/test_sync_checkpoint.py
rtk python3 /home/kangmeng/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/sync-trellis-upstream
rtk git diff --check
```

### 范围核对

```bash
rtk rg -n 'sync-trellis-upstream' packages/cli/src/templates/common/bundled-skills packages/cli/src/templates/common/index.ts .trellis/.template-hashes.json
rtk git status --short
```

`rg` 预期无 bundled/template-hash 命中；`git status` 必须仅将本任务新文件与事先存在的无关脏文件分开报告。

## 高风险点与回滚点

- 检查点回退或上游历史旁路：脚本 fail-closed，不提供 `--force`；需要人工核对时回到 ledger/Git 证据，不绕过校验。
- ledger 已追加但 JSON 替换失败：JSON cursor 保持旧值，下次可以幂等重试 `advance`；多一条未引用 ledger 记录比 cursor 越过未完成实现更安全。
- 意外修改 bundled skill 或 template hash：立即停止并将范围回到新项目 skill，不继续扩大改动。
- 新 skill 本身无运行时安装或数据迁移副作用。未提交时回滚点是本任务新目录；已提交后使用普通 revert commit，不改写 Git 历史。

## 实施前门禁

- [x] 用户已审阅 `prd.md`、`design.md`、`implement.md` 并明确批准进入实施。
- [x] 审阅后运行 `task.py start 07-20-trellis-upstream-sync-skill`，任务状态进入 `in_progress`。
- [x] 实施前加载 `trellis-before-dev`，阅读相关 spec 与本任务三份规划文档。
- [x] 确认当前工作树事先存在的无关改动清单，后续不纳入提交。
