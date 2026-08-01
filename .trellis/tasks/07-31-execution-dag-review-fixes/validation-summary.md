# 验证摘要

## 结论

Phase 2.2 复审提出的 7 项阻断问题已修复，并新增恢复竞态、worker-reported blocked 终态保护，以及后续复审发现的 change 大小写边界、隔离 final check 写权限、深路径递归、跨语言整数词法、目录身份、并发上限原子性和 manifest 策略缺失保护。当前源码通过 CLI 完整质量门，可以重新进入代码复审；本摘要不把未跟踪文件缺失于 GitNexus compare 结果误写成低风险证明。

## 修复映射

1. Recovery：普通 recover 保留 active attempt；新增显式 `--force-orphan`；已落盘结果优先于 force；non-idempotent orphan 需显式 retry。
2. Scope：计划边界统一 POSIX 规范化，覆盖 `./`、重复分隔符、反斜杠、`.`、大小写、drive path 与 glob 语法；冲突比较大小写折叠，reported change containment 保持精确大小写；路径 matcher 使用迭代状态推进，深路径不依赖 Python 调用栈。
3. Retry closure：仅依赖派生、无 result 引用的 blocked 会拓扑重算；三层后继可恢复；worker 主动返回的 blocked 保持终态。
4. NodeResult：成功结果必须精确覆盖声明验证、全部 passed 且有 evidence；changes 必须在 writes；read-only 禁止 changes；artifact 限定在 `artifacts/`。
5. Lifecycle：runtime 边界要求 `task.json.status == in_progress`。
6. Final barrier：每个 final 必须为 integration/check sink，并各自汇聚全部 non-final 节点；final check 在所有 isolation 模式下都必须只读。
7. Dispatch：claim envelope 增加 `role`、`name`、`contextProfile`、`isolation`。
8. JSON 整数词法：OpenCode manifest 与 Hub execution projection 基于原始 JSON token 拒绝 boolean、float、指数和 string 伪整数；manifest 的规范化哈希不能绕过词法门禁。
9. 目录身份：`execution.json.task` 绑定实际 task 目录；每次载入 runtime 时重新校验 `taskId`、`taskPath` 与 `runId`。
10. 并发上限：capability factory、直接 adapter 与持久化 state 三个边界只接受精确正整数 `maxConcurrency`，创建 runtime 前即失败。
11. Context 权威性：manifest 与 worker 可见的 `content.md` 同时携带 plan version 和完整 node execution policy，Python/OpenCode 消费端执行对应校验。

## 最终验证

- 第四轮定向回归：3 个测试文件、208/208 通过，设置 60 秒硬超时，约 13 秒。
- CLI 完整测试：65 个测试文件、1590/1590 通过，设置 60 秒硬超时，约 19 秒。
- ESLint：通过。
- TypeScript typecheck：通过。
- BasedPyright：0 error、64 warning；warning 均为既有 `common/__init__.py` 与 `git_context.py` 未使用 re-export。
- Python 源码语法编译检查：execution model/runtime/context 通过。
- CLI build：通过；模板与 migration manifest 已复制到 `dist`。
- Prettier：Hub submission 源文件及 3 个目标测试文件通过格式检查。
- 独立源码探针：reported change 大小写不匹配被拒绝、1200 层深路径被接受、可写隔离 final check 被拒绝。
- bundled workflow 与 marketplace native mirror 契约测试：通过。
- `git diff --check`：通过。

## 影响与剩余边界

- GitNexus 修改前 impact：`_refresh_state`、scope 解析、final barrier 为 CRITICAL；NodeResult 验证为 HIGH；恢复与 dispatch CLI 入口为 LOW。修复围绕这些边界函数实施。
- GitNexus `detect_changes(compare main)`：整个现有脏工作树为 high risk；最终报告的已索引范围包含 23 个变更文件、45 个变更符号和 7 条受影响流程。该数字混合本子任务与既有用户改动，且不覆盖所有未跟踪文件。
- compare 报告不能完整表示未跟踪的新 Python runtime 模块，因此最终信心来自定向状态机测试、完整 CLI 测试、静态检查和 build 的组合，而非 GitNexus 单项报告。
- 当前工作树仍混有父任务实现和无关用户改动；本子任务未自动提交或归档，避免把不可分离的已有改动打包进错误提交。
