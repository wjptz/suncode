# 对齐 Trellis v0.6.8

## 目标

从已验证的官方 Trellis `v0.6.7` 检查点继续，完整审查 `v0.6.7..v0.6.8` 的 41 个可达提交，并把有价值的产品行为、安全修复和可维护性合同语义移植到 Suncode。对齐后的实现必须保持 Suncode 独立身份、数据所有权、平台适配和工作流扩展，最终把同步 ledger 与检查点推进到官方 `v0.6.8`。

## 背景与已确认事实

- 官方仓库是 `https://github.com/mindfold-ai/Trellis.git`，本地 `upstream` URL 与同步状态记录完全一致。
- 当前独占起点是官方 `v0.6.7` commit `e7c5ead4d0dfd717d11a40b6bc0c80d8af94c49a`。
- 官方 `v0.6.8` 是轻量 tag，commit 为 `dc68f5a92a68489b681c511f4a784e413d724e85`；已抓取到隔离 ref `refs/remotes/upstream/releases/v0.6.8`，且祖先校验通过。
- 精确范围共有 41 个可达提交；逐提交分类与行为证据位于 `research/upstream-v0.6.8-adoption.md`。
- Suncode 当前包版本是 `0.6.10`，不得改成上游 `0.6.8`。
- 工作树在任务创建前已有用户未提交改动；本任务不得覆盖、格式化、清理或提交这些改动。
- 当前任务是 Codex inline 模式；规划批准前不运行 `task.py start`，实施和检查由主会话直接完成。

## 需求

### R1：官方发布身份与审查完整性

- 必须只使用官方 remote tag、隔离 release ref 和 Git 对象作为版本身份，不能使用本地同名 tag。
- 必须覆盖 `e7c5ead4..dc68f5a9` 中全部 41 个提交；每个提交都要记录行为、证据、Suncode 现状、采纳决定、理由和验证方式，merge/bookkeeping 也不能静默丢弃。
- 目标不是补丁等价，而是行为和不变量等价。

### R2：Suncode 身份与所有权隔离

- 所有运行时资产继续使用 `.suncode`、`SUNCODE_*`、`@wjptz/suncode*`、Suncode managed blocks 和 Suncode 命令前缀。
- 不得读取、迁移、改写、删除或声明拥有用户的 Trellis 数据、变量、managed blocks 或 channel 数据。
- 共享 `.agents`、`.omp`、`.pi`、`.zcode`、`.grok`、`.kimi-code` 根必须以 Suncode manifest 或唯一命名资产证明所有权。
- 仓库根 `.trellis/` 继续只表示本项目开发工作流，不能作为 `.suncode` 产品兼容层批量改写。

### R3：平台能力对齐

- 增加 Suncode 原生 Grok Build 和 Kimi Code 支持，覆盖 registry、CLI flag、configured detection、init/update/uninstall、commands/skills/agents、workflow 平台分组与测试。
- Pi skills 从 `.pi/skills` 迁移到共享 `.agents/skills`，但必须先实现 merge-safe `rename-dir`，保证 canonical current templates、其他平台资产和用户文件不被旧 source 覆盖。
- OMP Bash tool 调用必须获得当前 `SUNCODE_CONTEXT_ID`，显式 per-call env 覆盖优先，非 Bash tool 和命令字符串不得改变。
- ZCode 只采纳零依赖 readonly SQLite mem；继续保持 Suncode pull-based、无 hooks/settings 的集成合同。

### R4：Codex、Channel 与工作流对齐

- Codex 增加 native `SubagentStart` 精确上下文注入、统一 dispatch-mode normalization 和 `agents.max_depth=1` 递归上限。
- Suncode 的产品默认和本项目执行模式继续是 `inline`；native dispatch 是可选能力，不能让 invalid/missing config 自动切换到 sub-agent。
- Channel 为 Codex worker 增加类型安全的 `--sandbox`，仅接受 `read-only`、`workspace-write`、`danger-full-access`，默认维持 `workspace-write`。
- Brainstorm 增加 requirement convergence 和“最终规划摘要后的后续显式实施批准”门禁；SessionStart 确认按用户/项目语言选择，neutral fallback 使用 Suncode 品牌。

### R5：机器接口与任务分支语义

- 增加 `suncode platforms --json`，稳定输出 `{platforms:[{id,displayName,configDir}]}`，且复用 ownership-aware platform detection。
- 增加 `task.py list --json` 和 `current --json`，保持 no-task exit code、active task schema、filter 和 parent display status 合同。
- task create 默认记录仓库真实默认分支，支持 `--base-branch` override；无法解析时明确告警并回退，validate/archive 对 stale recorded branch 只告警不阻断。

### R6：Update、模板与 YAML 安全

