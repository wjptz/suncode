# 发布 Suncode v0.6.12

## 目标

发布稳定补丁版 Suncode v0.6.12，将已完成的 Execution DAG、最小化 sub-agent context、规划收敛门禁、Trellis v0.6.11 对齐及相关可靠性改进交付到 `@wjptz/suncode` 和 `@wjptz/suncode-core`；正式发布前修复已确认的 Windows context 制品换行哈希失配，并确保 Linux、现代 macOS 和 Windows 上 manifest 声明的 SHA-256 都对应实际落盘 bytes。

用户价值：开启 DAG 后，native sub-agent 不会因为平台换行转换而拒绝刚生成的不可变上下文；现有 Linux/macOS 行为保持不变，完整性校验仍然 fail closed。

## 已确认事实

### 发布基线与工作树

- npm 上 `@wjptz/suncode` 与 `@wjptz/suncode-core` 的当前版本和 `latest` 均为 `0.6.11`。
- 本地主仓 `main` 与 `origin/main` 在 `be52b89e` 后分叉：本地包含 DAG/Trellis 后续提交，远端包含已发布的 `275618c6`（`0.6.11`）及发布记录；当前 ahead 17、behind 4。
- 本地 CLI/Core `package.json` 仍为 `0.6.10`，因为 `v0.6.11` 版本提交不是本地 `HEAD` 的祖先。发布前必须在隔离 release worktree 中合并两条历史，并以合并后的 `0.6.11` 为 patch bump 基线。
- `packages/cli/src/migrations/manifests/0.6.12.json` 已存在，当前声明 `breaking: false`、`recommendMigrate: false`、`migrations: []`。
- docs-site 当前有 25 个 tracked 双语横切文档改动和 2 个未跟踪的 v0.6.12 changelog；两份 changelog 日期仍是 `2026-07-23`，发布前需要更新并保持英文/中文结构 1:1。
- marketplace 本地 `main` 以提交 `3a78f3e` 比其 `origin/main` 领先 1 个提交。
- 主仓保留 GitNexus skill、`AGENTS.md`、`CLAUDE.md` 和知识库草稿等既有脏改；这些不属于发布范围，正式 release 脚本不得在当前工作树运行。

### Context 完整性缺陷

- `build_node_context()` 根据 `content.encode("utf-8")` 计算 SHA-256（`packages/cli/src/templates/suncode/scripts/common/execution_context.py:201-204`）。
- `_write_text_atomic()` 当前通过未指定 `newline` 的文本模式写入（`execution_context.py:721-731`）。Windows 原生 Python 会把字符串中的 `\n` 转换成 `\r\n`，使实际文件 bytes 与已计算哈希不一致；Linux 与现代 macOS 默认都写成 `\n`。
- `read_node_context_manifest()` 读取原始 bytes 后严格复算哈希（`execution_context.py:307-322`），因此正确报出 `context content hash mismatch`。问题不在读取校验，也不是 `fork_turns = "none"` 本身导致。
- 最小复现中，LF 内容为 4 bytes、SHA-256 `911169dd...59a2`；经 CRLF 转换后为 6 bytes、SHA-256 `58055bdc...0cab`。
- 现场 agent 将 `os.fdopen(..., encoding="utf-8")` 改为 `os.fdopen(..., encoding="utf-8", newline="\n")` 后故障消失，与根因一致。
- 当前受版本控制的 Suncode 模板源仍是旧写法，且没有对应测试 diff；现场修复没有进入待发布源码。

### 隔离能力边界

- claim envelope 同时提供父 checkout 的绝对 `manifestPath` 和 repo-relative `manifestRef`，prompt 使用相对引用（`packages/cli/src/templates/suncode/scripts/common/execution_runtime.py:1006-1056`）。
- bundled workflow 默认使用 `shared-worktree`；该路径已有 manifest 生成、pull 和 hook push 集成测试。
- `worktree`/`sandbox` 值存在于执行模型中，但原始 DAG 设计明确将需要合并、冲突处理和制品传输的隔离适配器列为未来能力，不属于首版验收。
- 独立 checkout 若不能访问父 checkout 的 `.suncode/.runtime/execution`，可能出现 manifest 不可用或无上下文；这与本次已确认的“内容存在但哈希不一致”不是同一故障。

## 需求

### R1：跨平台确定性写盘

- `_write_text_atomic()` 必须让写盘的 UTF-8 bytes 与用于计算 manifest SHA-256 的 `value.encode("utf-8")` 完全一致。
- 采用最小修复：文本写入显式传入 `newline="\n"`，关闭 Windows 平台换行扩展。
- 不改变原子临时文件、`os.replace`、UTF-8 编码、错误包装和清理语义。
- 字符串中原本存在的 `\r\n` 或其他字符必须原样保留，不能额外做内容规范化。

### R2：完整性回归测试

- 增加功能测试，断言生成后的 `content.md` 原始 bytes SHA-256 等于 `manifest.content.sha256`，且 `budget.usedBytes` 等于原始 byte 长度。
- 增加可在 Linux CI 上模拟 Windows 默认 CRLF 翻译的回归测试；旧实现必须失败，显式 `newline="\n"` 后通过。
- 保留并运行 manifest/content 篡改后的 fail-closed 测试，确保修复没有弱化校验。
- 验证 shared-worktree 下 native SubagentStart hook push 与 `execution context` pull 消费同一个 manifest/content 制品。

