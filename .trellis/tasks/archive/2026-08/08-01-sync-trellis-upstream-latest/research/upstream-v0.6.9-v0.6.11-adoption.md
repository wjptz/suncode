# Trellis v0.6.9-v0.6.11 Suncode 采纳矩阵

## 方法与结论

本文件逐项分类官方区间
`dc68f5a92a68489b681c511f4a784e413d724e85..a82d4d4c75abf85c6200c4528f750798d531a70f`
的全部 43 个 commit。每项都以官方 commit diff 为上游证据，并与 Suncode HEAD
`493c3076f7d9fe35882a54cbab496016c087fcac` 的真实文件进行比对。

初步分类：

| 分类 | Commit 数 | 含义 |
| --- | ---: | --- |
| `adapt` | 21 | 采纳行为，但转换为 Suncode identity、所有权和现有架构 |
| `equivalent` | 1 | 上游最终行为已与 Suncode 当前策略一致，无代码移植 |
| `exclude-reverted` | 1 | 同一稳定版内引入后又由上游回滚，不采纳中间态 |
| `exclude` | 20 | task/journal/release/version/资产/原始子模块指针等 fork 默认排除项 |
| **总计** | **43** | 三个 release 区间全部覆盖 |

所有 `adapt` 项归并为 15 个可验证行为包。决策是规划结论；在用户明确批准、任务进入 `in_progress` 且完成 GitNexus impact 之前，不修改产品代码。

## 行为包

### A1. 有界且二进制安全的子代理上下文

- 上游：`ea399def...`、`bc36a0ed...`、`f7d8c32f...`。
- 问题：Python hook、Pi 和 OpenCode 会无界内联 JSONL 文件/任务 artifact，并可能把二进制解码为模型上下文。
- Suncode 证据：`packages/cli/src/templates/shared-hooks/inject-subagent-context.py:159` 仍从 `read_file_content` 直接读取全文；`:300`、`:339` 组装 implement/check context；当前 config、Pi 和 OpenCode 没有上游 limit/binary helper。
- 决策：`adapt`。在 `.suncode/config.yaml` 增加 file/artifact/total byte limits；Python、Pi、OpenCode 共享同一顺序、UTF-8 截断、总预算和 binary notice 语义，所有文案使用 Suncode identity。
- 验证：默认值、0=禁用、非法配置 fallback、UTF-8 边界、总预算降级、NUL/非法 UTF-8、三适配器一致性。

### A2. `no-suncode` 单轮注入逃生口

- 上游：`64df8759...`。
- Suncode 证据：`inject-workflow-state.py:681` 的 `main()` 在找到 root 后直接构造 breadcrumb；当前 Python/OpenCode/config 均无 `prompt_injection` 或 skip keyword。
- 决策：`adapt`。默认 keyword 转换为 `no-suncode`；只抑制当前 user turn 的 workflow-state breadcrumb，不影响 SessionStart、subagent context 或后续 turn；空字符串禁用。
- 验证：大小写、独立词边界、前后连字符、空 keyword、注释/引号 YAML、Python 与 OpenCode 等价。

### A3. 任务元数据、孤儿树和结构化 journal CLI

- 上游：`53a29d41...`、`2d638230...`。
- Suncode 证据：当前 `add_session.py` 没有 `--change/--test/--next-step`；`task.py` / `task_store.py` 没有通用 `--meta` 和 `set-meta`；Suncode 另有 `task_store.py:203` 起的 Hub metadata 结构，不能被扁平覆盖。
- 决策：`adapt`。加入结构化 journal flags、孤儿 child 顶层展示和通用 meta API；通用 key 只更新 `meta` 对应成员，必须保留已有 `meta.hub`、中文 PRD 和 Hub task lifecycle。
- 验证：重复 flags、空 section、省略/覆盖 meta、malformed pair fail-fast、nested Hub meta 保留、dangling parent、live `.trellis` 与生成 `.suncode` 脚本一致。

### A4. Codex agent 模型键持久化与推荐提示