- 历史 `safe-file-delete` 不得删除当前模板重新引入的文件。
- `rename-dir` 在 canonical target 已含当前模板时不得用 stale source 覆盖；hash tracking 必须同步清理。
- Registry template 下载不再使用 `preferOffline`，但上一轮已经建立的 temp-first overwrite、失败保留旧内容和 best-effort cleanup 不能回退。
- 普通 command 与 OMP command frontmatter 的 description 必须输出为安全引用 YAML。

### R7：CI、规范与文档

- 主仓 CI 和 publish workflow 必须 build 后再 test，与本仓 unit-test spec 保持一致。
- 不采纳上游“pre-commit 初始化 submodule 并跑全量测试”的策略；本仓继续保持 lint-staged 的快速 pre-commit，完整测试放在 CI 和任务质量门。
- 更新 Suncode 主仓 specs/README、docs-site 双语平台文档和 marketplace native workflow mirror；不得直接复制上游 submodule pointer。

### R8：验证、提交与同步记录

- 每个新行为都必须覆盖 happy path、failure path、mixed ownership 和相关跨平台场景。
- 完成定向测试后必须运行 CLI/core 全量测试、lint、typecheck、build、Python lint、`git diff --check` 和 GitNexus `detect_changes(scope="compare", base_ref="main")`。
- 先提交已验证的相关子模块与主仓实现，再追加 ledger、推进 checkpoint、重新 validate，并以独立 checkpoint commit 记录游标。
- 不 push、不发布 npm、不创建或覆盖 tag。

## 验收标准

- [ ] AC1：`research/upstream-v0.6.8-adoption.md` 对 41 个上游提交逐一分类，无缺失 commit，官方 target/ref/祖先证据可复现。（R1）
- [ ] AC2：实现 diff 不引入 Trellis 运行时身份，不触碰用户已有未提交文件，不把仓库根 `.trellis` 当产品迁移目标。（R2）
- [ ] AC3：`suncode init --grok` 与 `--kimi` 能生成 Suncode 命名资产；update/uninstall 幂等并保留混合目录中的用户和其他产品文件。（R3）
- [ ] AC4：Pi 共享 skills 迁移在 old-only、target-only、相同/不同模板、用户文件混合场景均不覆盖 canonical target；配置不再声明 private `.pi/skills`。（R3、R6）
- [ ] AC5：ZCode mem 能只读解析 DB/WAL、损坏数据和 compaction；Suncode 不新增 ZCode hooks/settings，pull-based agents 不回归。（R3）
- [ ] AC6：Codex inline 默认保持不变；native sub-agent opt-in 能获得正确 task context，缺失/stale context 不阻断 spawn，`max_depth=1` 防递归。（R4）
- [ ] AC7：Codex channel sandbox 三个合法值类型贯通，非法值 fail fast，默认值与非 Codex provider 行为明确。（R4）
- [ ] AC8：最新规划摘要未获得后续明确批准时，task 不能 start；批准失效条件、语言策略和所有模板镜像有回归测试。（R4）
- [ ] AC9：`suncode platforms --json` 与 `task.py list/current --json` 的 schema、exit code、过滤和无 ANSI 合同通过测试。（R5）
- [ ] AC10：默认分支、stale branch、reintroduced template、rename-dir merge、network-first registry、OMP Bash env 和 YAML frontmatter 的成功/失败测试通过。（R5、R6）
- [ ] AC11：CI/publish 顺序、Suncode specs、README、docs-site 和 marketplace mirror 与实现一致；`.husky/pre-commit` 未被本任务修改。（R7）
- [ ] AC12：受影响定向测试与完整质量门通过；任何未执行项明确记录原因，GitNexus 影响与变更检测结果完成复核。（R8）
- [ ] AC13：实现 commit、相关子模块 commit、ledger marker、`sync-state.json` 游标和 checkpoint commit 可追溯；最终 `sync_checkpoint.py validate` 成功，`last_reviewed` 为官方 `v0.6.8`。（R8）

## 不在范围内

- 上游 package version、npm identity、release tag、二维码、任务归档、开发者 journal、dogfood 配置和纯 submodule pointer。
- 运行 `trellis update`、`trellis upgrade`、整 tag merge 或整个 range cherry-pick。
- ZCode native hooks/settings，OMP 离线 mem adapter，OpenCode SQLite adapter，以及把任一平台持久化格式伪装成另一个平台。
- 修改或提交用户现有 `AGENTS.md`、`CLAUDE.md`、GitNexus skill 文件和 `drafts/kb-design-philosophy.md`。
- push、npm 发布、数据库破坏性操作和 Git 历史改写。

## 实施门禁

当前没有阻塞性开放问题。进入实现仍必须满足两项顺序门禁：

1. 用户在本规划最终摘要之后，用新的消息明确批准最新 `prd.md`、`design.md` 与 `implement.md`。
2. 获得批准后运行 `task.py start`，再加载 `trellis-before-dev`，对每个将修改的现有函数、类或方法执行 GitNexus upstream impact；HIGH/CRITICAL 先报告再编辑。
