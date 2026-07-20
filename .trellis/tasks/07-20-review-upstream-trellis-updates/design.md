# Trellis v0.6.6 / v0.6.7 变更采纳设计

## 设计目标

将官方 `v0.6.6`、`v0.6.7` 的 14 项候选行为完整移植到 Suncode，同时满足三个不可让步的条件：

1. 不重新合并 Trellis 产品身份或持久化数据。
2. 不用上游模板覆盖 fork 后的 Suncode 定制。
3. 每个新增行为都有明确所有权、失败边界和回归验证。

## 总体策略

采用“commit 作为行为规格、Suncode 当前代码作为实现基线”的语义移植：

- 官方 commit 用来确认预期行为、边界条件和测试场景。
- 在当前 Suncode 架构中实现等价行为，不保留上游的 `.trellis`、`TRELLIS_*`、包名、命令前缀或 managed block。
- 每组改动独立验证；不整 tag merge，不一次性应用大型 patch。
- 任何上游 dogfood、任务记录、发布元数据和 submodule 指针均不进入实现。

## 架构分区

### 1. 文件与数据安全层

原子写入作为底层能力，由 TypeScript `file-writer` 和模板内 Python `common/io.py` 分别提供。调用方先写同目录临时文件，再用原子 replace/rename 提交；失败时保留旧文件并尽力清理临时文件。

update、template fetch、uninstall、task archive 和 workspace journal 在此基础上增加所有权与路径边界：

- 路径规范化后必须仍位于预期根目录。
- manifest 只能证明 Suncode 写过的文件，不能因为目录名相同推断所有权。
- 覆盖或 rename 前先检查目标是否存在；不能覆盖用户数据。
- cleanup 是 best-effort，不能替换主要操作的成功或失败结果。

### 2. Channel 可靠性层

CLI 与 core 共享相同的安全 handle 规则。允许稳定 ASCII slug，拒绝路径分隔符、绝对路径、`.`、`..`、控制字符和无法作为单一目录段的输入；中文可读标题留在 forum title，不进入存储 handle。

stdout pump 使用单一 Promise 链或等价串行队列：读取顺序就是 parser 和 `applyParseResult` 顺序，最大处理并发为 1。单行处理错误必须按原顺序进入现有错误路径，不能让后续行越过失败行。

Windows provider 解析顺序为本地 npm shim、可执行文件、系统 fallback。Node-script shim 使用 `process.execPath` 加真实脚本路径，参数以数组传递并保持 `shell: false`。

### 3. 平台注册与 OMP 生成层

OMP 是独立平台，不是 Pi 的别名。平台注册预计包含：

- `AITool` / `TemplateDir` / `CliFlag` 的 `omp` 成员。
- `AI_TOOLS.omp`：名称 `Oh My Pi`、`configDir: ".omp"`、`templateDirs: ["common", "omp"]`、`cliFlag: "omp"`、`hasPythonHooks: false`、`agentCapable: true`，命令引用使用 Suncode 前缀。
- `configureOmp` / `collectOmpTemplates` 注册进 `PLATFORM_FUNCTIONS`。
- `init --omp`、平台检测、task store、CLI adapter 和 workflow 平台文案同步支持。

生成资产全部使用 Suncode 命名：

- `.omp/commands/suncode-*.md`
- `.omp/skills/suncode-*/`
- `.omp/agents/suncode-research.md`、`suncode-implement.md`、`suncode-check.md`
- `.omp/extensions/suncode/index.ts`

commands 使用 OMP 要求的 YAML frontmatter；implement/research agents 保留 `model: pi/task`。OMP 原生发现 commands/skills/agents/extensions，不生成没有上游依据的 `settings.json`。

### 4. `.omp` 共享目录所有权

`.omp` 是 OMP 的平台目录，可能同时包含用户、Trellis 和 Suncode 资产，不能把整个目录列为 Suncode 独占数据。

当前 `getConfiguredPlatforms()` 仅按 `configDir` 是否存在检测平台，这会把 Trellis-only `.omp` 误判为 Suncode OMP。设计上为平台行为注册增加可选的 ownership-aware `isConfigured(cwd)`：

- 普通平台默认保持现有 `configDir` 检测，不扩大改动面。
- OMP override 检查 Suncode 唯一标记，例如 `.omp/extensions/suncode/index.ts`，并可结合 Suncode manifest 中的 OMP 资产确认。
- init 明确选择 `--omp` 后才创建 Suncode OMP 资产。
- update 只收集、比较和更新 Suncode OMP 模板。
- uninstall 只删除 manifest 中的 Suncode 文件，并仅清理已经为空的子目录；不得删除 `.omp` 根或 `trellis-*`、用户文件。

该规则同时用于 orphan-manifest pruning，避免因 Trellis-only `.omp` 存在而保留或重写错误资产。

### 5. OMP extension 生命周期

OMP extension 的运行时数据流如下：

```text
session_start
  ├─ 解析 project/task/session 身份
  ├─ 主会话：持久化 workflow + task 富上下文
  └─ 子代理：按 research/implement/check 注入精确任务上下文

input
  └─ 预热 projectRoot / workflow-state cache

before_agent_start
  └─ 注入轻量、当前轮需要的 workflow 状态

context（每次 LLM 调用或 tool continuation 前）
  ├─ 检查最近一次压缩边界
  ├─ 已有有效上下文：不重复注入
  └─ 压缩丢失上下文：重新注入持久化 runtime message

session_before_compact
  └─ 保存压缩前所需状态，供压缩后恢复
```

