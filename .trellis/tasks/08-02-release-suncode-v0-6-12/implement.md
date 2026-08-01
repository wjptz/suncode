# Suncode v0.6.12 实施计划

## Phase 0：规划批准与任务激活

- [x] 用户审阅最终规划摘要，并在后续消息中明确批准实施。
- [x] 运行 `task.py start`，确认任务状态由 `planning` 变为 `in_progress`。
- [x] 使用 `trellis-before-dev` 读取 CLI/backend、Python script、cross-platform 与测试规范。
- [x] 在修改 `_write_text_atomic` 前运行 GitNexus upstream impact，报告 blast radius；如为 HIGH/CRITICAL，先向用户提示。

## Phase 1：保护现场并建立 release 分支

- [x] 记录主仓、docs-site、marketplace 的 branch、HEAD、dirty paths、submodule SHA 和远端差异快照。
- [x] 精确提交本任务规划/激活 artifacts；不暂存任何既有无关路径。
- [x] fetch 主仓与两个子仓，重新确认 npm `latest`、`v0.6.11` tag 和远端 release 基线。
- [x] 从最新 `origin/main` 创建隔离 `release/v0.6.12` worktree/branch。
- [x] 普通 merge 本地 `main`，保留两侧历史；解决版本/gitlink/文档冲突后确认 CLI/Core 基线均为 `0.6.11`。
- [x] 审查 merge diff 与 ancestry，禁止 rebase、强推、历史丢失或把原工作树脏改带入 release 分支。

## Phase 2：修复 context 哈希缺陷

- [x] 在 `execution_context.py::_write_text_atomic` 的 `os.fdopen` 调用中显式加入 `newline="\n"`，保持其余原子写入语义不变。
- [x] 在 `execution-runtime.test.ts` 增加 raw bytes SHA-256 和 `budget.usedBytes` 断言。
- [x] 增加 Linux 可执行的 Windows CRLF 默认转换 probe，证明旧写法失败、显式 newline 后通过。
- [x] 运行 content/manifest 篡改、pull、SubagentStart hook push 和 redaction 相关回归测试。
- [x] 核对 bundled workflow 默认 `shared-worktree`；审阅文档是否误称 worktree/sandbox transport 已支持。仅在发现默认静默失败时做最小 fail-fast 修复。

## Phase 3：发布产物整理

- [x] 按 `v0.6.11..release/v0.6.12` 的用户可观察 diff 复核 `0.6.12.json`；加入 Windows context hash bug fix，保持无迁移补丁语义。
- [x] 更新中英文 v0.6.12 changelog 的日期、Bug Fixes 和 Upgrade；保证章节/表格/代码块 1:1。
- [x] 审阅 docs-site 25 个 tracked 改动、2 个 changelog 和 `docs.json`，修正 role/隔离能力表述。
- [x] 审阅 marketplace `3a78f3e` 与实际 planning convergence workflow 一致性。
- [x] 对 docs-site 创建精确提交；marketplace 不产生无必要新提交。
- [x] 在主仓 release 分支更新已审查的子模块 gitlink，并创建精确发布准备提交。

## Phase 4：本地质量门（不改变远端）

- [x] 运行 context 定向测试和相关 hook/platform 契约测试；后端测试使用 60 秒硬超时。
- [x] 运行 `pnpm --filter @wjptz/suncode lint:py`、root lint、typecheck、完整 test 和 build。
- [x] 运行 manifest continuity、版本一致性、publish plan 和 packed CLI/core 校验。
- [x] 构建两个 tarball，在全新临时目录安装并验证 CLI/Core 版本、精确依赖、init/update 和 DAG context smoke。
- [x] 运行双语 changelog/docs navigation 结构检查和三个仓库的 `git diff --check`。
- [x] 运行 GitNexus `detect_changes({scope: "compare", base_ref: "main"})`，核对受影响符号和执行流。
- [x] 对比 Phase 1 快照，确认原工作树无关 dirty paths 未被修改、暂存或提交。
- [ ] 汇总本地提交 SHA、完整验证证据、未执行项、远端 ahead/reachability 和准确发布动作，向用户提供独立 go/no-go；停止等待批准。

