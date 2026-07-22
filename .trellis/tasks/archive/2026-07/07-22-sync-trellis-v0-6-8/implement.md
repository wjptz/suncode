# Trellis v0.6.8 实施计划

## 实施前置

- 用户必须在本规划摘要之后，用新的消息明确批准最新 `prd.md`、`design.md` 与 `implement.md`。
- 批准后运行 `python3 ./.trellis/scripts/task.py start .trellis/tasks/07-22-sync-trellis-v0-6-8`，不得在 planning 状态改产品代码。
- 加载 `trellis-before-dev`，完整读取该技能要求的 CLI/core/test/docs spec；当前为 Codex inline，不维护 `implement.jsonl` / `check.jsonl`。
- YCE 已完成一次全局代码定位；进入具体批次时用准确英文 query 补充目标代码定位。
- 修改每个现有函数、类或方法前运行 GitNexus `impact({target, direction:"upstream"})`。HIGH/CRITICAL 必须先报告 direct callers、affected processes 和风险，再编辑。
- 始终把任务创建前的用户脏改视为不可触碰边界，只 stage 本任务文件。

## 实施清单

- [x] [P0] 建立逐符号影响基线: 对 `collectSafeFileDeletes`、`classifyMigrations`、`executeMigrations`、`downloadTemplate`、`wrapWithCommandFrontmatter`、`wrapWithOmpFrontmatter`、`getConfiguredPlatforms`、`init`、task script handlers、mem session fan-out、Codex hook normalization 和 channel supervisor 逐一运行 GitNexus upstream impact；记录 HIGH/CRITICAL 风险和测试覆盖。
- [x] [P0] 加固 update 与模板下载: 保护 reintroduced current templates；实现 canonical-target-aware rename-dir merge/hash cleanup；移除 registry `preferOffline`；保留 temp-first overwrite 和失败回滚；增加 mixed ownership 与 Windows 路径测试。
- [x] [P0] 迁移 Pi 共享 skills: 让 Pi 使用 neutral resolver 写入 `.agents/skills`，移除 private settings root，增加 Suncode 自有版本 migration；验证 Pi 与 Codex/Gemini/Kimi 的字节一致性、旧目录迁移和用户文件保护。
- [x] [P0] 实现 task JSON 与默认分支合同: 增加 `list/current --json`、派生 display status、default branch resolver、`--base-branch` override 和 stale branch warnings；同步 live/template Python 资产并覆盖 no-repo/detached/fallback 场景。
- [x] [P1] 修复 command frontmatter 与 OMP context bridge: 对普通/OMP command description 安全引用；为 OMP Bash `tool_call` 注入 `SUNCODE_CONTEXT_ID`，保留显式 env、非 Bash params、command 和 process env。
- [x] [P1] 增加 Grok 与 Kimi 平台: 扩展类型/registry/configurator/template/init/update/uninstall/workflow；全部资产使用 Suncode 命名；共享 skills 走 neutral resolver；增加平台组合、ownership detection 和回归测试。
- [x] [P1] 接入 ZCode readonly SQLite mem: 移植 final-state SQLite/WAL parser 和 corruption hardening；实现 ZCode adapter、session/project/context/CLI 接入与 tests；明确不新增 ZCode hooks/settings，也不改变 OpenCode no-op adapter。
- [x] [P1] 增加 Codex native dispatch 能力: 加入 `SubagentStart` hook/context builder、`max_depth=1` 和单一 dispatch normalization；支持旧 alias，但保持 missing/invalid/default 为 inline；测试 stale parent session、hook fail-open、精确 task context 和 recursion guard。
- [x] [P1] 增加 Codex channel sandbox: 在 CLI 边界解析三种 sandbox，使用专用 union type贯通 spawn/supervisor/adapter，默认 `workspace-write`，覆盖非法值和非 Codex provider。
- [x] [P1] 收紧 planning 与 SessionStart 合同: 将 requirement convergence/final-summary approval gate 和语言策略同步到所有 Suncode skill/prompt/hook canonical templates；material plan change 触发重审；保持中文规划文档和 workflow-state 注入。
- [x] [P1] 同步 specs、README、marketplace、docs-site 与 CI: 按实际最终行为更新 Suncode specs/README；在 marketplace 提交 native workflow mirror，在 docs-site 提交双语平台/命令文档；主仓 CI/publish build-before-test；确认 `.husky/pre-commit` 未修改。
- [x] [P0] 执行全量质量门与影响复核: 运行定向/全量 CLI/core tests、lint、typecheck、build、basedpyright、template parity、`git diff --check`；运行 GitNexus `detect_changes(scope="compare", base_ref="main")` 并复核所有 changed symbols/processes。
- [x] [P0] 提交实现并推进同步记录: 先提交 docs-site、marketplace 和主仓已验证实现；追加唯一 ledger marker，记录 41 commit matrix、adoption/exclusion、local/related commits、验证与任务路径；运行 checkpoint advance/validate；以独立 commit 提交 ledger+JSON cursor；不 push。

## 分批验证

### Update、migration、frontmatter

```bash
timeout 60s pnpm --filter @wjptz/suncode test -- test/commands/update.integration.test.ts
timeout 60s pnpm --filter @wjptz/suncode test -- test/commands/update-internals.test.ts
timeout 60s pnpm --filter @wjptz/suncode test -- test/utils/download-with-strategy.test.ts
timeout 60s pnpm --filter @wjptz/suncode test -- test/configurators/shared.test.ts
```

