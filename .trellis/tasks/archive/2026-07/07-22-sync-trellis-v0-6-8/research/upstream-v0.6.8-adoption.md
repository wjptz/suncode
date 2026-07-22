# Trellis v0.6.8 上游采纳评估

## 结论摘要

官方 `v0.6.8` 相对当前检查点 `v0.6.7` 不是单一修复，而是一个包含 41 个可达提交、两条主要合并支线的跨层版本。建议按行为语义采纳，不合并 tag、不整段 cherry-pick，也不运行 `trellis update` / `trellis upgrade` 作为源码同步手段。

本轮建议形成 19 组行为决策：

- 改造后采纳：Grok Build、Kimi Code、ZCode SQLite mem、Codex 原生子代理 hook、Codex channel sandbox、Pi 共享 skills、OMP Bash 上下文桥接、machine-readable platform/task state、默认分支记录、迁移安全、frontmatter、SessionStart 语言策略、planning approval gate、CI build-before-test、相关规范和文档镜像。
- 已等价：`v0.6.7 fleet review batch` 的原子 Python 写入、task archive 边界、task 激活诊断，以及 Pi 展示名。
- 有意拒绝或排除：ZCode 原生 hooks/settings（保留 Suncode pull-based 合同）、上游全量 pre-commit 测试、上游版本号和发布身份、二维码、上游任务/日志、纯 submodule pointer 和 merge bookkeeping。

最高风险不在新平台模板本身，而在四个共享边界：

1. `.agents/skills/` 是多平台共享根，Pi 迁移必须合并当前模板，不能用旧 `.pi/skills/` 覆盖 canonical target。
2. `packages/cli/src/commands/update.ts` 同时承担历史 manifest、当前模板和用户修改的所有权判定。
3. Codex native hook 只能作为可用能力加入；Suncode 当前 `inline` 默认和本地规划门禁不能被上游 `auto` 默认机械覆盖。
4. ZCode 的 SQLite 会话读取可以独立采纳，但 hooks/config 必须拒绝，避免破坏 Suncode 已确立的 pull-based 集成。

## 官方版本与本地边界

| 对象 | 证据 |
| --- | --- |
| 官方仓库 | `https://github.com/mindfold-ai/Trellis.git`；本地 `upstream` URL 精确匹配 `references/sync-state.json` |
| 独占起点 | 官方 `v0.6.7`：`e7c5ead4d0dfd717d11a40b6bc0c80d8af94c49a` |
| 目标版本 | 官方轻量 tag `v0.6.8`：`dc68f5a92a68489b681c511f4a784e413d724e85` |
| 隔离 ref | `refs/remotes/upstream/releases/v0.6.8`，通过 `git fetch --no-tags` 获取，未触碰本地同名 tag |
| 祖先关系 | `git merge-base --is-ancestor e7c5ead4... dc68f5a9...` 返回成功 |
| 精确范围 | `git rev-list --count e7c5ead4...dc68f5a9...` = `41` |
| Suncode 版本身份 | `@wjptz/suncode` 与 `@wjptz/suncode-core` 当前均为 `0.6.10`；不得改写成上游 `0.6.8` |
| 当前工作树 | 任务创建前已有 `AGENTS.md`、`CLAUDE.md`、5 个 GitNexus skill 文件和 `drafts/kb-design-philosophy.md` 的用户改动；必须保持不动且不得混入同步提交 |
| 子模块 | `docs-site` 工作树干净；`marketplace` 工作树干净且本地 `main` 相对其 origin ahead 1（上一轮同步提交） |

### 调研限制

