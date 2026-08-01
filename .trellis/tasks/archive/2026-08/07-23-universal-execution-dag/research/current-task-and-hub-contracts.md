# 当前任务模型与 Hub 契约调研

## 结论

执行 DAG 不应复用 `task.json.subtasks`、`task.json.children` 或直接改写 Hub `subtasks.json` v1。三者已有不同且需要保持的语义，建议新增规范计划文件 `execution.json`，只在 Hub 上传时投影成 v1 三字段视图。

## 证据

- `packages/cli/src/templates/suncode/scripts/common/task_store.py:399-425`
  - 新任务同时包含 `subtasks: []`、`children: []`、`parent: null`、`relatedFiles` 和 `meta`。
- `packages/cli/src/templates/suncode/scripts/common/task_store.py:448-467`
  - 父任务链接与 children 维护属于任务生命周期关系。
- `packages/cli/src/templates/suncode/scripts/common/task_store.py:175-179`
  - 原生工作流明确不把 parent/children 当作依赖调度器。
- `docs-site/advanced/appendix-c.mdx:29-34,46-54`
  - 文档把 `subtasks` 解释为任务内 `{name,status}` 检查项，把 `children` 解释为子任务路径。
- `packages/cli/src/commands/hub/submissions.ts:791-797`
  - Hub 优先读取任务目录内 `subtasks.json`，否则从 `implement.md` 推导。
- `packages/cli/src/commands/hub/submissions.ts:799-846`
  - implement checklist 解析为 Hub 展示子项。
- `packages/cli/src/commands/hub/submissions.ts:857-884`
  - 支持 v1 顶层数组或 `{subtasks: []}`，最终规范化只保留 `priority`、`name`、`description`。
- `.trellis/spec/cli/backend/suncode-hub-collaboration.md:1278-1303`
  - Hub v1 覆盖文件、规范哈希和请求体契约固定为三字段。
- `packages/cli/test/commands/hub.test.ts:3345`
  - 已有 `subtasks.json` v1 行为测试，新增能力必须锁定其 payload/hash 不变。

## 兼容策略

1. `execution.json` 是执行 DAG 的唯一规范来源。
2. 显式 `subtasks.json` v1 继续拥有最高 Hub 展示优先级。
3. 没有覆盖文件时，从 DAG 节点稳定投影三字段。
4. 旧任务继续从 `implement.md` 解析并保守串行化。
5. 完整 DAG 若需 Hub 同步，未来定义独立、版本化 API，不能借 v1 字段偷渡。