- 上游：`ee4bffcc...`、`402653bd...`。
- Suncode 证据：`codex.ts`、`update.ts` 和 `.codex/agents/suncode-*.toml` 中均无 `extract/apply/preserveCodexAgentModelKeys`、`model_reasoning_effort` 或注释 hint。
- 决策：`adapt`。只保留三个 Suncode-owned agent TOML 顶层 `model` / `model_reasoning_effort`，忽略注释和 multiline body；init 与 update 在 hash 比较前应用；模板提供 `gpt-5.6-terra` / `high` 注释提示但不激活模型。
- 验证：单键/双键、转义、inline comment、multiline false positive、用户删除键、非 Suncode agent 不触碰、init/update 幂等。

### A5. Snow CLI class-1 平台

- 上游：`3dc7ba07...`。
- Suncode 证据：`packages/cli/src` 下没有 Snow configurator、template 或测试路径。
- 决策：`adapt`。增加 `--snow`、registry/configurator、Suncode-namespaced commands/agents/hooks/skills 和 workflow/context 写入；不复制 Trellis package/name 或 upstream marketplace submodule 指针。
- 验证：init/update/uninstall、ownership detection、hook JSON、Python command placeholder、共享 skill byte identity、跨平台列表与 JSON contract。

### A6. Symlink workspace 的可信 context roots

- 上游：`530d2091...`。
- Suncode 证据：channel 只有 cwd realpath jail；没有 `context-trust.ts` 或 `channel.trusted_context_dirs`。OMP 有独立的 cwd containment，但没有可信 root 配置。
- 决策：`adapt`。显式 trusted dirs 加上默认仅自动信任顶层 `.suncode/tasks` / `.suncode/workspace` symlink；全程 realpath containment，broken/越界路径 fail closed；同步 channel agent/context loader、spawn 与 OMP extension。
- 验证：合法 symlink、禁用 auto-trust、显式 root、`..`、外部 symlink、TOCTOU 防御、缺失/错误配置、Windows 分隔符。

### A7. Journal union merge 与 worktree 提示

- 上游：`a5374864...`。
- Suncode 证据：当前没有 bundled `gitattributes.txt`、`ensureGitattributes` 或 journal union rule。
- 决策：`adapt`。以 additive-only 方式确保项目根 `.gitattributes` 含 `.suncode/workspace/*/journal-*.md merge=union`；不覆盖用户规则、不对 `index.md` 设置 union；linked worktree 中给出非阻塞冲突说明。
- 验证：新文件、已有内容、重复规则、dry-run、update 无变更路径、main worktree/linked worktree、auto-commit 开关。

### A8. Kimi research 使用可写 coder

- 上游：`7df965f0...`。
- Suncode 证据：`packages/cli/src/templates/kimi/agents/suncode-research.md:13` 仍要求只读 `explore`，但 `:19` 又要求写入 research，契约自相矛盾。
- 决策：`adapt`。改用 Kimi built-in `coder`，限定只能写 active task 的 `research/`，保留 Suncode task/path 指令。
- 验证：模板断言 coder、明确 explore read-only、写范围限制、Kimi 私有 skill 路径。

### A9. v0.6.10 回归修复与 Python 3.9 质量门

- 上游：`621435d1...`、`89f25a8e...`。
- Suncode 证据：`active_task.py:591-605` 解析 previous 后仍删除请求 key，而非 `previous.context_key`；Codex agent 模板没有 `Full hook output saved to:` 恢复优先级；`pyrightconfig.json:9` 仍为 Python 3.10，CI 没有 setup/compile/typecheck Python 3.9。
- 决策：`adapt`。精确清理 resolved fallback session；saved hook output 优先于 marker，失败再 role-specific pull fallback；移除 3.9 不兼容的 nested multiline f-string；CI 用 Python 3.9 编译所有 tracked Python 并跑 basedpyright。
- 验证：exact/fallback/ambiguous/malformed session；saved file 成功/读取失败/marker 缺失；3.9 py_compile；pyright 覆盖 live hooks 和生成模板。