- `sync_checkpoint.py validate` 成功，当前游标是官方 `v0.6.7`。
- YCE 本地检索返回 `result-present=true`，但远端语义检索缺少 YCE key，联网侧 `fetch failed`；官方事实改用 `git ls-remote --tags upstream`、隔离 fetch、Git 对象和源码/测试核验。
- GitNexus 当前索引提供平台注册、update/migrations、task runtime、mem、Codex/channel 的执行流与符号定位；实施前仍必须针对每个将修改的现有函数、类或方法逐一运行 upstream impact。
- 当前只完成规划研究，尚未运行代码测试、lint、typecheck、build 或 GitNexus `detect_changes`。

## 不可破坏的 Suncode 分叉合同

- 运行时继续使用 `.suncode`、`SUNCODE_*`、`@wjptz/suncode*`、Suncode managed blocks 和 `/suncode...` 命令。
- 不读取、迁移、重写或删除用户的 `.trellis`、`TRELLIS_*`、Trellis managed blocks 或 `~/.trellis/channels`。
- 仓库根 `.trellis/` 是本项目的开发工作流状态，不是产品兼容层；上游 dogfood `.trellis` 变更不能直接复制进来。
- 保留 Hub、Agent Hub、中文规划产物、session-scoped task identity、channel/mem 扩展、Codex inline 默认和 ZCode pull-based 集成。
- 共享平台根只能按 Suncode manifest 或 Suncode 唯一命名资产证明所有权，目录存在本身不是所有权证据。

## 行为级采纳矩阵

