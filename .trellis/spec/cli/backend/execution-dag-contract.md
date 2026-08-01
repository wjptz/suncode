# Suncode Execution DAG Runtime Contract

> `execution.json` v1、`task.py execution` CLI、持久化 runtime 与 executor adapter 之间的可执行契约。

## 1. Scope / Trigger

修改以下任一位置前必须阅读本规范：

- `scripts/common/execution_model.py`
- `scripts/common/execution_runtime.py`
- `scripts/common/task_execution.py`
- `workflow.md` 中的 DAG 调度、恢复、claim/dispatch 或 NodeResult 流程
- `execution.json`、runtime `state.json`、NodeResult v1、dispatch envelope 的字段或状态转换

核心安全目标是：无法证明 worker 已丢失时不重复执行；无法证明结果满足节点边界时不解锁后继；无法证明 final 是全局质量门时不允许整图成功。

## 2. Signatures

### CLI

```text
task.py execution start-run DIR [--executor KIND] [--run-id ID] [--json]
task.py execution claim DIR NODE [--run-id ID] [--executor-ref REF] [--json]
task.py execution complete DIR NODE --result FILE_OR_STDIN [--run-id ID] [--json]
task.py execution recover DIR [--run-id ID] [--force-orphan NODE]... [--retry NODE]... [--json]
```

### Python runtime

```python
start_execution_run(*, repo_root, task_dir, capabilities, run_id=None, parent_session=None)
recover_execution_run(*, repo_root, task_dir, run_id=None,
                      retry_nodes=(), force_orphan_nodes=())
validate_node_result(value, *, plan, state, node_id, attempt)
normalize_execution_scope(value, path, *, allow_glob=True)
```

`recover --force-orphan NODE` 表示协调器已经在 adapter 外部确认该 worker 丢失。它不是 liveness probe，也不能与同一调用中的 `--retry NODE` 重叠。

## 3. Contracts

### 3.1 Task lifecycle

`start-run` 必须在 runtime 边界读取 `DIR/task.json`，并且只接受：

```json
{ "status": "in_progress" }
```

`planning`、缺失/损坏的 `task.json` 或其他状态都必须失败。调用者必须先通过 `task.py start` 完成 preflight、session 激活和 `planning -> in_progress` 转换；不得从其他入口绕过。

#### Planning-finalization boundary

`execution scaffold` / `execution validate` 是规划收敛后的 required-once
finalization 工具，不是 `[workflow-state:planning*]` 每轮注入后都要执行的动作：

- 阻塞性未决问题存在，或 PRD/design/implement 仍在实质变化时，不生成、
  不验证 DAG；
- 规划首次收敛且 `execution.json` 缺失时，只 scaffold 一次；review/edit
  后 validate 一次；
- 已有 DAG 仍匹配最新规划时直接复用，不重复 scaffold、validate 或整图审查；
- 交付物、依赖、reads/writes/resources、executor constraint 或 validation
  发生实质变化时，原地更新受影响的节点/边，再 validate 一次；不得自动
  `scaffold --force` 覆盖 reviewed plan；
- DAG 是 final planning summary 的组成部分；用户必须在该摘要之后批准。
  DAG 发生实质变化时，旧批准失效。

该判断由 Agent 对照权威 planning artifacts 完成，不向 execution v1 schema
增加 freshness fingerprint、文档状态或 sidecar。`task.py start` 仍是最终
lifecycle/结构门禁；activation step 不应为未变化 DAG 再显式调用一次
`execution validate`。

任务身份以任务目录 basename 为 runtime 权威值。例如目录
`.suncode/tasks/07-31-review-fixes/` 只接受：

```json
{ "task": "07-31-review-fixes" }
```

`execution.json.task` 不得使用 `task.json.id`、标题、无日期 slug 或其他别名。
显式计划在公共加载边界就必须拒绝身份不一致，不能等到结果提交时再发现。
已有 runtime 每次载入时还必须重新核对：

- `state.taskId == task_dir.name`；
- `state.taskPath == repo-relative task_dir`；
- `state.runId == runtime directory basename`。

任一不一致都必须失败关闭，不能用调用参数覆盖持久化身份继续运行。

### 3.2 Scope canonicalization and conflict safety

计划解析时，所有 `reads` / `writes` scope 必须转换为稳定的 POSIX 逻辑路径：

- `\\` 转换为 `/`；
- 折叠前导 `./`、`.` 段、重复分隔符和尾分隔符；
- `.` 保留为仓库根 scope；
- 拒绝绝对路径、Windows drive 路径、`..`、NUL、非完整段的 `**`、未闭合字符类和 `{...}`；
- 同一 scope 列表使用 `casefold()` 检测规范化重复项；
- 共享工作树冲突比较使用大小写折叠后的路径段。Linux 上允许保守地减少并行，不能在 Windows 上漏掉冲突。