### A10. Pi 父模型继承与 `max` thinking

- 上游：`6d8bd3c0...`、`a5f81d9a...`。
- Suncode 证据：Pi `resolveRunCfg` 在 `:645` 只接收 inherited thinking；`:650` / `:655` / `:1506` 枚举止于 `xhigh`；`:658` 只在 call 和 agent model 间选择。
- 决策：`adapt`。优先级为 per-call > agent frontmatter > invoking Pi provider/model；thinking 保持现有优先级并加入 `max`；缺失 provider 或 id 时保持旧行为。
- 验证：provider-qualified model、override 优先级、suffix、`max` schema/label/args、spawn 集成、无模型 fallback。

### A11. Channel Codex turn failure 传播

- 上游：`13862313...`。
- Suncode 证据：`CodexCtx` 从 `codex.ts:50` 起没有 terminal error state；`:244` 的 `turn/completed` 只处理 done/pending；没有 terminal `error` notification 分支。
- 决策：`adapt`。失败 turn 和不可重试 app-server error 发出 terminal error；`willRetry` 只发 warning progress；同一 turn 去重并在新 turn 重置。
- 验证：两种事件顺序、重复错误、retry warning、fallback message、新 turn reset、成功 done 顺序。

### A12. 完成 turn 后仍执行 idle timeout

- 上游：`5ba35f68...`。
- Suncode 证据：`idle.ts:24` 暴露 `hasTerminalEvent()`，`:73-77` 因 terminal event 永久跳过 timeout，使完成一次 turn 的长驻 worker 不再回收。
- 决策：`adapt`。idle timer 只受 shutting-down 与 child-exited 抑制；terminal event 表示 turn 完成，不表示进程退出。
- 验证：初始 idle、pause/reset/cancel、child exit、shutdown、完成 turn 后 timeout。

### A13. Polyrepo Git 探测上限

- 上游：`aef8ea56...`。
- Suncode 证据：`session_context.py:66` 只有深度上限；没有 repo 数量上限和 Git probe timeout；`git.py:13` 的 `run_git` 不接收 timeout。
- 决策：`adapt`。自动发现最多 8 个 repo，超量时跳过自动状态并建议显式配置；best-effort status/branch/log 使用 2 秒 timeout；正常 Git 操作默认不设 timeout。
- 验证：8/9 repo 边界、timeout、status 失败不误报 clean、显式 package 不受自动扫描限制。

### A14. Hook stdin 独立 UTF-8 解码

- 上游：`e4ed585e...`。
- Suncode 证据：subagent hook `:915`、shell context hook `:149`、Claude statusline `:248` 直接从 locale-bound stdin 读 JSON；仅 stdout 或子进程已有部分 UTF-8 处理。
- 决策：`adapt`。所有受影响 Python hook 在读取前 best-effort `sys.stdin.reconfigure(encoding="utf-8", errors="replace")`，不依赖宿主 locale。
- 验证：非 UTF-8 locale 下的中文 JSON、无 `reconfigure` stream、异常 reconfigure、现有 Windows stdout 行为不回归。

### A15. 基于 Suncode 所有权的平台检测

- 上游：`c41c8bd7...`。
- Suncode 证据：`getConfiguredPlatforms` 在 `index.ts:540-559` 对 OMP 使用 `ownershipMarkers`，其余平台仍仅凭 configDir 存在；裸 `.claude/.codex/.pi` 会被误认成 Suncode 安装。
- 决策：`adapt`，不是直接替换。通用平台由 `.suncode/.template-hashes.json` 中属于当前 platform template surface 的记录证明；共享 roots 继续要求 Suncode marker；legacy Windsurf 只接受 hash 或 `suncode-*` 唯一命名文件。裸目录永远不是所有权证据。
- 验证：所有平台真实 init、裸原生目录、共享 `.agents` / `.omp`、legacy Windsurf、用户删除 managed file、损坏/缺失 manifest、Windows path normalization。

## 逐 commit 矩阵

### v0.6.8 exclusive → v0.6.9 inclusive（28）

