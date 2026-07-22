# Trellis v0.6.8 语义采纳设计

## 设计目标

以官方 `v0.6.8` commit range 作为行为规格，以当前 Suncode `main` 作为实现基线。在不复制 Trellis 产品身份、上游 dogfood 或发布元数据的前提下，把新增平台、机器接口、记忆读取、安全修复和工作流合同落入 Suncode 的现有架构。

## 总体方法

采用“证据 → 行为合同 → Suncode 适配 → 回归证据”的单向流程：

```text
official tag/ref + upstream commits/tests
  → research commit ledger / behavior matrix
  → Suncode identity + ownership transformation
  → small implementation batches
  → targeted failure/mixed-ownership tests
  → full quality gate + GitNexus change detection
  → implementation commits
  → ledger/checkpoint commit
```

不把上游文件作为覆盖模板。每个 batch 只改变当前 Suncode 实现中承担相同行为的 canonical source，并同步其生成模板、tests、spec 和必要的子模块镜像。

## 架构边界

### 1. 产品身份与生成源

- 产品 runtime root 是 `.suncode`；仓库根 `.trellis` 只服务本项目开发。
- canonical generated source 位于 `packages/cli/src/templates/**`。根 `.agents`、`.codex`、`.trellis` 中的 Trellis dogfood 文件不随上游 range 机械更新。
- 新资产统一使用 `suncode-*`、`SUNCODE_*` 和 `.suncode`；上游 `trellis-*` 只出现在研究引用或历史 manifest 文本中。

### 2. 平台 registry 与所有权

Grok 和 Kimi 都进入现有 `AI_TOOLS` / `PLATFORM_FUNCTIONS` 数据驱动注册面：

- Grok：`.grok`，pull-based，无 hooks，flat Suncode commands 与 Suncode agents。
- Kimi：`.kimi-code`，无项目 hooks，private commands-as-skills/agents，共享 `.agents/skills`。
- Pi：commands/agents/extension 仍位于 `.pi`，skills 改到共享 `.agents/skills`。
- OMP：保持上一轮 ownership-aware `.omp` detection，只增加 Bash `SUNCODE_CONTEXT_ID` bridge。
- ZCode：保留 pull-based assets 与无 hooks/settings 合同，不注册上游 native hook config。

共享 `.agents/skills` 的 canonical 内容由 neutral resolver 生成。Codex、Gemini、Pi、Kimi 写入相同 skill path 时，内容必须字节一致，manifest 只记录 Suncode 资产，uninstall 只删 manifest-owned 文件。

### 3. Update/migration 三方优先级

Update 的所有权优先级固定为：

```text
用户修改 / 其他平台资产
  > 当前 Suncode template snapshot
  > 历史 migration source
```

因此：

- `safe-file-delete` 先排除当前模板集合，再按 hash/protected/update.skip 分类。
- `rename-dir` 目标等于当前模板时，保留目标、删除 stale source 并清理旧 hash；目标有用户或其他平台内容时冲突/跳过。
- Pi migration 使用 Suncode 自己的后续版本 manifest，不复制上游 `0.6.8` 版本身份。
- migration fixture 覆盖 old-only、target-only、两者共存、相同/不同字节、额外用户文件和 Windows 分隔符。

### 4. ZCode readonly SQLite mem

把上游 final-state parser 作为一个深模块移植到 core：

- `sqlite-readonly.ts` 只负责 SQLite page、record、overflow 和 WAL stable snapshot；不执行 SQL、不写数据库、不引入 native dependency。
- `adapters/zcode.ts` 负责 ZCode schema 映射、project/cwd/time filter、compaction summary 与 task events。
- `sessions.ts`、`projects.ts` 和 CLI `mem` 只通过现有公共 mem types 接入 ZCode，不暴露 parser 细节。
- parse corruption 返回结构化错误或跳过坏记录，绝不修改 DB/WAL。

OpenCode no-op adapter保持不变。没有证据时不复用 ZCode parser 去推断 OpenCode schema。

### 5. Codex native dispatch 与 inline 默认

新增 native path，但不改变 Suncode 默认：

- `dispatch_mode` normalization 统一输出 `inline` 或 `auto`；旧 `sub-agent` 作为兼容 alias 映射到 `auto`。
- missing/invalid config 返回 `inline`，确保 fork 的当前策略不被意外翻转。
- `SubagentStart` hook 只为 `suncode-research`、`suncode-implement`、`suncode-check` 注入精确上下文；解析父 session 时禁止宽松环境 fallback。
- hook 失败 fail-open，不阻断子代理创建；agent 自身仍保留“不要再次派 implement/check”的 recursion guard。
- generated Codex `config.toml` 固定 `[agents] max_depth = 1`，避免 user/global 配置重新打开嵌套递归。