reported change/artifact path 必须复用同一规范化器，且 `allow_glob=False`、不能为 `.`。scope containment 按逻辑段匹配 `**`、`*`、`?` 和字符类，不依赖宿主文件系统。

冲突检测和写权限 containment 的大小写语义不能混用：

- 调度冲突检测使用 `casefold()`，在大小写敏感平台允许保守地少并行；
- `changes[].path` 对 `node.writes` 的 containment 必须大小写精确，`src/allowed/**` 不能授权 Linux 上不同目录 `SRC/ALLOWED/...`；
- glob matcher 必须使用迭代状态推进或其他不依赖 Python 调用栈深度的实现。合法深路径不能触发 `RecursionError` 或破坏 CLI JSON 错误契约。

### 3.3 Recovery state transitions

| 当前状态 / 事实 | 普通 `recover` | 显式操作 |
|---|---|---|
| `dispatched/running` 且结果已落盘 | 校验并协调结果 | 不需要 |
| `dispatched/running` 且无结果 | 保持 active；报告 liveness 未确认 | 确认丢失后使用 `--force-orphan NODE` |
| force-orphan + idempotent + attempt 未耗尽 | 不适用 | `orphaned -> retrying -> ready/pending` |
| force-orphan + non-idempotent | 不适用 | 保持 `orphaned`，之后单独 `--retry NODE` |
| `failed/cancelled/orphaned` 且 attempt 未耗尽 | 不自动重试 | `--retry NODE` |

禁止仅凭无结果文件、`executorRef` 字符串、进程超时推断 worker 已丢失。未来若增加 lease/heartbeat，必须先定义跨 adapter 的统一权威来源。

结果文件与 force-orphan 请求竞态时，已落盘且通过校验的结果优先；不得用后到的 force 请求覆盖成功结果。

### 3.4 Derived blocked state

依赖传播产生的 `blocked` 必须满足 `state.nodes[NODE].result == null`，并在每次 `_refresh_state` 中按拓扑重算：

- 任一依赖为 `failed|blocked|cancelled|orphaned`：`blocked`；
- 所有依赖为 `succeeded`：`ready`；
- 其他依赖组合：`pending`。

worker 通过 NodeResult 主动返回的 `blocked` 带有结果引用，是终态，不能被当成派生状态自动改回 `ready`。

### 3.5 NodeResult v1 success gate

```ts
type ValidationStatus = "passed" | "failed" | "skipped";

interface ValidationEvidence {
  command: string;
  status: ValidationStatus;
  evidence?: string;
}
```

NodeResult 的嵌套对象同样属于 v1 协议，不是可随意扩展的 metadata：

| 数组 | 必填字符串字段 | 可选字符串字段 | 其他字段 |
|---|---|---|---|
| `changes[]` | `path`, `kind` | 无 | 拒绝 |
| `findings[]` | `severity`, `message` | `location` | 拒绝 |
| `validation[]` | `command`, `status` | `evidence` | 拒绝 |
| `artifacts[]` | `name`, `path` | `hash` | 拒绝 |

可选字段一旦出现就必须真的是字符串；不能用 object、array、number、boolean
或 `null` 占位。未来如需增加结构化 metadata，必须提升结果协议版本或先定义
明确的版本化字段，不能让 v1 静默透传未知键。

所有 NodeResult 都必须满足身份字段、外层 status 枚举和数组结构。额外语义：

- `status == "succeeded"` 时，`validation` 必须与 `node.validation` 精确一一对应；不能遗漏、额外或重复；
- succeeded 的每项 validation 必须为 `passed`，并带非空字符串 `evidence`；
- 所有 `changes[].path` 必须是具体路径，并被至少一个 `node.writes` scope 覆盖；`writes=[]` 等价于禁止报告 change；
- 所有 `artifacts[].path` 必须是具体的 run 相对路径 `artifacts/...`；
- 非 succeeded 结果可以提交部分验证信息，但 validation status 仍必须来自固定枚举，changes/artifacts 仍不能越界。

只有通过上述门禁的 succeeded 结果才能写入 runtime、解锁后继或使 final barrier 成功。

### 3.6 Final barrier

每个 `barriers.final[]` 节点分别必须：

- `role` 为 `integration` 或只读 `check`；
- `role == "check"` 时必须满足 `writes=[]`，无论 isolation 是 `shared-worktree`、`worktree` 还是 `sandbox`；
- 是 sink，没有任何 successor；
- 传递依赖于所有 non-final 节点；
- 具有非空 `node.validation`（由节点解析契约保证）。