| Full commit | 上游行为与证据 | Suncode 证据 | 决策 | 理由 / 验证 |
| --- | --- | --- | --- | --- |
| `ea399def505f26331919915753ae2c0f21ea6b00` | Python/Pi context byte caps；`config.py`、`task_context.py`、hooks、Pi、tests | 当前 Python/Pi 无 limit helpers，仍全文读取 | `adapt` A1 | Suncode config/name 转换；限额、UTF-8、预算测试 |
| `e2076418f4f268201c9c3d71db5c73c639fc5c1a` | archive `07-22-subagent-context-limits` task | 上游任务历史非产品行为 | `exclude` | fork 默认排除 task records |
| `2c1b3761cc9fb639360fd4b6863af1ac451d9b88` | developer journal | 无运行时行为 | `exclude` | fork 默认排除 journal |
| `5dedc208884b41f4b4c2dd35e2f4afb131b7e21b` | archive Kiro task | 无运行时行为 | `exclude` | task record |
| `d31772fc90ea35c30932a4c69b62218392b36217` | archive JSONL gate task | 无运行时行为 | `exclude` | task record |
| `7a7bebe1431db783abddd2010b92464f13d9808f` | archive brainstorm task | 无运行时行为 | `exclude` | task record |
| `63684b5f19f9cfc1df2d63890e39738c72d8b2eb` | archive channel UX task | 无运行时行为 | `exclude` | task record |
| `64df8759b4d62584eea5b41a20204b050be965db` | `no-trellis` per-turn skip；Python/OpenCode/config/tests | 当前没有 skip contract | `adapt` A2 | 转为 `no-suncode`，严格单轮作用域 |
| `9fa034f27c2e4cff3c51d270239c5ece0e111b1e` | archive skip task | 无运行时行为 | `exclude` | task record |
| `5d14195d2067aceb6f23f7030fe3971ecefeb5f4` | developer journal | 无运行时行为 | `exclude` | journal |
| `53a29d414a2a92949865a5d9ed1f493c2ae0fd7b` | structured journal flags、orphan fallback、task meta API | 当前缺少三项，另有 Hub nested meta | `adapt` A3 | 保留 Hub/中文契约，补脚本集成测试 |
| `e04babf5ab0d469d4e9b276f1fbbb608be7a2787` | archive script QoL task | 无运行时行为 | `exclude` | task record |
| `dfcb9262f66def6a45105ee71e929ebeaf4cb73c` | developer journal | 无运行时行为 | `exclude` | journal |
| `2d6382303dfdb2ede5478abb130fc887d6fd1a1f` | core task schema 与 Python script 边界 spec | 本地 spec 尚无这次澄清 | `adapt` A3 | 只采纳架构契约，不复制 Trellis product identity |
| `ee4bffccf9b25359c1c3f6bbe884b1e26ebcbf5f` | update/init 保留 Codex agent model keys | 当前无 preserve helpers | `adapt` A4 | 限定 Suncode-owned TOML，覆盖解析/转义/删除 |
| `3dc7ba07af13d8df14101c0571f1c7fcb8787b4e` | Snow CLI class-1 platform；registry/configurator/templates/tests | 当前没有 Snow | `adapt` A5 | 完整 Suncode 命名平台；排除 raw marketplace pointer |
| `88b20f90ce52e494c009c164c630fb1a1e209b77` | WeChat QR binary | 品牌/临时资产 | `exclude` | fork 默认排除资产 |
| `530d2091c740af0670fe2ce74307d2bbb8941cf3` | channel trusted context dirs + symlink auto-trust | 当前仅 cwd jail | `adapt` A6 | `.suncode` roots、realpath、fail-closed |
| `95fab3e4eafe874757f9997d25b19b78551722b0` | archive trusted context task | 无运行时行为 | `exclude` | task record |
| `2d96142decca4ec970d96cc48a5b9e39ef3e04df` | developer journal | 无运行时行为 | `exclude` | journal |
| `a53748643d259f0e7fbf5ffed76115e6785c6ce4` | root `.gitattributes` journal union + worktree guidance | 当前没有相应模板/helper | `adapt` A7 | additive-only，Suncode journal path，保留用户文件 |
| `12f9a3db1131ab5474a69314aed7662e8a1389c9` | archive journal merge task | 无运行时行为 | `exclude` | task record |
| `402653bdc5dee324512b820237c562ae01ee9eac` | Codex agent 推荐 hint → terra/high | 当前模板没有 model hints | `adapt` A4 | 注释提示，不激活或覆盖用户模型 |
| `bc36a0ed0b857769f92628e4de9b327c97e847c9` | OpenCode context caps follow-up | 当前 OpenCode 没有 limits/budget | `adapt` A1 | 与 Python/Pi 一致性测试 |
| `7df965f0f83c5ffe060098c9a7f061a05f94996b` | Kimi research 改由 writable coder 持久化 | 当前仍声明 explore + write | `adapt` A8 | 消除只读/写入矛盾，限制 task research 范围 |
| `f7d8c32fb98b42cc7e13261fe90bab5596bef43c` | Python/Pi/OpenCode 跳过 binary context | 当前无 binary detection | `adapt` A1 | NUL、invalid UTF-8、reference-only notice |
| `4a5a8df3da295a84fde7ef626fa6cd710c94e1f6` | 0.6.9 manifest + docs-site pointer | Suncode 有独立 manifest/docs，子模块已有用户脏改 | `exclude` | 仅作为 release 证据，不复制 identity/pointer |
| `12e279a8af00456b1d0d4e3d0f7f59e7b702202e` | Trellis package version 0.6.9 | Suncode 独立包/version lifecycle | `exclude` | 不推进 Suncode version，不写本地 tag |

