# DAG 规划重复触发：根因证据

## 结论

重复生成/验证主要是持续性 prompt 契约问题，不是 CLI 后台任务：

```text
每条用户消息
  → per-turn hook/plugin 读取 task status
  → 注入 planning breadcrumb
  → breadcrumb 无条件要求 create + validate execution.json
  → Agent 把 required-once 误执行为 per-turn action
```

## 直接证据

- `packages/cli/src/templates/suncode/workflow.md:207`：Phase 1.4 标记为 `[required · once when execution.dag.enabled]`。
- `packages/cli/src/templates/suncode/workflow.md:218,233`：planning 与 planning-inline 每轮 block 无条件写入 `create and validate execution.json`。
- `packages/cli/src/templates/shared-hooks/inject-workflow-state.py:1-18,184-207`：hook 在每个 user prompt 执行，并从 `workflow.md` 读取 block；没有 DAG CLI 调用。
- `packages/cli/src/templates/opencode/plugins/inject-workflow-state.js:391-435`：OpenCode 在每条 `chat.message` 前置相同 breadcrumb。
- `packages/cli/src/templates/pi/extensions/suncode/index.ts.txt:1129-1156,1715-1732`：Pi 每轮读取并提供 workflow breadcrumb。
- `packages/cli/src/templates/suncode/scripts/common/task_execution.py:200-226`：validate 只读取、校验并输出结果。
- `packages/cli/src/templates/suncode/scripts/common/task_execution.py:250-266`：scaffold 已有文件时拒绝，除非显式 `--force`。
- `packages/cli/src/templates/suncode/scripts/task.py:83-138`：`task.py start` 只在生命周期边界检查计划，不自动 scaffold。

## 已有复用基础与缺口

- `ExecutionPlan.plan_hash` 已对规范化计划计算稳定 SHA-256。
- runtime 启动时冻结 `planHash`，恢复时发现计划变化会拒绝自动继续。
- 显式 `execution.json` 优先；缺失时才使用 legacy normalization。
- 当前没有 PRD/design/implement 的输入 fingerprint，也没有 `missing/current/stale/invalid` 规划状态，因此无法确定“计划源变化但 DAG 未变”。

## 方案层级

### 方案 A：只修 breadcrumb/workflow

- 把 DAG 指引改成 `planning_converged` 后的一次性条件动作。
- 优点：改动小、直击根因、低迁移风险。
- 缺点：跨会话的 stale 判断仍依赖 Agent 对 artifact diff 的理解。

### 方案 B：条件化 workflow + 规划输入 fingerprint

- 在方案 A 基础上，以任务规划 artifacts 的规范化内容计算 fingerprint。
- 相同 fingerprint 直接复用；变化时报告 stale，但不自动覆盖 DAG。
- 优点：跨会话可确定、可测试，能区分普通沟通与实质规划变化。
- 缺点：需要定义 fingerprint 输入、持久化位置、旧计划兼容和刷新命令，改动面更大。

## 已确认产品决策

本任务选择方案 A，不引入 fingerprint 或文档状态机制：

- 首次建图依赖 Agent 按明确 checklist 判断 `planning_converged`；
- 已有 DAG 是否受规划变化影响，由 Agent 对照权威 planning artifacts 判断；
- 结构合法性继续由 `execution validate` / `task.py start` 保证；
- 运行时计划变化继续由现有 `planHash` 保证；
- 方案 B 及其 `missing/current/stale/invalid` 状态不进入本任务。

## 新发现的实施边界

`marketplace` 子仓库的以下文件包含同样的无条件 DAG planning 指令，并且当前均已有未提交改动：

- `workflows/native/workflow.md`
- `workflows/tdd/workflow.md`
- `workflows/channel-driven-subagent-dispatch/workflow.md`

主仓测试要求 native workflow 与 packaged Suncode workflow 保持字节一致；TDD/channel workflow 也必须保持同一个 convergence 语义。因此只修改主仓会造成跨模板漂移和测试失败，但直接提交子仓库又可能吸收当前用户工作。实施前必须先明确这三份文件的所有权和提交边界。

## 现有设计约束

- `execution.json` 是稳定、可审查的规范计划。
- `scaffold` 只是保守起点，不能作为自动重建器。
- DAG 必须在最终规划摘要中供用户审查，然后才允许实施审批。
- 运行时计划哈希与规划输入 freshness 是两个不同问题，不应混用。