多个 final 可以并行，但不能通过“多个 final 的祖先并集”拼出全图覆盖；每个 final 自己都必须是全局质量门。

### 3.7 Context manifest identity and execution policy

每次 claim 产生的 `manifest.json` 是 worker 的可哈希权威契约，至少包含：

```json
{
  "version": 1,
  "task": {
    "id": "07-31-review-fixes",
    "path": ".suncode/tasks/07-31-review-fixes",
    "planVersion": 1,
    "planHash": "sha256"
  },
  "run": {
    "id": "run-id",
    "nodeId": "implementation",
    "attempt": 1
  },
  "execution": {
    "allowed": ["inline", "native-subagent", "channel"],
    "isolation": "shared-worktree",
    "timeoutSeconds": 900,
    "maxAttempts": 2,
    "idempotent": true
  }
}
```

manifest reader 必须校验 task id/path/plan version、run id/node id/attempt 和完整
execution policy；不能只校验文件哈希。worker 实际收到的 `content.md` 也必须渲染
plan version、allowed executors、isolation、timeout、max attempts 和 idempotency，
不能把约束只放在一个 adapter 不会展示的 JSON 字段里。

### 3.8 Claim dispatch envelope

claim 响应中的 `dispatch` 至少直接包含：

```json
{
  "nodeId": "implementation",
  "name": "Implement feature",
  "role": "implement",
  "contextProfile": "implement",
  "isolation": "shared-worktree",
  "executor": "native-subagent",
  "manifestRef": ".suncode/.runtime/.../manifest.json",
  "prompt": "..."
}
```

adapter 使用 `dispatch.role` 选择原生 agent，并把 `dispatch.prompt` 原样传递。manifest 仍是 objective、scope、validation、依赖结果和预算的完整权威来源。

### 3.9 精确整数、跨语言 JSON 词法与深图安全

所有来自 JSON 或 adapter 的整数协议字段必须使用精确整数语义。Python 中
`True == 1`、`1.0 == 1`，因此不能只用 `==` 或 `isinstance(value, int)` 判断：

- `execution.json.version`；
- NodeResult 的 `version` 与 `attempt`；
- runtime `state.json.version`；
- context `manifest.json.version`；
- executor capability 的 `resultProtocolVersion`。

上述字段只接受 `type(value) is int` 且值满足对应契约；JSON `true`、`1.0`
和 `"1"` 即使与整数 `1` 看起来等价，也必须拒绝。

JavaScript 的 `JSON.parse()` 会把原始 `1.0` / `1e0` 丢失词法信息并转换成
`Number 1`。因此 OpenCode manifest 和 Hub `execution.json` 消费端不能只使用
`value === 1` 或 `Number.isInteger(value)`：

- 先正常 `JSON.parse()` 验证 JSON 结构；
- 再检查原始 JSON 中顶层 `version` token 恰好为 `1`；
- context manifest 的所有数字字段都必须是无小数点、无指数的整数 token；
- 规范化哈希不能代替词法检查，因为 `JSON.stringify(JSON.parse("1.0"))`
  会重新得到 `1`，原哈希仍可能匹配。

executor capability 的 `maxConcurrency` 同样只接受精确正整数。factory 和
`start_execution_run` 的最终防御校验必须都在创建 runtime 目录之前执行；直接
构造 `ExecutorCapabilities` 不能绕过该门禁。持久化 state 中的
`executor.maxConcurrency` 每次载入也必须重新校验。

计划图的 cycle 诊断和 final barrier 祖先闭包必须使用显式 stack/deque 等
迭代算法。合法深链和深层 cycle 都不得受 Python 默认递归深度影响；cycle
仍须通过 `ExecutionPlanError`/CLI JSON 返回可定位诊断，不能泄漏
`RecursionError` traceback。

## 4. Validation & Error Matrix