### v0.6.9 exclusive → v0.6.10 inclusive（3）

| Full commit | 上游行为与证据 | Suncode 证据 | 决策 | 理由 / 验证 |
| --- | --- | --- | --- | --- |
| `621435d143d352ac1db4ab077d682716fd6d5afd` | resolved-session cleanup、Codex saved hook output、Python 3.9 f-string/CI | 三项均未完整存在 | `adapt` A9 | 精确 fallback 状态机、role fallback、3.9 门禁 |
| `c45f12defb449f88cc160f4b2162035f07127866` | 0.6.10 manifest + docs-site pointer | 同路径 Suncode manifest 表达本地 release；docs-site 脏 | `exclude` | 不覆盖 Suncode changelog/子模块指针 |
| `c94d6fc289b7a6fdd9480bdfae4d4639c9ac2d4c` | Trellis package version 0.6.10 | 当前 Suncode 恰为 0.6.10，但身份不同 | `exclude` | 数值相同不构成采纳证据，版本独立 |

### v0.6.10 exclusive → v0.6.11 inclusive（12）

| Full commit | 上游行为与证据 | Suncode 证据 | 决策 | 理由 / 验证 |
| --- | --- | --- | --- | --- |
| `6d8bd3c0ff78ce866a0c87d3cd00e353e7b179ce` | Pi child 继承 invoking provider/model | 当前只继承 thinking | `adapt` A10 | 保留 call/agent 优先级，缺失上下文 fallback |
| `13862313c9dc879db0230ec69b46ca321edcec14` | Codex failed/error notification 传播与去重 | 当前 turn/completed 不识别 failed | `adapt` A11 | terminal error、retry warning、per-turn reset |
| `5ba35f68130acdfb312bda018d7e26cbacc2138b` | terminal turn 后仍执行 worker idle timeout | 当前 `hasTerminalEvent` 永久抑制 timer | `adapt` A12 | terminal turn ≠ child exit |
| `aef8ea56a7365fcc13ecc61fb7df264a60591d13` | polyrepo 最多 8 个；Git probe 2s timeout | 当前只有 depth=2，无 probe timeout | `adapt` A13 | 超量 fail-safe、status 失败不误报 clean |
| `e4ed585e1450657f9e3c0ee23f0a823dd7ab9ad3` | hook stdin 强制 UTF-8 | 当前受影响模板直接读 locale stdin | `adapt` A14 | best-effort reconfigure，非 UTF-8 locale 回归 |
| `c3596dd95f821ab23f50209bef60a5e6ab9f9569` | 引入 per-task workflow selection | 同版后续 `c143...` 完整回滚；Suncode 有自己的 workflow marketplace 命令 | `exclude-reverted` | 不采纳稳定 tag 中不存在的中间态 |
| `a5f81d9af14d458598b99bd1f953163d1fdcbc15` | Pi 支持 `max` thinking | 当前枚举和 suffix 止于 xhigh | `adapt` A10 | schema、parser、label、spawn args 一致 |
| `c41c8bd7cf51c81cba72cf8cb4c8837ce9783ce3` | 由 Trellis-owned template hashes 识别平台 | 当前除 OMP 外仍按裸目录识别 | `adapt` A15 | 合并 Suncode marker 特例，禁止裸目录所有权推断 |
| `89f25a8eb532231e174f7fe1afdb8d5dd8952b27` | CI 编译所有 Python 3.9 并跑 basedpyright | 当前 pyright target 3.10，CI 无这些步骤 | `adapt` A9 | 使用 Suncode 包过滤器，覆盖 tracked Python |
| `c143c260678f5803d4f321a7a5d5099af6acfeb3` | 回滚 per-task workflow selection，保持 beta | Suncode 没有上游 `workflow_selection.py` 稳定行为 | `equivalent` | 保持当前策略并跑 workflow tests，无移植 |
| `76aeae50dde00f66038d60b6da9a397ac4bb38e9` | 0.6.11/0.7 beta manifests + docs-site pointer | Suncode release/docs lifecycle独立且 docs-site 脏 | `exclude` | 仅 release evidence；不复制 beta/指针 |
| `a82d4d4c75abf85c6200c4528f750798d531a70f` | Trellis package version 0.6.11 | Suncode version 由独立 release task 管理 | `exclude` | 不抢占 `07-23-release-suncode-v0-6-11`，不创建 tag |

