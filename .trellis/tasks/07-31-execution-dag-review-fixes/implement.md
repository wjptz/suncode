# DAG 复审阻断项修复实施计划

## 实施清单

- [x] [P0] 修复 recovery：普通恢复保留 active attempt，增加显式 force-orphan 契约并改写错误语义测试。
- [x] [P0] 修复 scope：统一规范化、大小写安全冲突比较和具体路径 containment。
- [x] [P0] 修复状态机：让 blocked 后继随祖先 retry/success 递归重新计算。
- [x] [P0] 强化 NodeResult：验证覆盖、状态/证据、写边界、read-only 和 artifact containment。
- [x] [P1] 加固 start-run 生命周期门禁和 final barrier 全局质量门语义。
- [x] [P1] 补齐 dispatch envelope 的 role/name/contextProfile/isolation。
- [x] [P0] 为 7 项发现补齐定向回归测试并修正现有不安全恢复断言。
- [x] [P0] 完成二次复审加固：change containment 保持精确大小写、final check 强制只读、scope matcher 改为迭代状态推进。
- [x] [P0] 完成第三轮复审加固：cycle/final 闭包使用迭代遍历，深图不再触发 `RecursionError`。
- [x] [P0] 对 plan/result/runtime/context/capability 的版本与 attempt 执行精确整数校验。
- [x] [P0] 收紧 NodeResult v1 嵌套 schema，拒绝未知字段、错误可选字段类型与重复 validation command。
- [x] [P0] 增加 1205 节点深链/深 cycle、精确整数矩阵、嵌套 schema 及 sandbox final check 回归测试。
- [x] [P0] 修复 OpenCode/Hub 的 raw JSON 整数词法门禁，并覆盖顶层/嵌套 `1.0` 与 `1e0`。
- [x] [P0] 绑定 plan/runtime 的 task、path、run identity，身份不一致时在公共入口失败。
- [x] [P0] 在 capability factory、直接 adapter 和 state load 边界拒绝非精确正整数 maxConcurrency。
- [x] [P1] 把 planVersion 与完整 execution policy 写入 manifest 和实际 worker content。
- [x] [P1] 重跑第四轮定向测试、CLI 完整测试、lint、typecheck、BasedPyright、Prettier 与 build，并执行全范围 Trellis 检查。

## 验证命令

后端/模板测试均使用 60 秒硬超时：

```bash
timeout 60s pnpm --dir packages/cli exec vitest run test/templates/execution-runtime.test.ts
timeout 60s pnpm --dir packages/cli test
pnpm --dir packages/cli run lint
pnpm --dir packages/cli run typecheck
pnpm --dir packages/cli run lint:py
pnpm --dir packages/cli run build
```

以 `packages/cli/package.json` 中实际存在的 script 为准；不存在的命令需改用仓库现有等价质量门并记录。

## 本轮验证证据

- 第四轮定向回归：`3` 个测试文件、`208/208` 通过，受 60 秒硬超时保护。
- CLI 完整测试：`65` 个测试文件、`1590/1590` 通过，受 60 秒硬超时保护。
- ESLint：通过。
- TypeScript typecheck：通过。
- BasedPyright：`0 error`；保留 `64` 个既有 unused re-export warning。
- Python `py_compile`：execution model/runtime/context 通过。
- CLI build：通过。
- Prettier：Hub submission 源文件及 3 个目标测试文件通过。
- `git diff --check`：通过。

## 复审门

- 检查每条 reviewer finding 是否有一条先失败、修复后通过的回归测试。
- 检查模板源码、生成脚本索引和工作流文案是否保持一致。
- 提交前运行 GitNexus `detect_changes(scope=compare, base_ref=main)`；HIGH/CRITICAL 影响必须逐项解释。

## 回滚点

- recovery CLI 与 runtime 参数可独立回滚。
- scope/result 公共校验若引起兼容问题，保留拒绝不安全输入，优先调整诊断与 fixture，不放宽安全边界。
- final barrier 新约束如暴露父任务计划问题，修正当前未发布计划，不为错误契约保留静默兼容。
