# Trellis v0.6.9-v0.6.11 实施计划

## 状态与批准门禁

当前任务必须保持 `planning`。只有用户在阅读本任务的 PRD、设计、采纳矩阵后，于后续消息明确回复批准实施，才执行：

```bash
python3 ./.trellis/scripts/task.py start .trellis/tasks/08-01-sync-trellis-upstream-latest
```

批准前不得修改产品代码、测试、spec、CI、sync ledger 或 checkpoint。

## 实施前准备

1. 重新运行 `sync_checkpoint.py validate/show`，确认仍为官方 `v0.6.8`。
2. 确认三个 release refs 仍解析为 matrix 中的官方 commit，且祖先链不变。
3. 读取 `trellis-before-dev`、Python 变更使用 `python-design`，并加载本任务 JSONL 中列出的适用 spec。
4. 重新记录 `git status --short`；建立允许修改路径清单，排除用户已有脏文件和两个子模块。
5. 对下列每个现有 symbol 在编辑前运行 GitNexus upstream impact；新 symbol 则先对其调用点/所属 high-fan-out symbol 做 impact：
   - `getConfiguredPlatforms`、`collectTemplateFiles`、`configureCodex`、`createWorkflowStructure`；
   - Python `clear_active_task`、`get_implement_context`、`get_check_context`、`run_git`、`_discover_child_git_repos`；
   - Pi `resolveRunCfg` / extension entry；
   - Channel `resolveSpawn`、`assembleContext`、Codex notification parser、`scheduleSupervisorIdleTimer`；
   - platform registry / init / update / uninstall 的 Snow touch points。
6. impact 为 HIGH/CRITICAL 时，先把 blast radius、受影响 flows 和覆盖策略报告给用户，再编辑。

## Phase 1：Context 与 Python 基础 contract（A1、A2、A9、A13、A14）

### 1.1 Config 与 Python materializer

- 在 live `.trellis/scripts/common/config.py` 和 packaged `.suncode/scripts/common/config.py` 实现 context limits 和 prompt skip config；identity/default keyword 分别保持 Trellis/Suncode。
- 重构 shared subagent hook 为 byte-based materializer、UTF-8 safe truncation、binary notice、shared budget。
- 同步 live platform hook copies 或确保它们由单一 template 生成，避免手工副本漂移。
- 修改 `task_context.py` 的 Python 3.9 nested f-string 问题。

### 1.2 Per-turn skip 与 stdin UTF-8

- Python/OpenCode workflow-state hook 加 skip keyword。
- subagent/shell/statusline 等受影响 hook 在 stdin read 前 best-effort UTF-8 reconfigure。

### 1.3 Session 与 Git probes

- `clear_active_task` 删除 resolved `previous.context_key`，ambiguous/unresolved no-op。
- `run_git` 增加 optional timeout；只在 session-context best-effort probes 使用。
- 自动 polyrepo scan 加 8 repo cap，超量返回空并警告。

### 1.4 Tests

- 扩展 context-injection、prompt-skip、regression、active-task/session、polyrepo suites。
- 加 binary/NUL/invalid UTF-8、multi-byte boundary、0/invalid config、ambiguous fallback、8/9 repo、timeout 和 locale cases。
- 先跑本 phase 定向 tests 和 Python 3.9 compile，再进入下一 phase。

## Phase 2：Task / journal 工作流（A3、A7）

### 2.1 Task meta 与 tree

- live `.trellis` 和 packaged `.suncode` 的 `add_session.py`、`task.py`、`task_store.py` 同步结构化 flags、orphan fallback、generic meta。
- generic meta 必须 merge 现有 dict，回归覆盖 `meta.hub` 保留和中文 task output。

### 2.2 Gitattributes

- 新增 Suncode journal rule template/export。
- `createWorkflowStructure` 和 update 在正确阶段调用 additive-only helper；dry-run no-op。
- 本仓开发根 `.gitattributes` 如需规则，只追加 `.trellis/workspace/*/journal-*.md merge=union`，不得覆盖用户现有属性。

### 2.3 Tests/spec

- 新增/扩展 add-session、task-list-tree、task-meta、init/update/gitattributes/worktree warning tests。
- 更新 script/schema boundary 和 directory structure spec。

## Phase 3：Native agents 与 platform adapters（A4、A5、A6、A8、A10、A15）

### 3.1 Codex model keys

- 在 Codex configurator 实现严格 flat-TOML extract/apply/preserve helpers。
- init 和 update desired-file collection 在写入/hash comparison 前应用。
- 三个 Suncode agent 模板增加 inactive terra/high hints 和 saved hook output recovery contract。

### 3.2 Pi/Kimi

- Pi 加 invoking model inheritance 与 `max` thinking；同步 schema/parser/display/spawn。
- Kimi research 改派 writable coder，并锁定 research-only 写范围。
- 将 A1 materializer/binary contract 同步到 Pi。

### 3.3 OpenCode

- 实现 A1 context limits/binary contract和 A2 skip；保持 OpenCode JS parser 与 Python config 语义一致。

### 3.4 Trusted roots