| ID | 行为 | 上游证据 | 当前 Suncode 证据 | 决策与理由 | 实施验证 |
| --- | --- | --- | --- | --- | --- |
| A1 | ZCode 零依赖只读 SQLite mem、WAL 快照、会话/压缩语义 | `200365b45a2afa68ff55c66a93d004303332f616`；`packages/core/src/mem/adapters/zcode.ts`、`internal/sqlite-readonly.ts`、`sqlite-readonly.test.ts`；`69017e67d77957d374a249de435042cde561a56f` 增加 record header 越界拒绝 | `packages/core/src/mem/sessions.ts:182-318` 当前只聚合 Claude/Codex/OpenCode/Pi；OpenCode adapter 因 native `better-sqlite3` 风险有意 no-op（`opencode.ts:2-34`）；无 ZCode adapter | **改造后采纳。** 上游 parser 不引入 native 依赖，符合 Windows 政策；只增加 ZCode source，不借机恢复或伪造 OpenCode SQLite 支持 | 主 DB、WAL、overflow page、损坏 header、unstable snapshot、project/cwd/time filter、compaction summary、session not found、CLI 输出和 Windows 无 native 安装 |
| A2 | ZCode 项目 hooks/config 与 native subagent context | `200365b4...` 的 `configurators/zcode.ts`、`templates/zcode/config.json`、shared hooks；`044390c1...` 平台分组修正 | Suncode `packages/cli/src/templates/zcode/agents/suncode-{research,implement,check}.md` 已有 pull-based guard；fork boundary 明确要求保留 ZCode pull-based 行为；当前无 hooks/settings | **有意拒绝。** 采纳会覆盖已经验证的 Suncode 平台适配，并扩大共享配置所有权；A1 mem 不依赖此行为 | 回归确保 init/update/uninstall 不新增 `.zcode/config.json` 或 hooks，不删除现有 pull-based agents/prelude |
| A3 | Grok Build 平台 | `5c28b8edf35c70838c7efae57ccd0b34da370538`；`AI_TOOLS.grok`、`configurators/grok.ts`、Grok agents/tests；pull-based、无 hooks、`.grok` | `AITool`/`TemplateDir`/`CliFlag` 和 `configurators/` 均无 Grok（`ai-tools.ts:7-31`） | **改造后采纳。** 使用 Suncode 命名、`.grok/commands/suncode-*.md`、Suncode agents 和 pull-based prelude；不复制上游 task/journal | 类型注册、`suncode init --grok`、configured detection、init/update/uninstall、agent recursion guard、workflow 平台分组、mixed user files |
| A4 | Kimi Code 平台 | `bfa7f99d6db10dba650cf4eb7f72b18d26540e23`；`.kimi-code`、共享 `.agents/skills`、private commands-as-skills、agents/tests | 当前仅把 Kimi 视为读取 `.agents/skills` 的泛用 agent，未注册 configured platform；无 `kimi.ts` | **改造后采纳。** 增加显式平台能力，同时通过 neutral resolver 与 Codex/Gemini/Pi 对共享 skill 做字节级去重 | `suncode init --kimi`、commands/agents/shared skills、重复平台组合、manifest ownership、update/uninstall、文档平台计数 |
| A5 | `suncode platforms --json` 稳定机器接口 | `5dbebd69d05e98150402a495daf0472d3c442408`；上游 schema `{platforms:[{id,displayName,configDir}]}` 和 integration test | GitNexus 定位 `getConfiguredPlatforms()` 于 `configurators/index.ts:525-539`；CLI 无 `platforms` 命令 | **改造后采纳。** 命令改为 Suncode 名称，复用 ownership-aware detection，不以目录存在误报 OMP | 空列表、多个平台、稳定字段与顺序、JSON 无 ANSI、人类输出、Trellis-only `.omp` 不误报 |
| A6 | `task.py list/current --json` 与 parent display status | `4d420b51b77e7b696df9cf3f6a01962a019894d0`；稳定 task/current schema、`_display_status()`、regression tests | `packages/cli/src/templates/suncode/scripts/task.py:168-265,446-477` 只有文本/`--source`，无 JSON | **改造后采纳。** 路径和身份切换为 `.suncode`，保留 Suncode task 扩展字段但不破坏上游核心 schema | no-task exit 1 + JSON null、active task fields、mine/status filters、parent active display 不改持久化 status、无 ANSI |
| A7 | 默认分支解析、`base_branch` stamp、stale branch 警告、create override | `113bc5fb5824bc9eeb679bb0416092afbbcceb2e`、`9846fe662e05e7da494066874e7961a465f23d56`；`resolve_default_branch()`、`branch_exists_locally()`、`--base-branch` | `common/git.py` 只有 `run_git()`；task create 直接记录当前 branch（`task_store.py:365-395`）；已有手动 `set-base-branch` | **改造后采纳。** 默认分支优先 `origin/HEAD`，失败时明确 warning 并回退；显式 override 优先 | main/master/自定义默认分支、无 origin、detached HEAD、显式 override、validate/archive stale warning 不阻断 |
| A8 | reintroduced template 不被历史 safe-file-delete 删除 | `4d1e2c67a1d59c46d215604cd6250c8f1c95b650`；`collectSafeFileDeletes(...currentTemplatePaths)` | 当前 `collectSafeFileDeletes()` 不接收当前 template set（`update.ts:229-265`），存在删除重新引入模板的风险 | **直接语义采纳。** 当前模板所有权优先于旧 manifest | reintroduced template、真实 deprecated template、modified/protected/update.skip、breaking bypass |
| A9 | rename-dir 合并不能以 stale source 覆盖 canonical target | `a56ebbd327d715983bbf54afb55284cd79d2a5c6`；`dirMatchesCurrentTemplates()`、模板 map 传入 execution | 当前 classification 允许 target 为安全模板时删除 target 再整体 rename source（`update.ts:1338-1430,1649-1811`） | **改造后采纳。** target 已等于当前模板时删除旧 source 并修正 hashes；target 含用户/其他平台资产时 fail closed | `.pi/skills` + `.agents/skills` 共存、相同/不同字节、额外用户文件、hash prune、Windows path |
| A10 | Pi skills 从私有 `.pi/skills` 迁到共享 `.agents/skills` | `31a36d3a1ab9d6a0c77056f83aece00ad6157ac8`；neutral resolver、0.6.8 rename-dir migration、Pi tests | `configurators/pi.ts:43-50,83-88` 注释明确当前仍使用 `.pi/skills` 且迁移 deferred | **改造后采纳。** A9 是安全前置；manifest 使用 Suncode 自有下一版本线，不复制上游 `0.6.8` 身份；共享内容必须与 Codex/Gemini/Kimi 字节一致 | 仅 Pi、Pi+Codex、Pi+Gemini、旧 private root、canonical target、用户文件、settings 不再声明 private skills |
| A11 | Registry template download 不再 `preferOffline` | `c3275dece44b7ed22bf639ab4c2d075a08048aef`；三种 strategy 测试 | `template-fetcher.ts:915,939,973` 三处仍传 `preferOffline: true` | **直接语义采纳。** Registry 应优先拿当前内容，direct fallback 保持 | skip/overwrite/append 均不传 preferOffline；网络失败 fallback、temp-first overwrite 与 cleanup 仍保持上一轮安全合同 |
| A12 | OMP Bash tool 注入 session context env | `4a20e4b51ad0e74f23d03da4f43e842eacef30fa`；`tool_call` 对 Bash 的 env 合并与测试 | Suncode OMP 仅在 extension 自己的 `spawnSync(get_context.py)` 注入 `SUNCODE_CONTEXT_ID`（`index.ts.txt:143-160`）；未注册 `tool_call` | **改造后采纳。** 注入 `SUNCODE_CONTEXT_ID`，显式 per-call env 优先，不改 command 字符串，不影响非 Bash tool | derived session/file key、显式 env override、inline assignment 原样、非 Bash 不变、缺 key 不变、OMP mixed ownership |
| A13 | 生成 command YAML frontmatter description 始终安全引用 | `2d395e2a24d5ab0fa1a449f2e77b8f462f189bbf`；`JSON.stringify(description)` 同时覆盖普通/OMP command | 当前 `wrapWithCommandFrontmatter` / `wrapWithOmpFrontmatter` 直接插值（`shared.ts:289-326`） | **直接语义采纳。** 不改 agent loader；这里是 command frontmatter 生成合同 | 含 `: `、引号、反斜杠和 Unicode 的 description 可解析；普通/OMP snapshot 同步 |
| A14 | Brainstorm 最终摘要后显式实施批准 | `b72bbf137b8d8a5b04098e1a2da7da54a91ec371`；Requirement Convergence Gate、后续消息批准、material change 重审 | 当前技能已要求任务创建/实现分离和 PRD convergence，但没有完整 final-summary subsequent approval 合同 | **改造后采纳。** 保留中文规划产物与 Suncode task/workflow 名称；这也是本任务结束规划的门禁 | 所有生成 skill/prompt 镜像一致；无决策时也需最终摘要；旧批准不生效；material artifact change 重审；workflow gate 不矛盾 |
| A15 | SessionStart 首句确认按用户/项目语言选择 | `c0b206577d3145968beb4cbed8a4608c45bcdc0c`；neutral fallback `Trellis SessionStart ✓` | Suncode Codex/shared/Pi/OpenCode 模板当前强制中文固定句（如 `codex/hooks/session-start.py:94-100`） | **改造后采纳。** 品牌改为 `Suncode SessionStart ✓`；项目/用户明确中文时仍输出中文 | 中文项目、英文请求、无语言证据 fallback、one-shot、不影响后续回复语言 |
| A16 | Codex native SubagentStart context、dispatch normalization、`max_depth=1` | `4edfa66065ea7d26f0399014aacbc611c8866056`、`ccd29ac5d733327056c4242518b3e2717aee2f48`、`3d0aaea57457447f9feb8fb57ffbd29112191067`；`51a5674...` 修正文案 | 当前只有 SessionStart/UserPromptSubmit，`_codex_mode_banner()` 和 breadcrumb 各自解析 `inline|sub-agent`，无 `SubagentStart`/`max_depth`；项目明确 inline 默认 | **改造后采纳，但保留 inline 默认。** 新 hook 只服务显式 sub-agent/auto 模式；支持旧 `sub-agent` alias；统一 normalization，失效配置回退 inline；agent TOML 继续保留 recursion guard | hook event snake/camel、父 session 严格 task 解析、stale/missing 时不阻断 spawn、research/implement/check 精确上下文、inline 无 JSONL/不 dispatch、max depth 防递归 |
| A17 | Codex channel worker `--sandbox` override 与类型贯通 | `8d53fcbf178e023d3dae5cd1fd8c73a6555f4157`、`39ca6b9126467b1e32ed6888ffd6a74a73d72b1b` | 当前 channel adapter/supervisor 无 `CodexSandboxMode`，GitNexus 显示 spawn→supervisor 是共享执行流 | **改造后采纳。** 仅 Codex provider 接受三种模式，默认保持 `workspace-write`；无字符串 cast 穿透 | 三个合法值、非法值 fail fast、非 Codex 拒绝或忽略策略明确、CLI→SpawnOptions→Supervisor→thread params 类型一致 |
| A18 | 0.6.7 fleet hardening：Python atomic write、archive root、activation diagnostics、OpenCode rationale | `c6f85dc796dc0306016444ecc8d5a71e6219a6a9` | Suncode 模板已具备 `io.py:27-54` 原子写、`task_utils.py:73-101` direct-child 边界、task create activation diagnostics（`task_store.py:459-488`） | **已等价，不重复改。** 只在最终回归中保留现有测试 | Python fdopen/replace failure、archive root/source rejection、activation import/context/pointer failure；不得回退现有 Suncode 扩展 |
| A19 | CI/publish build 在 test 前 | `65a83d7d28b75547e35e28d78763f63ec269cbb0`、`dc68f5a92a68489b681c511f4a784e413d724e85` | 当前 `.github/workflows/ci.yml:44-57` 是 typecheck→lint→test→build；本仓 unit-test spec 明确 CI 应 lint→build→test | **采纳。** 这是本仓已有 spec 的一致性修复；publish 同步，避免 CLI integration 找不到 dist | YAML 顺序、build 失败阻止 tests、测试仍全量执行、release preflight 不变 |
| A20 | 全量 pre-commit 测试与自动 submodule init | `0bd859cace62ac3db061e44d27ee43347ed634c9` | `.trellis/spec/cli/unit-test/index.md` 明确 pre-commit 只做 lint-staged，避免开发者绕过；完整测试属于 CI | **有意拒绝。** 上游仓库事故修复不适合覆盖 Suncode 已记录的本地开发策略；Git env 泄漏可在独立任务中针对性评估 | 确保本轮不改 `.husky/pre-commit`；CI 与手工质量门仍覆盖全测试 |
| A21 | Specs、README、docs-site 与 marketplace workflow mirror | `ccf95fcf877441b10ebb6d3990ea4fb2f94286db`、`986500cfc42d9463c53a1fa8d5a5f5b4afaa50d1`、`26ca25f...` 的 changelog evidence | Suncode docs 当前写 18 个平台注册，Kimi 仅被描述为泛用 skills consumer；marketplace native workflow 无 Grok/Kimi | **改造后采纳产品文档，不复制 pointer。** 更新主仓 spec/README、docs-site 双语页面、marketplace canonical mirror；子模块各自提交，再更新主仓 gitlink | 平台数量和能力表、命令示例、workflow 平台分组、canonical mirror parity、两个子模块 clean 且提交可追溯 |
| A22 | Pi 展示名缩短 | `65785cf09fddf06596c7033b9c19da3ea39f3898` | 当前 `AI_TOOLS.pi.name` 已是 `"Pi Agent"`（`ai-tools.ts:396-397`） | **已等价。** 不重复改 | `platforms` 人类/JSON 输出保持简短展示名 |
| A23 | 上游版本、release manifest、QR、tasks/journals、merge 与 submodule pointer bookkeeping | `04f78e0...`、`26ca25f...`、`c9011ae...`、8 个 merge commit 及上游归档/工作区文件 | Suncode 有独立版本 `0.6.10`、独立任务/工作区和相关子模块提交历史 | **排除。** 仅把 release manifest changelog 当行为目录；不复制身份和维护记录 | package version 不变；不新增上游 QR/task/journal；不覆盖本地 tag；只提交本轮 Suncode 产物 |

