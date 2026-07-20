# 评估并采纳 Trellis 上游版本变更

## 目标与用户价值

以官方 Trellis `v0.6.5` 为共同基线，完整评估并按 Suncode 契约移植官方 `v0.6.6`、`v0.6.7` 中有价值的行为变化。采纳范围包含完整 Oh My Pi（OMP）平台支持，以及文件系统安全、Channel 可靠性、Pi/ZCode/Codex/task/journal 等修复。

本任务的用户价值是一次性建立可追溯的上游采纳基线，避免未来跨更多版本重新追踪 OMP 依赖链，同时在任何实现中保持 Suncode 与 Trellis 的产品、配置和持久化数据相互隔离。

## 背景与已确认事实

- 上游仓库为 `https://github.com/mindfold-ai/Trellis.git`；本仓库与上游的共同基线是官方 `v0.6.5`，commit `01ec8d6503b2338194e9bd2e9dbbcf22054c1bba`。
- 两个目标版本是官方 `v0.6.6`（`41b6a460d298861991b082c7a7fbfa1f9f42fc6f`）和 `v0.6.7`（`e7c5ead4d0dfd717d11a40b6bc0c80d8af94c49a`）。
- 本地 Suncode 的同名 `v0.6.6`、`v0.6.7` tag 分别指向 `609269df46f6db37ff993de200655aa98177fabe`、`7525a8a5a15c7e93c1b938c32701cd342c4a2b4f`；同名 tag 已发生语义分叉，不能整体 merge 或 cherry-pick 官方 tag。
- 本机全局 `trellis --version` 为 `0.6.7`，仓库包版本为 `0.6.10`；`get_context.py` 显示的 `0.6.2 -> 0.6.7` 是项目内生成模板状态，不是已安装 CLI 版本。
- 初次 fork 的历史会话和归档设计明确要求：Suncode 与 Trellis 独立共存，不保留兼容层，不把 `.trellis` 迁移为 `.suncode`，也不读取、改写或删除 Trellis 的目录、环境变量、managed block 与持久化数据。
- 用户已经决定本轮纳入完整 OMP 支持。这里的“完整”指官方 `v0.6.6` 引入并在该版本内连续修正的 OMP 平台能力，不包含上游本身没有实现的任意扩展功能。
- OMP 使用第三方平台共享目录 `.omp`。Suncode 只能拥有其中带有 Suncode 命名或记录在 Suncode manifest 中的资产；仅存在 `.omp/`，或者其中只有 Trellis 资产，不能被判断为已配置 Suncode OMP。
- 完整证据、14 项采纳矩阵、官方 commit 与本地 `file:line` 位于 `research/upstream-v0.6.6-v0.6.7-adoption.md`。
- 工作树已有无关未跟踪文件 `drafts/kb-design-philosophy.md`，本任务必须保持不动。

## 需求

### R1：可追溯的语义移植

- 以官方 release、tag、commit、测试和真实代码差异为证据移植行为，不使用整 tag merge、整 tag cherry-pick 或 `trellis upgrade` 同步源码。
- 每项落地必须使用 `.suncode`、`SUNCODE_*`、`@wjptz/suncode*`、Suncode managed block 和 `/suncode...` 命令命名。
- 保留本仓 Hub、中文规划流程、Suncode workflow/spec 注入、Agent Hub、channel/mem 扩展和各平台 pull-based 适配。

### R2：文件系统与用户数据安全

- 采纳 TypeScript/Python 原子写入，避免中断后留下半文件。
- uninstall 只移除 Suncode managed block/manifest 所有的文件，并在 `.suncode/spec|tasks|workspace` 有未提交数据时 fail-closed；旁路变量只能是 `SUNCODE_ALLOW_DIRTY_UNINSTALL`。
- task archive 只允许归档 `.suncode/tasks/` 的直接任务目录，不能把仓库普通目录解析成任务。
- 模板覆盖必须先下载到临时目录，成功后再替换；临时清理失败不能遮蔽主要结果。
- `rename-dir` 只自动迁移 manifest 能证明由 Suncode 所有的资产；`traces-N.md` 改名时不能覆盖已有 `journal-N.md`。

### R3：Channel 安全与跨平台可靠性