### R3：隔离支持声明

- v0.6.12 只把 bundled `shared-worktree` context 链路列为已验证能力。
- 不在本补丁版实现 worktree/sandbox 的跨 checkout artifact transport、共享挂载或合并协议，也不在 changelog/docs 中宣称这些路径已完成端到端支持。
- 若验证发现 bundled workflow 会默认选择非 shared-worktree，或会在制品不可见时静默继续，则视为发布阻断；应收紧为明确诊断，而不是静默降级。

### R4：发布产物一致性

- 审核 `0.6.12.json`，补入本次 context 完整性 bug fix，同时保留非 breaking、无迁移语义。
- 更新英文/中文 v0.6.12 changelog 日期、结构和内容；加入 Windows context hash 修复，修正文档中与实际 agent role/隔离能力不一致的表述。
- 审核 25 个横切 docs 改动和 marketplace `3a78f3e`，只纳入与 v0.6.12 实际能力一致的内容。
- 子仓提交必须先形成并验证；主仓只记录已经存在且最终会先推送可达的 gitlink。

### R5：隔离发布与双重批准

- 在隔离 release worktree 中，从最新 `origin/main` 合并本地 `main`，保留两侧历史；禁止 rebase、强推、移动 tag、丢弃或覆盖任一侧提交。
- 合并后 CLI/Core 版本基线必须同为 `0.6.11`，再由官方 stable patch release 脚本生成 `0.6.12` 版本提交与 tag。
- 本地准备阶段完成代码、文档、精确提交和全部质量门，但不得推送或发布。
- 本地质量门完成后提供独立 go/no-go；只有再次得到明确批准，才允许按子仓 → 主仓 → tag 的顺序推送并触发 CI/npm 发布。
- 正式发布必须在显式 LF、递归检出子模块、先执行 root build 的全新干净 clone 中运行；禁止本地 `npm publish`。

## 验收标准

- [ ] AC1：在常规环境和模拟 Windows CRLF 翻译环境中，context builder 写出的 `content.md` 原始 bytes 与 manifest SHA-256、`budget.usedBytes` 一致。
- [ ] AC2：Linux/macOS 的 LF 输出语义不变；字符串本身已有的换行 bytes 不被额外规范化。
- [ ] AC3：manifest 或 content 被修改后仍被拒绝，且错误不会被吞掉后继续实施。
- [ ] AC4：bundled shared-worktree 的 native hook push 与 pull 路径均成功读取同一不可变 context；发布文档不宣称未验证的 worktree/sandbox 传输能力。
- [ ] AC5：`v0.6.11` 发布线和本地 DAG/Trellis 提交线在隔离 release 分支完整合并，CLI/Core 合并基线均为 `0.6.11`。
- [ ] AC6：v0.6.12 manifest、双语 changelog、docs navigation、横切文档和 marketplace workflow 与实际发布制品一致。
- [ ] AC7：定向测试、Python lint/typecheck、root lint/typecheck/test/build、manifest continuity、pack/全新安装、CLI/DAG context 烟测全部通过；任何未执行项均明确记录并阻断发布。
- [ ] AC8：既有无关脏路径未被修改、暂存或提交；`git diff --check` 和 GitNexus `detect_changes` 只显示预期范围。
- [ ] AC9：获得独立发布批准后，子模块提交先于主仓/tag远端可达，`v0.6.12` tag 指向版本一致的正式提交。
- [ ] AC10：GitHub Actions CI/publish 成功，两个 npm 包均存在 `0.6.12` 且 `latest=0.6.12`；发布证据写入任务记录并归档。

## 不在范围内

- 为 worktree/sandbox 新建跨 checkout context artifact 复制、共享存储、挂载或合并协议；该能力另立任务设计和验收。
- 提交或清理 GitNexus skill、`AGENTS.md`、`CLAUDE.md`、知识库草稿等既有无关脏改。
- 将 v0.6.12 扩为新的产品功能，或借发布顺带重构 `execution_context.py`。
- 强推、移动既有 tag、改写历史，或使用本地 npm publish 补偿 CI。

## 风险与延期项

- 当前分叉历史和版本文件会在 merge 时产生冲突风险；必须在隔离 worktree 解决并逐项审查，不能在当前脏工作树直接运行 release 脚本。
- Linux CI 的普通文件写入无法自然复现 Windows 默认 CRLF；测试必须显式模拟该翻译路径，不能只依赖当前宿主机断言。
- worktree/sandbox artifact transport 仍是后续能力。若后续要正式支持，必须定义 transport、trust root、权限、清理和失败可观测性，不复用本补丁的换行修复代替协议设计。
- tag 推送后的 npm 发布由 GitHub Actions 驱动；tag 后失败不得移动 tag或本地补发，只能按发布故障流程处理。

## 已解决决策

- 2026-08-02：用户批准将已确认的 context 完整性缺陷作为 v0.6.12 发布阻断项，修复并验证后继续发布。
- 远端推送、tag 和 npm 发布继续保留独立 go/no-go 门禁；当前批准只覆盖本地实施与发布准备。