运行时消息类型改为 Suncode 命名，例如 `suncode-session-context` 和 `suncode-task-context`。动态 workflow/task/override 不拼进每轮 `systemPrompt`，也不改写用户输入；`systemPrompt` 保持字节稳定，以保留 provider prefix cache。

OMP extension 以 `packages/cli/src/templates/omp/extensions/suncode/index.ts.txt` 为生成资产的 canonical source，并通过生成结果测试防止漂移；不为了镜像上游 dogfood 而新增仓库根 `.omp` 文件。会话身份解析必须基于当前 session，不能回退到陈旧全局身份；active task 查询必须 session-aware。

### 6. 现有平台与任务工作流

- Pi：移植与 OMP 共用的隐藏持久化 runtime message、稳定 prompt 和 compaction 语义，但保留当前 Suncode Pi 定制；项目级 `.pi/settings.json` 的相对 `sessionDir` 按项目根解析并与全局 roots 去重。
- ZCode：新资产写 `.zcode/agents/`；旧 `.zcode/cli/agents/` 只处理 manifest 证明属于 Suncode 的文件。
- Codex：`dispatch_mode=inline` 跳过 JSONL，sub-agent 模式继续生成；不能仅因存在 `.codex/` 推断 dispatch 模式。
- task create/archive/journal：严格日期、路径和 branch 状态；OMP 使用原生 task 能力，不走重复 CLI agent 调度。

OMP `mem` 历史检索不属于官方 `v0.6.6` 的平台实现。实施阶段记录其 session 目录与格式是否兼容现有 Pi adapter；在缺少稳定格式契约时不新增伪兼容 reader，但把结论留在任务研究文档，作为后续升级的明确起点。

## 兼容与迁移策略

- 不自动迁移 `.pi` 到 `.omp`，也不把 OMP 当成 Pi session 身份。
- 已存在 `.omp` 时，init 只添加 Suncode namespaced 资产；同路径文件有用户修改时沿用 manifest/hash 冲突策略，不静默覆盖。
- Trellis-only `.omp` 不触发 Suncode update；用户显式 `suncode init --omp` 后才进入 Suncode 管理。
- ZCode、traces/journal 和历史 rename-dir 迁移均以 manifest 所有权为前提。
- 本地 `.template-hashes.json` 的基线曾发现大量与 Git 内容不一致，不能在当前工作树用它直接证明用户修改；需要升级试演时使用临时 worktree/copy，并以 Git diff 和新生成 manifest 共同核验。

## 测试设计

### 定向单元与集成测试

- 安全路径：合法 slug、`../`、绝对路径、分隔符、CJK title/ASCII handle 分离、旧非法目录 discovery。
- 原子写：成功替换、写失败保留旧文件、rename 失败、临时文件清理、Python/TS parity。
- uninstall/update：Trellis-only `.omp`、Suncode+Trellis 混合 `.omp`、用户修改、dry-run、dirty guard、仅清空 Suncode 资产。
- archive/migration：`archive src` 拒绝、合法任务归档、unowned rename-dir 不移动、已有 journal 不覆盖。
- Channel：800+ 行顺序、最大并发 1、解析错误顺序、Windows `.exe` 和 Node-script shim。
- OMP init/update：`--omp` 生成 commands/skills/agents/extension，命名和 frontmatter 正确，模板 hash 被追踪，重复 init 幂等。
- OMP extension：main/sub-agent session-start、input cache、before-agent、context continuation、压缩前后、stale identity、session-aware active task。
- Pi/ZCode/Codex/task/journal：现有行为和新增修复分别覆盖，确保 OMP 变更不污染相邻平台。

### 质量门

依次运行定向 Vitest、`pnpm test`、`pnpm typecheck`、`pnpm build`。代码改动完成且准备提交前运行 GitNexus `detect_changes(scope="compare", base_ref="main")`，核对只影响预期符号和执行流。

## 风险与权衡

- OMP extension 是最高风险区域：上游在同一版本内连续修复多次，必须以 `v0.6.6` 最终状态为规格，不能只移植首个 feature commit。
- `.omp` 共享根的误检测是 Suncode 特有风险，官方实现的“目录存在即已配置”不能原样复制。
- Pi 模板已有较多 Suncode 定制，必须小块移植和定向测试，不能用上游文件整体覆盖。
- 原子写和 update/uninstall 属于广泛基础能力，先运行 GitNexus impact；若为 HIGH/CRITICAL，先报告再实施。
- 完整纳入 OMP 会增加测试矩阵，但换来一次性建立上游依赖链和未来可持续追踪基线，符合用户当前选择。

## 回滚策略

- 每个实施分组保持独立 diff 和独立验证记录；失败时只撤销当前分组，不回退用户已有改动。
- 数据安全改动不通过测试时不得继续执行迁移或卸载试验。
- OMP 失败时移除的只能是本次 manifest 记录的 Suncode OMP 资产，不能删除 `.omp` 根目录。
- 所有迁移/覆盖测试使用 fixture 或临时目录，禁止对当前项目直接运行真实 upgrade/uninstall。