## 明确的 fork 转换

| 上游表面 | 本轮 Suncode 结果 |
| --- | --- |
| `.trellis` 产品运行时 | `.suncode`；但本仓开发工作流 `.trellis/` 保持 Trellis identity |
| `TRELLIS_*` | `SUNCODE_*` |
| `trellis-*` generated agent/command/hook | `suncode-*` |
| `@mindfoldhq/trellis*` | `@wjptz/suncode*` |
| Trellis notice/managed block | Suncode notice/managed block |
| bare platform directory detection | template hash或唯一 Suncode ownership marker |
| `.trellis/tasks` / `.trellis/workspace` symlink trust | `.suncode/tasks` / `.suncode/workspace`，不信任 Trellis 数据 |

## 不纳入本轮的内容

- `v0.7.0-beta.0` / `.1` 以及 per-task workflow 中间态。
- 上游 package version、manifest 原文、tag、npm identity。
- 上游 task、journal、QR、raw docs-site/marketplace pointer。
- 自动读取、迁移、删除或接管用户 Trellis runtime 数据。
- 任何 whole-range merge、whole-release cherry-pick 或 `trellis update/upgrade`。
- 当前脏的 `docs-site` 和 `marketplace` 工作树；Snow 的主仓能力可以实现，但子模块文档/市场内容本轮不得覆盖用户工作。

## Checkpoint 条件

只有 A1-A15 全部完成相应适配与验证、`detect_changes(compare main)` 范围审查通过、implementation commit 已存在且不含用户脏改后，才可：

1. 在 `sync-ledger.md` 顶部增加唯一 entry，引用本矩阵和实际验证结果；
2. 将 checkpoint 从 `v0.6.8` 推进到官方 `v0.6.11` / `a82d4d4...`；
3. 运行 checkpoint validate；
4. 以独立 bookkeeping commit 提交 ledger/state；
5. 归档任务并记录 journal。