### 平台、hooks、workflow、task

```bash
timeout 60s pnpm --filter @wjptz/suncode test -- test/configurators/platforms.test.ts
timeout 60s pnpm --filter @wjptz/suncode test -- test/templates/grok.test.ts test/templates/kimi.test.ts
timeout 60s pnpm --filter @wjptz/suncode test -- test/templates/pi.test.ts test/templates/omp.test.ts test/templates/codex.test.ts
timeout 60s pnpm --filter @wjptz/suncode test -- test/templates/shared-hooks.test.ts
timeout 60s pnpm --filter @wjptz/suncode test -- test/regression.test.ts
timeout 60s pnpm --filter @wjptz/suncode test -- test/commands/platforms.integration.test.ts
```

### Channel 与 mem

```bash
timeout 60s pnpm --filter @wjptz/suncode test -- test/commands/channel-codex-adapter.test.ts
timeout 60s pnpm --filter @wjptz/suncode-core test -- test/mem/sqlite-readonly.test.ts
timeout 60s pnpm --filter @wjptz/suncode-core test -- test/mem/adapters.test.ts test/mem/api.test.ts
timeout 60s pnpm --filter @wjptz/suncode test -- test/commands/mem-integration.test.ts test/commands/mem-helpers.test.ts
```

测试文件名以实施后的真实路径为准；若上游命名与 Suncode test layout 不一致，使用现有同层文件承载，不为追求同名重复建测试。

## 完整质量门

```bash
timeout 60s pnpm test:core
timeout 60s pnpm test:cli
pnpm lint
pnpm typecheck
pnpm build
pnpm --filter @wjptz/suncode lint:py
git diff --check
```

此外必须：

- 验证 `packages/cli/src/templates/suncode/workflow.md` 与 `marketplace/workflows/native/workflow.md` 的要求性镜像关系。
- 在 docs-site、marketplace 和主仓分别检查 `git status --short`，确认没有无关文件。
- 在主仓检查 staged diff，确认用户已有 `AGENTS.md`、`CLAUDE.md`、GitNexus skill 与 draft 未进入提交。
- 运行 GitNexus `detect_changes(scope="compare", base_ref="main")`；若 index 落后，先更新索引再复核。

## 提交与 checkpoint 顺序

1. 提交 marketplace workflow mirror，记录 related commit。
2. 提交 docs-site 文档，记录 related commit。
3. 主仓提交经过验证的产品代码、tests、spec、CI、task planning/research，并更新两个 submodule pointers；不包含 ledger/cursor 和用户无关改动。
4. 在 `references/sync-ledger.md` 顶部追加 `<!-- sync-entry:2026-07-22-v0.6.8 -->`，记录官方 range、41 提交矩阵结果、主仓/related commits、验证、排除和任务路径。
5. 运行：

   ```bash
   python3 ./.agents/skills/sync-trellis-upstream/scripts/sync_checkpoint.py advance \
     --reviewed-version v0.6.8 \
     --reviewed-commit dc68f5a92a68489b681c511f4a784e413d724e85 \
     --date 2026-07-22 \
     --ledger-entry 2026-07-22-v0.6.8 \
     --task .trellis/tasks/07-22-sync-trellis-v0-6-8 \
     --local-commit <main-implementation-commit> \
     --related-commit marketplace=<marketplace-commit> \
     --related-commit docs-site=<docs-site-commit>
   ```

6. 再运行 `sync_checkpoint.py validate`，确认游标和 ledger marker 一致。
7. 以独立 checkpoint commit 提交 `sync-ledger.md` 与 `sync-state.json`。
8. 运行 `trellis-finish-work` 完成归档与 journal；不 push。

## 停止条件

出现任一条件立即停止推进 cursor：

- 41 个提交中仍有未分类项。
- 任一规划内实现、相关子模块、required test、lint/typecheck/build 或 GitNexus 复核未完成。
- HIGH/CRITICAL impact 尚未报告或测试覆盖不足。
- 提交会混入用户现有无关改动。
- ledger marker、实现 commit、related commit 或官方 release ref 缺失/不一致。
- target 不再是当前 checkpoint 的后代，或官方 remote tag identity 发生变化。

## 当前状态

- [x] 官方 target/ref/ancestor/41 commit range 已核验。
- [x] commit-level adoption matrix 已写入 `research/upstream-v0.6.8-adoption.md`。
- [x] `prd.md`、`design.md`、`implement.md` 已完成并收敛，无阻塞性开放问题。
- [x] 用户已在最新最终规划摘要后的后续消息中明确要求“进入实施”。
- [x] `task.py start` 已运行，任务状态为 `in_progress`。
- [x] marketplace commit：`62f7bf94df10557936b01708f431013c66538d22`。
- [x] docs-site commit：`129339dad5b0ed03546258985771d6ade1c54888`。
- [x] 全量质量门与 GitNexus compare 审计已完成；主仓实现 commit `a7b2ff82e83ed024230428684b9ee1dd48b45cfc` 与 checkpoint commit `4c0571777b065ebab7a92b071d115f4e5838961f` 已完成。