| 输入/状态 | 必须失败或保持的行为 | 诊断要点 |
|---|---|---|
| `task.json.status=planning` 后 `start-run` | 失败，不创建 runtime | `status == 'in_progress'` |
| `execution.json.task` 与任务目录 basename 不同 | 失败，不创建 runtime | `execution.json.task` 身份不一致 |
| runtime `taskId` / `taskPath` / `runId` 被篡改 | 所有 status/claim/recover 等入口失败 | 持久化身份不一致 |
| active worker 无结果，普通 recover | 成功但保持 active | `executor liveness is unconfirmed` |
| 非 active node 使用 `--force-orphan` | 失败 | 必须为 `dispatched/running` |
| 同一 node 同时 force-orphan/retry | 失败 | 两种转换互斥 |
| `./src/**` 与 `src/**` | 规范化为同一 scope | 不得并发选择 |
| `.` 与任意仓库路径 | 视为冲突 | 不得并发选择 |
| succeeded + 空/失败/未知/无 evidence validation | 失败 | 不得写 result 或解锁后继 |
| succeeded + 未声明/遗漏/重复 validation | 失败 | 必须精确覆盖 `node.validation` |
| change 不在 writes 或 writes 为空 | 失败 | 报告越界 node id/path |
| `writes=src/allowed/**`、change 使用 `SRC/ALLOWED/...` | 失败 | containment 大小写精确，不能扩大写权限 |
| 合法 concrete change path 超过 Python 递归深度 | 正常完成校验 | matcher 不得抛出 `RecursionError` |
| artifact 不在 `artifacts/` | 失败 | 报告 runtime artifact namespace |
| implement 或非 sink final | 计划校验失败 | final role/sink 诊断 |
| 任意 isolation 下 final check 声明非空 writes | 计划校验失败 | final check 必须只读 |
| final 未汇聚任一 non-final | 计划校验失败 | 列出 missing nodes |
| version/attempt 使用 `true`、`1.0` 或 `"1"` | 失败 | 必须是精确 JSON integer |
| OpenCode manifest 顶层或嵌套整数使用 `1.0` / `1e0` | 不注入 context | 原始 JSON number token 非整数 |
| Hub `execution.json.version` 原始 token 为 `1.0` | 不生成/提交 subtasks | 顶层 version 不是精确 token `1` |
| capability `maxConcurrency` 为 bool/float/string | start 前失败，不创建 run/latest | 必须是精确正整数 |
| manifest 缺少 planVersion 或 execution policy | 失败，不注入 context | manifest 权威契约不完整 |
| NodeResult 嵌套对象包含未知键 | 失败 | 定位到数组索引并列出未知字段 |
| `location`/`evidence`/`hash` 使用非字符串 | 失败 | 定位到具体可选字段 |
| 1200 层以上合法串行 DAG | 校验成功 | 不得触发 `RecursionError` |
| 1200 层以上 cycle | 结构化校验失败 | 返回 concrete cycle 诊断，不得 traceback |

## 5. Good / Base / Bad Cases

- Good：普通 recover 看到仍在运行且没有结果的 worker，保持 `running`；协调器从 adapter 确认 worker 丢失后再 force-orphan。
- Base：失败父节点显式 retry 后，原来 blocked 的 child/grandchild 先恢复为 `pending`；父节点成功后直接 child 进入 `ready`。
- Good：succeeded 结果报告所有声明命令为 `passed`、带 evidence，change 落在 writes，artifact 位于 `artifacts/<node>/...`。
- Good：`src/**` 可匹配超过 1000 个逻辑段的 concrete change path，不依赖递归调用栈。
- Good：1200 层以上的串行 DAG 正常验证；同等深度的 cycle 返回结构化 cycle 诊断。
- Good：NodeResult 的 `findings.location`、`validation.evidence`、`artifacts.hash` 使用字符串，且没有未知字段。
- Good：manifest 同时携带并渲染 DAG 版本与完整 execution policy；三类 adapter 得到同一约束。
- Bad：把“结果文件还没出现”等同于“worker 已死”，自动启动第二个 attempt。
- Bad：接受 `status=succeeded`、`validation=[]` 或 `changes=[src/forbidden/x]` 并解锁 final。
- Bad：用大小写折叠后的 matcher 让 `src/allowed/**` 接受 `SRC/ALLOWED/x`，把 Windows 冲突安全规则误当成 Linux 写权限。
- Bad：允许 worktree/sandbox final `check` 声明 writes，使全局质量门不再只读。
- Bad：让两个 final 分别覆盖不同分支，然后用祖先并集宣称全图已集成。
- Bad：依赖 Python 的 `True == 1` 接受布尔 version/attempt，或让 `1.0` 冒充协议整数。
- Bad：JavaScript 在 `JSON.parse()` 后只比较 `version === 1`，让原始 `1.0` 通过且继续匹配规范化哈希。
- Bad：先创建 run/latest，再在第一次 `ready` 时才拒绝浮点 `maxConcurrency`。
- Bad：把未知 NodeResult 嵌套字段原样持久化并解锁后继。

## 6. Tests Required

修改 DAG runtime 后，至少运行 `test/templates/execution-runtime.test.ts`，并断言：