### 6. Channel sandbox 数据流

```text
CLI --sandbox string
  → parseCodexSandboxMode() validation
  → typed SpawnOptions
  → typed SupervisorConfig
  → Codex thread start params
```

默认是 `workspace-write`。非法值在 CLI 边界失败；非 Codex provider 不获得未定义的 sandbox 语义。不得在 supervisor 内用 cast 修补早期未验证字符串。

### 7. 机器接口

`suncode platforms --json`：

```json
{"platforms":[{"id":"codex","displayName":"Codex","configDir":".codex"}]}
```

- configured 集合由现有 ownership-aware detector 提供。
- JSON 输出不带 ANSI，字段名和空列表稳定。

`task.py current --json`：

```json
{"current_task":null,"source":"none","stale":false}
```

或返回 task 的 `dir/id/title/status/parent/children/branch/base_branch`。无当前任务继续返回 exit code 1。

`task.py list --json` 返回 `tasks[]`，包含持久化 `status` 与派生 `display_status`；父任务的派生 active 只影响展示，不修改 `task.json`。

### 8. 规划、SessionStart 与 OMP

- Brainstorm 的 Requirement Convergence Gate 和 PRD Convergence Pass 是两个独立门禁。最新规划摘要必须由后续用户消息批准；material changes 使旧批准失效。
- SessionStart one-shot notice 根据用户请求语言或项目既定语言选择；无证据时输出中立 `Suncode SessionStart ✓`，其余回复继续遵守用户语言。
- OMP extension 在 `tool_call` 事件中只处理 Bash；合并 env 时 derived key 在前、显式 event input env 在后，从而显式值优先。不得修改 command 或 process-wide env。

### 9. CI 与相关仓库

- 主仓 CI/publish 顺序调整为 lint/typecheck（按现有 job）→ build → test → verify artifacts；不修改发布版本和 npm identity。
- `marketplace/workflows/native/workflow.md` 作为 bundled workflow 的镜像，在 marketplace 子模块内提交。
- docs-site 更新英文/中文平台列表、multi-platform 能力、安装与 machine-readable 命令文档，在 docs-site 子模块内提交。
- 主仓最后记录两个 submodule commit；不直接采用上游 gitlink。

## 实施批次与依赖

1. **Update 安全前置**：A8/A9/A11/A13。Pi migration 必须等待 merge-safe rename-dir。
2. **Task 机器接口**：A6/A7，可独立验证 Python 脚本和生成模板 parity。
3. **平台与 OMP**：A3/A4/A10/A12，依赖批次 1 的共享 skills 迁移安全。
4. **ZCode mem**：A1，先 parser tests，后 adapter 和 fan-out。
5. **Codex/Channel/Workflow**：A14-A17；保持 inline default 和 fork 工作流门禁。
6. **Specs/docs/CI**：A19/A21，在行为稳定后同步，避免文档描述中间态。
7. **全量验证与记录**：完整质量门、实现 commits、ledger/checkpoint。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| Update 共享函数高扇出，可能误删用户文件 | GitNexus impact；所有测试使用临时 fixture；fail closed；mixed ownership 必测 |
| SQLite parser 代码量大且二进制边界复杂 | 移植 upstream final state 与全套 parser tests；不简写；parse error 分类；read-only |
| 新平台扩大 init/update/uninstall 组合矩阵 | 数据驱动 registry；neutral shared-skill content；平台注册和 mixed install integration tests |
| Codex native behavior 与 inline fork 策略冲突 | 能力与默认分离；normalization 单一函数；missing/invalid → inline；hooks fail-open |
| 子模块已有独立本地提交 | 在各自仓库核对 clean/ahead 状态，创建新 commit 后再更新主仓 pointer；不 reset/rebase |
| 用户已有主仓脏改 | 只 stage 本任务路径；提交前逐项检查 staged diff；checkpoint 不包含无关文件 |

## 回滚策略

- 每个实施批次保持可独立审查的 diff 和定向测试；失败时只撤销当前批次的本任务改动，不使用 `git reset --hard` 或覆盖用户文件。
- migration/update 测试不作用于真实工作区；失败只清理 fixture。
- 新平台若未通过 ownership 测试，不进入 docs/marketplace 或 checkpoint。
- ZCode mem 若 parser/adapter 失败，保留既有 mem 平台集合，不写任何会话数据。
- 任一 required check、子模块 commit、ledger marker 或本地实现 commit 缺失时，`sync-state.json` 保持 `v0.6.7`。