- 新增 channel trusted-root resolver，接入 agent/context/spawn。
- OMP extension 使用 `.suncode` config 和相同 containment contract。

### 3.5 Snow

- 增加 `AITool/CliFlag` registry entry、configurator、collect templates、CLI/init/update/uninstall support。
- 添加 `.snow` 下 Suncode-namespaced commands、agents、hooks、skills 和 `SNOW.md`。
- 不修改脏 marketplace 子模块；主仓测试证明 class-1 contract。

### 3.6 Ownership detection

- 将 generic detection 从裸 directory 改为 template hash evidence。
- 合并/保留 OMP ownership markers。
- legacy Windsurf 只接受 Suncode-specific hash/name。
- 更新平台 JSON/human output、init/update tests；验证 user-deleted managed file contract。

## Phase 4：Channel 状态机（A11、A12）

### 4.1 Codex failure

- `CodexCtx` 增加 per-turn terminal error state。
- 解析 failed turn、retrying/non-retry error、去重、reset。
- 保持 existing commentary/output/done ordering。

### 4.2 Idle timeout

- 从 idle probe/fire guard 移除 terminal-event 条件。
- 保留 shutting-down/child-exited/cancelled 防线。
- 覆盖完成 turn 后 reset/timeout。

### 4.3 Tests

- 运行 channel Codex adapter、supervisor idle 和相关 channel suites。

## Phase 5：CI、spec 与一致性收口

1. CI pin Python 3.9，编译 tracked Python；pycache 写 runner temp。
2. basedpyright target 改 3.9，并确认 include 覆盖 live scripts/hooks、platform Python templates。
3. 用 Suncode package filter/name，不复制 `@mindfoldhq/trellis`。
4. 更新 platform integration、filesystem safety、script conventions、commands platform/update/channel、unit-test specs。
5. 添加 source/template identity assertions，确保 Trellis dev copy 与 Suncode product copy只有预期 identity 差异。

## Phase 6：验证

### 6.1 定向验证

- Context injection / skip / active task / task meta / journal / polyrepo Python integration tests。
- Codex configurator/template、Kimi、Pi、OpenCode、OMP、Snow tests。
- Platform init/update/uninstall/detection tests。
- Channel Codex adapter和 supervisor idle tests。

Python或后端测试必须用 60 秒硬超时；超时视为失败，不无限等待。

### 6.2 全量验证

按仓库脚本实际名称执行并记录完整结果：

1. Python 3.9 tracked-script compile；
2. basedpyright；
3. root/CLI ESLint；
4. root TypeScript typecheck；
5. core → CLI build；
6. CLI full suite，必要时 core suite；
7. `git diff --check`；
8. release/build output smoke checks。

不使用当前脏 docs-site/marketplace 的 lint 或 format 作为本轮证据，也不修改其工作树。

### 6.3 GitNexus / diff review

- 运行 `detect_changes(scope="compare", base_ref="main")`。
- 对所有 HIGH/CRITICAL flows 抽查实际 diff、callers 和测试。
- `git status --short`、`git diff --stat`、`git diff --name-only` 确认只含任务允许路径。
- staging 只使用显式文件路径；`git diff --cached --name-only` 再次排除用户工作和 submodule pointer。

## Phase 7：提交与 checkpoint

### 7.1 Implementation commit

- 将 A1-A15、tests/spec、task research/design/implementation result 和验证摘要作为一组可复现实施提交。
- commit message 建议：`feat(cli): align suncode with Trellis v0.6.11`。
- 记录完整 commit hash；若 validation 未全绿，不提交也不推进 checkpoint。

### 7.2 Ledger 与 checkpoint commit

仅在 implementation commit 已验证后：

1. 在 sync ledger 顶部追加唯一 entry；
2. 记录 exclusive `v0.6.8`、inclusive `v0.6.11`、43-commit 分类、A1-A15、排除项、验证和 implementation hash；
3. 更新 `sync-state.json` 的 `last_reviewed/latest_adoption` 到官方 `v0.6.11` / `a82d4d4...`；
4. 运行 checkpoint validate/show；
5. 只暂存 ledger/state（及技能要求的必要记录），形成独立 checkpoint commit。

任何 ref mismatch、matrix 遗漏、未提交代码、ledger 缺失或 staged scope 异常都必须停止 checkpoint。

## Phase 8：完成工作

- 再次确认 checkpoint valid、task acceptance 实际满足。
- 使用 Trellis finish-work 流程记录 session。
- 归档本任务；archive/journal bookkeeping 与 implementation/checkpoint commit 分开。
- 最终报告列出：两个提交 hash、checkpoint、测试数字、GitNexus 风险、排除项、未执行项和用户脏工作保护结果。

## 实施时不得做

- 不执行 whole-tag merge、whole-range cherry-pick、`trellis update/upgrade`。
- 不创建、覆盖或 push tag。
- 不改写 Git 历史。
- 不触碰/暂存当前 `docs-site`、`marketplace` 内部修改或其他用户脏文件。
- 不因上游文件布局相同就整文件覆盖 Suncode fork 实现。
- 不在未经验证的 implementation commit 前修改 sync checkpoint。
