# 修复统一执行 DAG 复审阻断项

## 目标

修复父任务 Phase 2.2 复审确认的 7 项阻断缺陷，使执行 DAG 在恢复、并行冲突、重试、结果提交、任务生命周期、最终质量门和 adapter 派发上满足原 PRD 与设计契约。

## 背景

- 父任务：`07-23-universal-execution-dag`。
- 当前实现的正常路径测试全绿，但复审已独立复现活 worker 被误判 orphan、等价 scope 并行、blocked 后继无法解锁、无效成功结果被接受、planning 任务启动 runtime、普通 implement 节点充当 final barrier，以及 claim envelope 缺少角色字段。
- 修复必须保持 `execution.json` v1、旧任务保守归一化、inline/native-subagent/channel 三类执行器和 Hub v1 投影兼容。

## 需求

1. 普通 `recover` 只能协调已持久化结果，不能在无法证明执行器失联时改变 active 节点；显式确认 orphan 必须使用清晰的 CLI 参数。
2. reads/writes scope 在计划解析边界规范化为稳定的 POSIX 逻辑表示；等价路径、仓库根和大小写差异不得绕过共享工作树冲突检测。
3. `blocked` 是依赖状态的可重算派生结果；祖先进入 retry 并成功后，所有受影响后继必须按拓扑重新解锁。
4. `NodeResult.status=succeeded` 只有在声明的验证全部通过并提供证据时才能接受；reported changes 必须位于节点 writes 中，read-only 节点不得报告变更，artifact 必须位于当前 run 的 artifacts 命名空间。
5. `execution start-run` 必须要求任务状态为 `in_progress`，不得绕过 `task.py start`。
6. final barrier 节点必须是 sink、角色为 `integration` 或 `check`、声明验证，并分别汇聚所有非 final 分支；barrier 身份即全局质量门标记。
7. claim 返回的 dispatch envelope 必须直接包含与 manifest 一致的 `role`、`name` 和 adapter 选择所需元数据。
8. 所有缺陷必须有失败回归测试，并保持已有兼容测试通过。
9. 所有版本号及 attempt 等整数协议字段必须拒绝 boolean、float 和 string 等 Python 中可能与整数相等的值。
10. NodeResult v1 的嵌套对象必须执行字段白名单与可选字段类型检查，不能静默接受未版本化 metadata；重复 validation command 必须拒绝。
11. cycle 检测与 final barrier 祖先闭包不得依赖 Python 递归栈，超过默认递归深度的合法 DAG 和 cycle 都必须产生协议定义的结果。

## 验收标准

- [x] active worker 无结果时，普通 recover 保持 `dispatched/running` 且明确报告 liveness 未确认；`--force-orphan` 才能进入 orphan/retry 流程。
- [x] `./src/shared/**` 与 `src/shared/**`、`.` 与仓库内路径、重复分隔符及大小写等价 scope 不会被同时选中。
- [x] `failed -> blocked -> explicit retry -> succeeded` 后直接后继和三层后继可重新进入 ready/pending 闭包。
- [x] succeeded + 空验证、失败/未知验证、缺少证据、遗漏声明验证、越界 changes、read-only changes、越界 artifact 均被拒绝。
- [x] planning 任务执行 `start-run` 失败，`in_progress` 任务行为不变。
- [x] implement final、非 sink final、未汇聚全部分支的多 final 计划均被拒绝；合法 integration/check final 通过。
- [x] claim JSON 中 `dispatch.role` 与 `dispatch.name` 可直接供工作流选择 agent。
- [x] reported change 的大小写不能扩大节点 writes：`src/**` 不授权 `SRC/**`。
- [x] final `check` 无论使用 shared-worktree 还是隔离 worktree，都必须保持 `writes=[]`。
- [x] 1200 层以上的合法具体 change path 不会因递归 matcher 触发 `RecursionError`。
- [x] execution plan、NodeResult、runtime state、context manifest 和 executor capability 的 version/attempt 只接受精确整数，拒绝 `true`、`1.0` 与 `"1"`。
- [x] NodeResult 的 `changes/findings/validation/artifacts` 拒绝未知字段；`location/evidence/hash` 一旦出现必须为字符串；重复 validation command 被拒绝。
- [x] 1200 层以上的合法串行 DAG 通过校验，深层 cycle 返回结构化错误而不是 `RecursionError`。
- [x] worktree 与 sandbox 两种隔离下，writable final check 均有失败回归测试。
- [x] CLI 定向测试、完整测试、lint、typecheck、Python 检查与 build 通过。

## 约束

- 不实现无法跨 adapter 可靠验证的伪 liveness probe；首版使用“默认保持 active + 显式 force orphan”的安全降级。
- 不修改历史 migration manifest；如模板契约变化，只更新当前未发布父任务所引入的文件和新测试。
- 不回滚或整理工作树中的无关用户改动。