## 41 个上游提交完整分类

下表保证 `e7c5ead4..dc68f5a9` 中每个可达提交都有记录。Merge 行不单独复制代码；其可交付行为由父提交对应的 A 项覆盖。

| # | 上游提交与主题 | 行为映射 | 分类与理由 |
| ---: | --- | --- | --- |
| 1 | `200365b45a2afa68ff55c66a93d004303332f616` `hooks & mem` | A1、A2 | ZCode mem 改造后采纳；ZCode hooks/config 有意拒绝 |
| 2 | `c036b8a0b4b02e14062655188110023b4a9e460f` `Merge origin/main into feat/zcode-2support` | A1、A2、A23 | 合并集成，无独立产品实现；冲突结果由最终 ZCode 状态覆盖 |
| 3 | `044390c10280f78a6e8af9e11d21bc8f8d2a33fd` `hooks & mem` | A1、A2 | 测试/平台分组跟进；按拆分决策采纳或拒绝 |
| 4 | `69017e67d77957d374a249de435042cde561a56f` `hooks & mem` | A1 | SQLite record header 越界 hardening，采纳 |
| 5 | `04f78e0d1f6aa290e139ec9bf9db4c66d2a1ecfe` `chore: refresh WeChat group QR...` | A23 | 上游社区资产，排除 |
| 6 | `5c28b8edf35c70838c7efae57ccd0b34da370538` `feat(cli): add Grok Build platform support (#433)` | A3、A21 | 改造后采纳 |
| 7 | `986500cfc42d9463c53a1fa8d5a5f5b4afaa50d1` `chore: bump marketplace submodule...` | A21、A23 | pointer 排除；本地 Suncode workflow mirror 语义采纳 |
| 8 | `0bd859cace62ac3db061e44d27ee43347ed634c9` `chore: run full test suite in pre-commit...` | A20 | 有意拒绝，服从本仓快速 pre-commit spec |
| 9 | `2d395e2a24d5ab0fa1a449f2e77b8f462f189bbf` `fix(configurators): quote YAML frontmatter...` | A13 | 直接语义采纳 |
| 10 | `4d1e2c67a1d59c46d215604cd6250c8f1c95b650` `fix(update): preserve reintroduced templates` | A8 | 直接语义采纳 |
| 11 | `4a20e4b51ad0e74f23d03da4f43e842eacef30fa` `fix(omp): bridge session context into bash env` | A12 | Suncode env/name 改造后采纳 |
| 12 | `b72bbf137b8d8a5b04098e1a2da7da54a91ec371` `fix(brainstorm): require explicit planning approval` | A14 | 中文/Suncode 工作流改造后采纳 |
| 13 | `24dcb2f1d546e9e9ca72b8dbb0c5d383b6ce2af9` `Merge remote-tracking branch 'origin/main' into pr-411-zcode` | A1、A2、A14、A23 | 合并集成；无独立 transplant |
| 14 | `937a1f41c2c9fc014933a3967b3e7cce9fed96a7` `Merge pull request #411...zcode` | A1、A2、A23 | 合并集成；最终 ZCode 行为已分类 |
| 15 | `c6f85dc796dc0306016444ecc8d5a71e6219a6a9` `fix: 0.6.7 fleet review batch...` | A18 | 当前 Suncode 已等价，保留回归 |
| 16 | `51a5674ce6ce5a12cb585c5dcb21e7b76a51bdbc` `docs: correct Codex inline-default rationale` | A16 | 修正事实文案，结合 dispatch normalization 改造后采纳 |
| 17 | `c0b206577d3145968beb4cbed8a4608c45bcdc0c` `fix(hooks): adapt SessionStart acknowledgment language` | A15 | Suncode 品牌改造后采纳 |
| 18 | `4edfa66065ea7d26f0399014aacbc611c8866056` `feat(codex): enable native subagent dispatch` | A16 | 改造后采纳，保留 inline 默认 |
| 19 | `c3275dece44b7ed22bf639ab4c2d075a08048aef` `fix(cli): drop preferOffline...` | A11 | 直接语义采纳 |
| 20 | `8d53fcbf178e023d3dae5cd1fd8c73a6555f4157` `feat(channel): allow overriding Codex worker sandbox mode` | A17 | 改造后采纳 |
| 21 | `31a36d3a1ab9d6a0c77056f83aece00ad6157ac8` `fix(pi): write shared skills to .agents/skills/` | A9、A10 | 在 merge-safe 前置下改造后采纳 |
| 22 | `5dbebd69d05e98150402a495daf0472d3c442408` `feat(cli): add trellis platforms --json` | A5 | Suncode CLI 改造后采纳 |
| 23 | `4d420b51b77e7b696df9cf3f6a01962a019894d0` `feat(scripts): add --json output to task.py list/current` | A6 | Suncode task schema改造后采纳 |
| 24 | `113bc5fb5824bc9eeb679bb0416092afbbcceb2e` `fix(scripts): stamp base_branch from repo default...` | A7 | 改造后采纳 |
| 25 | `5b7edf32069e01289245ef01805a0d60a5f79cbc` `Merge branch 'fix/issue-batch-b' into fix/issue-batch-a` | A5-A7、A10、A17、A23 | 合并集成，无独立实现 |
| 26 | `31092d45356577ef21966d3bfee19c44ae300570` `Merge pull request #448...` | A5-A7、A10、A17、A23 | 合并集成，无独立实现 |
| 27 | `ccf95fcf877441b10ebb6d3990ea4fb2f94286db` `docs(spec): refresh contracts...` | A21 | 按实际采纳行为更新 Suncode specs |
| 28 | `2deb9fd423318a1b60adb88885b57d0189bc7b92` `Merge pull request #449...` | A21、A23 | 合并集成，无独立实现 |
| 29 | `ccd29ac5d733327056c4242518b3e2717aee2f48` `fix(codex): pin agents.max_depth=1` | A16 | 改造后采纳 |
| 30 | `9846fe662e05e7da494066874e7961a465f23d56` `fix(task): warn on base_branch fallback + add --base-branch override` | A7 | 改造后采纳 |
| 31 | `3d0aaea57457447f9feb8fb57ffbd29112191067` `refactor(hooks): extract shared codex dispatch-mode normalization` | A16 | 改造后采纳，invalid/default 保持 Suncode inline |
| 32 | `39ca6b9126467b1e32ed6888ffd6a74a73d72b1b` `fix(channel): keep sandbox value typed through the spawn path` | A17 | 采纳；不保留 cast 漏洞 |
| 33 | `a56ebbd327d715983bbf54afb55284cd79d2a5c6` `fix(update): rename-dir merge must not clobber canonical target...` | A9 | 直接语义采纳并适配 Suncode hashes |
| 34 | `65785cf09fddf06596c7033b9c19da3ea39f3898` `fix(cli): shorten Pi's display name...` | A22 | 已等价 |
| 35 | `17614d306484f41c71ef9782122f17739f13c431` `Merge branch 'fix/review-hardening'...` | A7、A9、A16、A17、A22、A23 | 合并集成，无独立实现 |
| 36 | `a0d749e9fe14fce04b1d44809b351b8b2b0900c1` `Merge pull request #450...` | A7、A9、A16、A17、A22、A23 | 合并集成，无独立实现 |
| 37 | `bfa7f99d6db10dba650cf4eb7f72b18d26540e23` `feat(cli): add Kimi Code support` | A4、A21 | 改造后采纳 |
| 38 | `65a83d7d28b75547e35e28d78763f63ec269cbb0` `ci: build before test...` | A19 | 采纳，与本仓 spec 对齐 |
| 39 | `26ca25f85a957e30a22f6ae28e5edc2349c98c3f` `release: 0.6.8 manifest changelog...` | A21、A23 | changelog 仅作行为索引；version/manifest/pointer 排除 |
| 40 | `c9011ae0b28523a1bbbbf79609c53aee3442c788` `0.6.8` | A23 | 上游版本身份，排除 |
| 41 | `dc68f5a92a68489b681c511f4a784e413d724e85` `ci: build before test in publish workflow` | A19 | 采纳 CI 顺序，不改 Suncode 版本 |