- Channel/worker 存储 handle 必须经过统一安全名称校验，禁止绝对路径、路径分隔符、`.`/`..` 和路径逃逸；discovery 遇到旧非法目录时跳过而不是整体失败。
- stdout 行处理必须保持输入顺序并施加背压，避免高频输出造成事件乱序和状态竞态。
- Windows npm Node-script shim 必须通过 `process.execPath` 启动，保持本地 `node_modules/.bin` 优先且 `shell: false`。

### R4：现有平台与工作流修复

- Pi 运行时上下文迁移为不可见持久化消息，保持用户输入不被改写、`systemPrompt` 跨 turn 字节稳定，并支持项目级 `.pi/settings.json` 相对 `sessionDir`。
- ZCode 生成路径切换到 `.zcode/agents/`，保留 Suncode pull-based prelude，并安全管理旧 `.zcode/cli/agents/` 资产。
- Codex inline 模式不生成无消费方的 `implement.jsonl`/`check.jsonl`；sub-agent 模式继续生成真实清单。
- task create 防止重复日期前缀，支持 `--no-start`，对空描述和激活来源给出明确反馈。
- journal 遇到已删除的 task branch 时回退到真实当前分支，而不是继续记录 stale branch。

### R5：完整 OMP 平台支持

- 在平台单一真源中注册独立 `omp` 平台、`--omp` CLI flag、`.omp` config root 和 `common + omp` 模板集合；不得伪装成 `pi`。
- init/update 能生成和追踪 Suncode 命名的 OMP commands、skills、research/implement/check agents 与 `.omp/extensions/suncode/index.ts`；command YAML frontmatter 和 implement/research agent 的 `model: pi/task` 必须完整保留。
- OMP extension 必须覆盖上游最终行为：session-start 富上下文、主会话与子代理精确上下文、input cache 预热、`before_agent_start`、`context`、`session_before_compact`、压缩边界识别、压缩后再注入、session-aware active task 和 stale session identity 防护。
- OMP 使用原生 task 能力，不重复通过 CLI 启动子代理；平台检测、task store 和 workflow 文案必须认识 `omp`。
- update/uninstall 必须按 manifest 和 Suncode 唯一资产识别所有权。Trellis-only `.omp` 不得触发 Suncode OMP 自动更新，卸载后必须保留 Trellis/用户 OMP 文件。
- 上游没有提供独立 OMP `mem` reader，因此本轮不把 `suncode mem --platform omp` 作为上游等价能力；实施时必须记录 OMP session 格式与现有 Pi adapter 的兼容性结论，避免未来重复调研或误宣称支持。

### R6：实施与验证纪律

- 实施前对每个待修改符号运行 GitNexus upstream impact；HIGH/CRITICAL 风险必须先报告用户。
- 按文件系统安全、Channel、OMP、其他平台工作流四个边界分批实现和定向验证，不能把全部上游提交一次性套用。
- 每批都必须包含失败路径、所有权隔离和跨平台回归测试；最后运行 CLI/core 的定向测试、完整测试、typecheck、build，并在提交前运行 GitNexus `detect_changes(scope="compare", base_ref="main")`。
- 未经用户审阅本规划，不运行 `task.py start`，不修改产品代码，不提交或推送。

## 验收标准

- [x] AC1：初次 fork 基线、两个目标上游版本和同名 tag 分叉均有可复核证据。
- [x] AC2：14 项实质性变化均可追溯到官方 commit、测试或本地 `file:line`，并形成采纳矩阵。
- [x] AC3：Suncode 独立性、本地特有行为和不可采纳内容已明确。
- [x] AC4：用户已明确决定纳入完整 OMP 平台支持。
- [x] AC5：`design.md` 描述语义移植、OMP 生命周期、共享目录所有权、兼容策略、验证和回滚边界。
- [x] AC6：`implement.md` 包含可解析的 `## 实施清单`、依赖顺序、风险点和验证命令。
- [x] AC7：用户审阅最终规划并明确批准进入实施。

## 非目标

- 不追求与上游仓库逐文件一致，不覆盖 Suncode 版本号、tag、release manifest 或包身份。
- 不同步官方 docs-site、marketplace submodule pointer、二维码、dogfood `.omp`、journal、task archive 或发布记录。
- 不迁移、重命名、删除或接管 `.trellis`、`TRELLIS_*`、Trellis managed block、Trellis OMP 资产或 `~/.trellis/channels`。
- 不因 OMP 基于 Pi 而复用 `.pi` 持久化身份，也不在缺少格式证据时声称支持 OMP 会话历史检索。
- 当前规划阶段不发布 npm 包、不创建 PR、不提交或推送。