## Phase 5：正式发布（必须另获 go/no-go 批准）

- [ ] push docs-site 目标提交并验证 origin 可达。
- [ ] push marketplace `3a78f3e` 并验证 origin 可达。
- [ ] push 主仓 release 准备历史到 `origin/main`，验证 gitlink 与 ancestry。
- [ ] 从 `origin/main` 建立全新递归 clone，设置 LF checkout，确认主仓/子模块 clean 且 SHA 一致。
- [ ] 安装冻结依赖，先执行 root build，再复核 release check/plan。
- [ ] 执行官方 stable patch release 命令，由脚本生成并 push `0.6.12` 版本提交与 `v0.6.12` tag；禁止本地 npm publish。
- [ ] 记录版本提交、tag SHA 和 GitHub Actions workflow URL。

## Phase 6：发布后验证与归档

- [ ] 监控 CI/publish workflow 到终态；失败时按设计中的 tag 后故障策略停止处理。
- [ ] 验证 GitHub tag、`origin/main`、两个子仓目标提交与子模块 gitlink 一致。
- [ ] 从公共 npm 验证 `@wjptz/suncode@0.6.12` 与 `@wjptz/suncode-core@0.6.12` 均存在，且 `latest=0.6.12`。
- [ ] 从公共 npm 全新安装并复核 CLI/Core 版本、精确 core 依赖、manifest 和 CLI 可执行性。
- [ ] 将测试、workflow、tag、npm、提交和工作区保护证据写入任务记录。
- [ ] 运行 Trellis finish-work 质量收尾、journal 更新与任务归档。

## 计划验证命令族

实施时以合并后 `package.json` 和 release scripts 为准，至少覆盖：

```bash
timeout 60s pnpm --filter @wjptz/suncode test -- execution-runtime.test.ts
pnpm --filter @wjptz/suncode lint:py
node packages/cli/scripts/check-manifest-continuity.js
pnpm lint
pnpm typecheck
timeout 60s pnpm test
pnpm build
pnpm release:check
pnpm release:plan
node packages/cli/scripts/release-preflight.js verify-packed-cli
```

稳定 patch 不伪装成 beta/rc/promote 来运行 `check-docs-changelog.js`；改用等价静态检查验证双语 MDX、`docs.json` 页面条目和 navbar。

## 预计修改与提交边界

- **代码修复**：`packages/cli/src/templates/suncode/scripts/common/execution_context.py`。
- **回归测试**：优先只改 `packages/cli/test/templates/execution-runtime.test.ts`；只有现有测试结构无法表达 probe 时才新增一个小型 fixture/helper。
- **Manifest**：`packages/cli/src/migrations/manifests/0.6.12.json`。
- **Docs-site**：现有 25 个横切文档、双语 v0.6.12 changelog 和 `docs.json`，逐项审查后精确提交。
- **Marketplace**：复用并推送已审查的 `3a78f3e`，不顺带提交其他内容。
- **主仓准备提交**：merge、代码/测试/manifest、子模块 gitlink 和本任务记录；不得包含当前用户的无关脏路径。
- **版本提交**：只由干净 clone 中的官方 release script 修改 CLI/Core `package.json` 并创建。
- **Tag**：只创建 `v0.6.12`，不得覆盖、移动或重打。

## 停止条件

以下任一情况出现即停止，不进入发布 go/no-go：

- context raw bytes、manifest hash 或 budget 任一不一致；
- 篡改后的 context 被接受或失配内容进入 worker；
- merge 后丢失任一历史线、版本基线不是双包 `0.6.11`；
- 子模块目标提交无法从对应远端获取；
- 任一必需 lint/typecheck/test/build/pack/smoke 未执行或失败；
- 原工作树无关 dirty paths 被改动、暂存或提交；
- manifest/changelog/docs 对未验证隔离能力作出超出事实的承诺。