## 预计影响面

### 主仓 CLI

- 平台与生成：`packages/cli/src/types/ai-tools.ts`、`configurators/{index,shared,pi,grok,kimi}.ts`、`templates/{grok,kimi,codex,omp,shared-hooks,common}/`、`commands/init.ts`、`cli/index.ts`。
- update 与 migration：`commands/update.ts`、`utils/template-fetcher.ts`、Suncode 自有新 migration manifest、对应 integration tests。
- task runtime：`templates/suncode/scripts/task.py`、`common/{git,task_store,task_context}.py` 与 regression tests。
- Channel：`commands/channel/{index,spawn,supervisor}.ts`、`adapters/codex.ts` 与 tests。
- 工作流/规范：`templates/suncode/workflow.md`、brainstorm skill/prompt mirrors、`.trellis/spec/cli/**`。

### Core

- `packages/core/src/mem/internal/sqlite-readonly.ts`
- `packages/core/src/mem/adapters/zcode.ts`
- `packages/core/src/mem/{types,sessions,projects,context,index}.ts`
- `packages/core/test/mem/{sqlite-readonly,adapters,api}.test.ts`

### 相关仓库与 CI

- `marketplace/workflows/native/workflow.md` 与 bundled canonical workflow 保持一致，提交到 marketplace 子模块后更新主仓 gitlink。
- `docs-site` 更新平台注册、平台能力和命令文档，提交到 docs-site 子模块后更新主仓 gitlink。
- 主仓 `.github/workflows/{ci,publish}.yml` 调整 build/test 顺序；`.husky/pre-commit` 不改。

## 实施风险与门禁

- 平台 registry、`init()`、`executeMigrations()`、mem session fan-out、channel supervisor、shared hooks 都是高扇出候选。Phase 2 在编辑每个现有符号前运行 GitNexus `impact(direction="upstream")`；HIGH/CRITICAL 必须先向用户报告。
- 新 SQLite parser 是大体量安全敏感代码。以 upstream final state 为规格，先增加 parser 与专用 tests，再接入 mem fan-out；不手写简化版、不引入 native 依赖。
- 所有迁移测试只能在 fixture/临时目录运行，不能对当前工作区执行真实 `suncode update --migrate`、uninstall 或 destructive cleanup。
- 现有用户脏改不参与 staging。子模块提交、主仓实现提交、ledger/checkpoint 提交分开记录，任何一步失败都不推进 `sync-state.json`。

## 规划阶段未执行

- 未修改产品代码、spec、CI、docs-site 或 marketplace。
- 未运行 `task.py start`，任务仍是 `planning`。
- 未运行测试、lint、typecheck、build、basedpyright、`git diff --check` 或 GitNexus `detect_changes`。
- 未创建 commit、未 push、未发布 npm、未更新本地/远端 tag。
- 未修改 `references/sync-state.json` 或 `sync-ledger.md`。
