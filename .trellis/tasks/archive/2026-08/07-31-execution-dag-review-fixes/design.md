# DAG 复审阻断项修复设计

## 设计结论

本轮不引入新的执行器 lease/heartbeat 协议。当前 adapter 的 `executorRef` 不是统一可探测句柄，任何自动存活判断都会制造假安全。因此 recovery 采用保守两阶段语义：

1. 普通 `recover` 只校验计划哈希、协调已落盘结果，并保留无法确认 liveness 的 active attempt。
2. 协调器确认 worker 已失联后，使用 `--force-orphan <node>` 显式转换；幂等且未耗尽 attempt 的节点才自动进入 retrying，非幂等节点保持 orphaned，后续重试仍需 `--retry`。

## Scope 规范化

计划解析边界负责生成唯一 scope：

- `\\` 转 `/`；
- 折叠 `.` 与重复 `/`；
- 拒绝绝对路径、父级逃逸、NUL 和不支持的 glob 表达；
- `.` 保留为仓库根 scope；
- 冲突比较使用大小写折叠后的逻辑段，宁可在大小写敏感平台少并行，也不在 Windows 上漏冲突。

reported change path 复用同一规范化入口，但必须是具体路径，不能包含 glob。scope containment 使用按路径段匹配的 `**`/`*`/`?`/字符类语义，不依赖宿主文件系统。冲突比较继续大小写折叠以保守保护 Windows，但 worker-reported change 的 writes containment 保持逻辑路径精确大小写，避免 `src/**` 意外授权 `SRC/**`。matcher 使用迭代状态推进，匹配深度不依赖 Python 调用栈。

## 状态机闭包

依赖传播且没有 result 引用的 `blocked` 不再被视为永久结果。每次 `_refresh_state` 对 `pending/ready/retrying` 和这种派生 blocked 统一重算：

- 任一依赖为 failed/blocked/cancelled/orphaned -> blocked；
- 所有依赖 succeeded -> ready；
- 其他情况 -> pending。

拓扑顺序重算保证三层及更深后继在祖先重试时恢复为可继续推进的派生状态。

worker 自己提交的 `status=blocked` 带有 result 引用，仍是终态，不能被状态刷新自动重置为 ready。

## NodeResult 成功门禁

NodeResult 继续使用 v1 外层结构，但成功结果增加语义校验：

- validation status 使用固定枚举 `passed|failed|skipped`；
- succeeded 必须逐项覆盖 `node.validation`，每项恰好一次、状态为 passed，并包含非空 evidence；
- changes path 规范化后必须被至少一个 `node.writes` scope 覆盖；writes 为空时 changes 必须为空；
- artifact path 必须是当前 run 相对路径 `artifacts/...`，不得绝对化、逃逸或使用 glob；
- 非 succeeded 结果仍可提交部分验证证据和合法范围内的 partial changes，但不能借此绕过边界。

## 生命周期与 final barrier

- `start_execution_run` 在 runtime 边界读取 `task.json` 并要求 `status == in_progress`，避免其他调用者绕过 CLI 门禁。
- 每个 final 节点必须为 `integration` 或 `check`、是 sink，并传递依赖于全部非 final 节点。final `check` 无论采用 shared-worktree 还是隔离 worktree 都必须是只读节点。计划现有的非空 validation 加上 `barriers.final` 声明共同表达“全局质量门”，不再增加重复 boolean。
- 多个 final 节点允许并行全局检查，但每个都必须汇聚所有非 final 分支。

## Dispatch 契约

claim envelope 直接增加：

- `role`
- `name`
- `contextProfile`
- `isolation`

这些字段从已校验的 node 派生；manifest 仍是完整执行边界的唯一内容来源，envelope 只承载 adapter 路由所需元数据。

## 第三轮复审加固

### 深图遍历

cycle 检测与 final barrier 祖先闭包改用显式 stack 和访问状态，不再把 DAG
深度映射成 Python 调用栈深度。算法保持依赖声明顺序，因此 cycle 诊断仍返回
确定、可定位的具体路径；合法深链与深层 cycle 都通过正常的计划校验通道处理。

### 精确整数

JSON 的 boolean、integer 和 number 在协议层是不同类型，但 Python 的
`True == 1`、`1.0 == 1` 会让纯相等判断失效。execution plan、NodeResult、
runtime state、context manifest 和 executor capability 的版本/attempt 字段统一
采用 `type(value) is int` 后再比较值的规则，不接受隐式等价值。

### NodeResult v1 嵌套 schema

`changes`、`findings`、`validation`、`artifacts` 各自具有固定的必填和可选字段
白名单；未知字段直接拒绝，可选字段存在时必须为字符串。这样可以防止未经版本化
的结构化 metadata 被持久化或随 succeeded 结果解锁后继，同时保留已声明的
`location`、`evidence` 和 `hash` 扩展点。

## 第四轮复审加固

### 跨语言 JSON 整数词法

Python `json.loads` 保留 `1` 与 `1.0` 的 int/float 差异，但 JavaScript
`JSON.parse` 会把两者都转换成 `Number 1`。OpenCode manifest reader 和 Hub
execution projection 因此在结构解析之外读取原始 JSON token：顶层 version
必须恰好写成 `1`；manifest 中所有数字字段还必须是无小数点、无指数的整数
token。该门禁独立于 canonical hash，因为 parse/stringify 会让 `1.0` 重新变成
`1` 并继续匹配原哈希。

### 目录身份与 runtime 原子性

显式计划的 `task` 在公共计划加载边界绑定 `task_dir.name`。已有 run 每次载入时
再核对 state 的 taskId、taskPath 和 runId，防止审计身份与物理目录分裂。

`maxConcurrency` 在 capability factory 和 `start_execution_run` 最终校验中都
使用精确正整数语义，后者位于任何 runtime mkdir/latest 写入之前。state reader
再次验证持久化值，避免手工篡改后只在首次 ready 时失败。

### Manifest 权威执行策略

manifest 的 task record 增加 `planVersion`，并新增完整 `execution` record：
allowed、isolation、timeoutSeconds、maxAttempts、idempotent。相同字段会渲染进
`content.md` 的 mandatory contract，确保只得到注入文本的 worker 也能看到约束。
Python/OpenCode reader 同时验证身份、策略类型和哈希。

## 兼容与回滚

- legacy normalization 已把最后节点设为 integration，继续合法。
- 显式 v1 计划若使用普通 implement final 将被拒绝，这是对父任务既定“集成屏障和全局检查”契约的纠正。
- 修复集中在模板源和模板测试；关闭 DAG 开关仍回退旧串行工作流。
- 若验证失败，可按 recovery、scope/state、result gate、lifecycle/barrier、dispatch 五组独立回退。