- 普通 recover 保持 active；force-orphan 才进入 orphan/retry；
- force 请求遇到已落盘结果时优先协调结果；non-idempotent orphan 保持终态直到显式 retry；
- `./`、重复分隔符、`\\`、`.`、大小写和 drive 路径等价类；
- `failed -> blocked descendants -> explicit retry -> pending/ready`，包含三层链；
- worker-reported blocked 不会被自动重算；
- succeeded 的空验证、失败/未知状态、缺 evidence、覆盖差异、越界 change、read-only change、越界 artifact 均失败；
- 大小写变体 change 不得绕过 writes；超过 Python 默认递归深度的合法 concrete path 必须正常完成校验；
- planning start-run 失败；合法 integration/check final 通过，implement/non-sink/incomplete final 失败；
- shared-worktree/worktree/sandbox 下，声明 writes 的 final check 均失败；
- claim 的 `dispatch.role/name/contextProfile/isolation` 与 node 一致。
- execution plan、NodeResult、runtime state、context manifest 和 executor capability 的 version/attempt 对 `true`、`1.0`、`"1"` 均失败；
- OpenCode 对 manifest 顶层 version、嵌套 planVersion/attempt 的 `1.0` / `1e0` 均保持原 prompt、不注入 content；
- Hub projection 对 raw `execution.json.version=1.0` 失败，并验证 plan task 等于目标任务目录；
- plan task mismatch 和篡改后的 runtime taskId/taskPath/runId 均在公共入口失败；
- capability factory 与直接构造 adapter 对 bool/float/string maxConcurrency 均在写盘前失败；
- manifest 和注入 content 都断言 planVersion、allowed、isolation、timeout、maxAttempts、idempotent；
- `changes/findings/validation/artifacts` 拒绝未知字段，并校验 `location/evidence/hash` 可选字段类型；
- duplicate validation command 明确失败；
- 1200 层以上合法串行 DAG 成功，1200 层以上 cycle 返回结构化错误且无 `RecursionError`；
- worktree 与 sandbox 两种隔离下都覆盖 writable final check 的失败断言。

提交前还必须运行 CLI 完整 test、ESLint、TypeScript typecheck、BasedPyright、build，以及 GitNexus `detect_changes(scope="compare", base_ref="main")`。

## 7. Wrong vs Correct

### Wrong

```python
if node_is_active and result_file_missing:
    node.status = "orphaned"
    schedule_retry(node)
```

这会在原 worker 健康运行时制造并发 attempt 和重复副作用。

### Correct

```python
if node_is_active and result_file_missing:
    keep_active_and_report_unknown_liveness(node)

if coordinator_explicitly_forces_orphan(node):
    mark_orphaned(node)
    retry_only_when_policy_allows(node)
```

### Wrong

```python
if result["status"] == "succeeded":
    unlock_successors()
```

### Correct

```python
validated = validate_identity_structure_evidence_and_boundaries(result, node)
if validated["status"] == "succeeded":
    unlock_successors()
```

### Wrong

```python
# 冲突检测的 casefold 语义错误地扩大了 result 写权限；递归深度还受路径段数控制。
return fnmatchcase(path_part.casefold(), scope_part.casefold()) and recurse()
```

### Correct

```python
# containment 大小写精确；迭代状态集合吸收 ** 的零段/多段语义。
if fnmatchcase(path_part, scope_part):
    next_reachable[scope_index + 1] = True
```

### Wrong

```python
if result.get("version") == 1:
    accept_result(result)

def include_dependencies(node_id: str) -> None:
    for dependency_id in nodes[node_id].depends_on:
        include_dependencies(dependency_id)
```

前者会让 `true` 和 `1.0` 冒充整数协议版本；后者会让合法深图被 Python
递归上限错误拒绝。

### Correct

```python
version = result.get("version")
if type(version) is not int or version != 1:
    reject_result(result)

pending = [node_id]
while pending:
    current_id = pending.pop()
    pending.extend(nodes[current_id].depends_on)
```

协议类型检查和图遍历都必须对输入规模保持确定语义，不能依赖 Python 的隐式
相等规则或进程级递归配置。

### Wrong

```javascript
const manifest = JSON.parse(source)
if (manifest.version === 1 && hashMatches(manifest)) accept(manifest)
```

`source` 中的 `1.0` 会变成 `Number 1`，规范化哈希也可能继续匹配。

### Correct

```javascript
const manifest = JSON.parse(source)
if (!hasExactTopLevelIntegerField(source, "version", 1)) reject(manifest)
if (!hasOnlyExactJsonIntegerNumbers(source)) reject(manifest)
if (manifest.version !== 1 || !hashMatches(manifest)) reject(manifest)
```

结构、原始词法和哈希是三个独立门禁，缺一不可。
