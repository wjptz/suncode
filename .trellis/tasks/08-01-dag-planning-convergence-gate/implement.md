# DAG 规划收敛门禁：实施计划

## 实施清单

- [x] [P1] 固化规划收敛契约：更新 packaged workflow 的 planning、planning-inline 与 Phase 1.4，使 DAG 仅在 blocking questions 清空且 planning artifacts 收敛后 finalization 一次。
- [x] [P1] 同步 marketplace native：在保留已授权既有 DAG diff 的基础上，与 packaged workflow 保持字节一致。
- [x] [P1] 同步 marketplace TDD/channel 变体：加入相同 convergence 门禁，同时保留 TDD behavior slices 与 channel worker 调度语义。
- [x] [P1] 增加回归测试：锁定 not-per-turn、未收敛不处理 DAG、missing/reuse/material-change 分支、禁止自动 force、最终摘要后审批和 marketplace parity。
- [x] [P2] 更新项目 spec：在 workflow-state 与 execution DAG 契约中记录 required-once breadcrumb 的条件化、幂等语义。
- [x] [P2] 验证 fresh/update 分发：确认 hash-tracked whole-file workflow 更新会把旧 pristine 项目推进到新 convergence 文案。
- [x] [P1] 完成全量验证与提交边界审计：先 marketplace 子仓提交，再主仓提交及 submodule pointer。

## 实施结果

- 定向测试：3 个文件、417 个测试通过。
- 完整测试：CLI 77 个文件、1697 个测试通过；core 20 个文件、332 个测试通过，1 个既有 skipped。
- ESLint、TypeScript typecheck、build 通过。
- BasedPyright：0 error、64 个既有 unused re-export warning。
- packaged/native workflow 字节一致；main/marketplace `git diff --check` 通过。
- 用户已完成 Phase 3.4 一次性确认；提交按 marketplace → 主仓及 submodule pointer 的顺序执行。

## 修改范围

### 主仓

- `packages/cli/src/templates/suncode/workflow.md`
- `packages/cli/test/templates/suncode.test.ts`
- `packages/cli/test/regression.test.ts`
- `packages/cli/test/commands/update.integration.test.ts`（仅在现有 whole-file update case 追加 convergence 断言）
- `.trellis/spec/cli/backend/workflow-state-contract.md`
- `.trellis/spec/cli/backend/execution-dag-contract.md`
- 当前任务 planning artifacts
- `marketplace` submodule pointer

### Marketplace 子仓库

- `workflows/native/workflow.md`
- `workflows/tdd/workflow.md`
- `workflows/channel-driven-subagent-dispatch/workflow.md`

### 明确不修改

- DAG Python runtime/model/CLI 实现
- hook/plugin/extension parser
- config、package version、migration manifest/schema
- `docs-site`
- `.claude/skills/gitnexus/**`、`AGENTS.md`、`CLAUDE.md`、`drafts/**`

## 实施顺序

1. 对将修改的现有测试辅助函数/符号执行 GitNexus impact；workflow Markdown 不包含代码 symbol，但仍做文件级范围审查。
2. 先写失败回归断言，证明当前无条件 planning breadcrumb 不满足 convergence 契约。
3. 修改 packaged workflow 的 planning 与 planning-inline block。
4. 修改 Phase 1.4，加入 missing/reuse/material-change 的明确分支和审批顺序。
5. 将 packaged workflow 同步到 marketplace native，并逐段适配 TDD/channel 变体。
6. 更新 workflow-state 与 execution DAG spec。
7. 运行定向测试并修复差异，不修改 DAG runtime 来规避文案契约问题。
8. 运行完整 CLI 质量门与模板 build/parity 检查。
9. 审计 marketplace diff 只含三份授权 workflow；执行 GitNexus/差异检查后提交 marketplace。
10. 主仓显式暂存白名单，包含新的 submodule pointer，排除其余用户工作；运行 GitNexus staged/compare 审计后提交。

## 定向验证

在仓库可用脚本确认后执行等价命令：

```bash
timeout 60s pnpm --filter @wjptz/suncode test -- \
  test/templates/suncode.test.ts \
  test/regression.test.ts \
  test/commands/update.integration.test.ts
```

附加静态/一致性检查：

```bash
git diff --check
git -C marketplace diff --check
cmp packages/cli/src/templates/suncode/workflow.md \
    marketplace/workflows/native/workflow.md
```

## 完整质量门

```bash
pnpm lint
pnpm typecheck
pnpm build
timeout 60s pnpm test
```

构建后验证：

- CLI/core 必需 dist 入口存在；
- source 非 TypeScript templates 与 dist byte-identical；
- packaged/native workflow byte-identical；
- BasedPyright 0 error；warning 单独报告；
- `git diff --check` 与两个仓库 staged whitelist 通过；
- GitNexus `detect_changes(scope="compare", base_ref="main")` 和提交前 staged 审计完成。

## 回滚点

- 回归测试无法用纯 workflow 契约表达时，停止并回到设计；不得临时引入 fingerprint/state schema。
- 若 marketplace 三份 diff 出现此前审计未识别的范围外内容，停止提交并重新确认边界。
- marketplace 提交成功、主仓失败时，保留子仓 commit hash，不推送；修复主仓后再更新 pointer。
- 主仓提交完成后需要回滚时，先 revert 主仓，再 revert marketplace；不执行历史重写。

## 实施前检查

- PRD 阻塞性开放问题为空。
- 用户已确认不采用复杂文档状态机制。
- 用户已授权接管 marketplace 三份现有 workflow 改动。
- 最新最终规划摘要已经展示；实施必须等待后续消息明确批准。
