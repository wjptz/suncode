# 统一执行 DAG 与 Subagent 上下文编排：技术设计

## 设计结论

采用“一个规范计划、多个能力适配器”的架构：

```text
prd/design/implement/spec/research
                 │
                 ▼
      execution.json（稳定计划）
                 │ parse + validate + normalize
                 ▼
       ExecutionGraph / Ready Set
                 │ capability + conflict policy
        ┌────────┼─────────┐
        ▼        ▼         ▼
     inline   native     channel
              subagent    worker
        │        │         │
        └────────┼─────────┘
                 ▼
   .suncode/.runtime（可恢复运行状态）
                 │
                 ▼
      integration barrier + final check
```

执行器只改变“怎样运行”，不改变“计划是什么”。inline 不是另一套规划模式，而是并发度为 1 的执行器。

## 为什么新增 `execution.json`

不把完整 DAG 直接升级为 `subtasks.json` v2，原因如下：

1. `task.json.subtasks` 已代表历史检查项，`task.json.children` 代表生命周期树，继续复用 `subtasks` 会混淆三个不同模型。
2. `subtasks.json` 已是 Hub v1 覆盖契约，其规范哈希和请求体冻结为 `priority`、`name`、`description`。
3. 执行 DAG 包含依赖、上下文、资源、重试与验证，生命周期和敏感度都不同于 Hub 展示字段。
4. 单独的 `execution.json` 可以独立版本化，保持计划/运行时分离，并允许 Hub 只做损失可控的展示投影。

因此：

- `execution.json`：本地、规范、版本化的执行计划。
- `subtasks.json`：可选的 Hub v1 展示覆盖。
- `implement.md`：面向人的实施清单，也是旧版安全回退来源。
- `.suncode/.runtime/...`：易变执行状态，不进入计划文件。

## 计划文件模型

建议首版 schema：

```json
{
  "version": 1,
  "task": "07-23-universal-execution-dag",
  "defaults": {
    "timeoutSeconds": 1800,
    "maxAttempts": 2,
    "contextProfile": "implement"
  },
  "nodes": [
    {
      "id": "graph-core",
      "name": "实现 DAG 解析与校验",
      "description": "建立版本化模型、诊断和旧任务归一化。",
      "priority": "P1",
      "role": "implement",
      "dependsOn": [],
      "reads": ["packages/cli/src/**", ".trellis/spec/cli/**"],
      "writes": ["packages/cli/src/execution/**"],
      "resources": ["cli-execution-core"],
      "context": {
        "profile": "implement",
        "include": ["prd", "design", "implement", "implement-jsonl"],
        "dependencyResults": "direct",
        "maxBytes": 262144
      },
      "validation": ["targeted-unit-tests"],
      "execution": {
        "isolation": "shared-worktree",
        "allowed": ["inline", "native-subagent", "channel"]
      }
    }
  ],
  "barriers": {
    "final": ["integration-check"]
  }
}
```

首版使用严格 schema；v1 未知语义字段直接拒绝，扩展数据只能进入明确预留的 metadata 命名空间，不能静默改变语义。节点 ID 在任务内稳定，恢复、日志、依赖结果和 Hub 投影均以它为键。

### 节点角色

首版内建角色：

- `implement`：在声明写范围内实现并执行局部验证。
- `check`：只读审查并回传结构化问题；共享工作区默认禁止写。
- `fix`：根据一个或多个 check 结果串行修复。
- `integration`：执行跨节点合并检查、全局验证和最终结论。
- `research`：只读探索；通常属于规划期，但允许在实施图中作为显式前置节点。

角色决定默认权限和上下文 profile，但节点可以在 schema 允许范围内收紧，不能扩大平台或项目安全策略。

## 图构建、校验与归一化

### 显式图

`execution.json` 存在时：

1. 解析 JSON 并校验版本。
2. 校验字段、节点 ID、角色和依赖引用。
3. 通过拓扑算法检测自依赖和环，并提供具体环路径。
4. 规范化 glob/资源名、默认配置与验证声明。
5. 计算规范计划哈希，作为运行恢复和上下文 manifest 的输入。

### 旧任务回退

`execution.json` 不存在时只做保守归一化：

- 没有可解析清单：生成一个隐式 inline 节点。
- 有 `implement.md` 复选清单：保持原顺序，生成串行链。
- 只有 `subtasks.json` v1：生成同顺序串行展示节点，不推断写范围或并行。
- 只有不存在显式图时才走旧任务回退；显式 `execution.json` 解析或校验失败时阻止实施并给出定位诊断，避免绕过用户声明的依赖和安全边界。

新建复杂任务是否强制显式图由功能开关和工作流阶段共同控制；迁移过程不批量写入既有任务。

## 调度状态机

节点状态：

```text
pending → ready → dispatched → running → succeeded
                     │            ├────→ failed → retrying ─┐
                     │            └────→ cancelled          │
                     └───────────────────────────────────────┘
```

任务级状态至少包括 `planned`、`running`、`blocked`、`integrating`、`succeeded`、`failed`。

核心循环：

1. 从稳定计划与 runtime snapshot 恢复节点状态。
2. 计算所有依赖成功且未执行的 ready 节点。
3. 按优先级、关键路径提示和稳定 ID 排序，保证调度确定性。
4. 在执行器并发上限、资源锁、写冲突和隔离能力下选择最大安全集合。
5. 先派发选中集合中的全部节点，再进入等待。
6. wait-any；任一结果到达即持久化、释放资源、更新后继。
7. 可重试失败按策略重新入队；不可重试失败阻塞依赖节点，但不必取消无关分支。
8. 所有实现分支完成后进入集成屏障，运行全局 check。

inline 适配器把并发上限固定为 1，仍走同一状态机。这样可以验证图语义，也保证不同平台结果一致。

## 能力模型

平台适配器声明：

```ts
interface ExecutorCapabilities {
  kind: "inline" | "native-subagent" | "channel";
  maxConcurrency: number;
  roles: readonly NodeRole[];
  supportsWaitAny: boolean;
  supportsCancellation: boolean;
  supportsCleanContext: boolean;
  isolation: "shared-worktree" | "worktree" | "sandbox";
  resultProtocolVersion: number;
}
```

调度器只使用能力，不内嵌平台名称分支。平台不支持 wait-any 时，适配器可内部模拟或声明降级；不支持干净上下文时必须警告并使用最小显式 prompt，不能假装隔离成立。

## 并发冲突策略

### 共享工作区

两个写节点同时运行需同时满足：

- `writes` 的规范化范围不相交；
- `resources` 不冲突；
- 两个节点都声明允许共享工作区；
- 不存在项目级全局锁，例如依赖锁文件、迁移 registry、发行版本文件。

无法静态证明时按冲突处理并串行化。首版宁可少并行，也不能以最后写入覆盖另一个 worker 的结果。

### reviewer/fixer

- 多个 reviewer 可以并行，但在共享工作区中一律只读。
- reviewer 回传结构化 findings，包含严重级别、位置、证据和建议。
- 单一 fixer 聚合去重后修改；修改完成再运行一个独立 check/integration 节点。

### 可选隔离

未来 worktree/sandbox 适配器可以允许重叠写范围，但必须额外提供合并、冲突检测和清理协议。该能力不进入首版验收。

## 节点上下文包

### 逻辑结构

```ts
interface NodeContextManifest {
  version: 1;
  task: { id: string; path: string; planHash: string };
  run: { id: string; nodeId: string; attempt: number; parentSession?: string };
  role: NodeRole;
  objective: string;
  boundaries: {
    reads: string[];
    writes: string[];
    forbidden: string[];
    resources: string[];
  };
  validation: string[];
  sources: ContextSource[];
  dependencies: DependencyResultRef[];
  budget: { perSourceBytes: number; totalBytes: number; usedBytes: number };
  truncations: TruncationRecord[];
  manifestHash: string;
}
```

manifest 是审计和拉取入口；实际内容可以内联，也可以通过本地只读 artifact 引用。日志默认记录元数据和哈希，不输出敏感正文。

### 确定性顺序

默认合成顺序：

1. 平台/项目不可覆盖的安全约束。
2. 任务身份、节点角色、目标、完成定义与禁止事项。
3. 写入/读取边界、资源锁、验证和结果协议。
4. PRD 中与节点相关的需求。
5. design 与 implement 中节点引用的段落。
6. 角色 JSONL 展开的 spec、research、目录与源文件。
7. 节点显式 `context.include`。
8. 直接依赖节点的结构化结果与产物摘要。

相同优先级内按规范路径和声明顺序稳定排序。不得依赖文件系统遍历的偶然顺序。

### 预算与截断

- 先应用单来源上限，再应用总预算。
- 安全约束、节点目标、边界和结果协议不可裁剪。
- PRD/design/spec 优先于外围 research；依赖结构化摘要优先于长日志。
- 目录扩展必须有文件数、类型和总量上限；默认沿用现有 Markdown 白名单思路并显式排序。
- 每次省略或截断都写入 manifest：来源、原始大小、保留大小、原因和摘要策略。
- 预算不足以容纳不可裁剪项时，派发失败并给出可操作诊断，不静默发送残缺任务。

### 推送与拉取

统一构建器先生成 manifest，再由适配层选择：

- hook push：在 SubagentStart/平台等价事件中把内容注入 prompt。
- agent pull：agent 模板通过 task/node/run 身份读取同一 manifest 和 artifacts。
- channel：通过 `--context-file`/等价机制传递 manifest 入口，避免命令行承载大段正文。

push 与 pull 必须共享解析器、顺序、预算和哈希测试，避免平台漂移。hook 缺失、标记缺失或上下文不可访问时，agent pull 是标准回退，不是另一套内容。

### 会话隔离

- Codex 原生 subagent 必须以 `fork_turns = "none"` 派生；任务说明自包含。
- hook 根据父 session 绑定当前任务和 runtime run，不能取其他并发会话的 current task。
- manifest 同时记录 task、run、node、attempt；不允许只凭全局 `current` 推断。
- 平台无法保证隔离时标记 `supportsCleanContext=false`，调度器可降级 inline 或警告后使用最小显式上下文。

### 结果协议

```ts
interface NodeResult {
  version: 1;
  taskId: string;
  runId: string;
  nodeId: string;
  attempt: number;
  status: "succeeded" | "failed" | "blocked" | "cancelled";
  summary: string;
  changes: Array<{ path: string; kind: string }>;
  findings: Array<{ severity: string; location?: string; message: string }>;
  validation: Array<{ command: string; status: string; evidence?: string }>;
  artifacts: Array<{ name: string; path: string; hash?: string }>;
  risks: string[];
}
```

调度器只消费结构化结果和 artifact 引用。自然语言 transcript 可用于人工诊断，但不是依赖解锁和恢复的事实来源。

## Runtime 布局与恢复

建议布局：

```text
.suncode/.runtime/execution/<task-id>/<run-id>/
├── state.json
├── events.jsonl
├── contexts/<node-id>/<attempt>/manifest.json
├── results/<node-id>/<attempt>.json
└── artifacts/<node-id>/...
```

- `state.json` 使用临时文件 + 原子替换更新；`events.jsonl` 只追加并可重放。
- 恢复时先校验计划哈希。计划已改变则停止自动恢复并要求重新规划或显式迁移运行。
- `dispatched/running` 且执行器失联的节点进入可诊断的 orphaned 状态，再按幂等性/重试策略处理。
- runtime 默认不作为 Hub artifact 上传，也不进入版本控制。

## Hub 兼容投影

上传解析优先级：

1. 用户显式提供的 `subtasks.json` v1。
2. `execution.json` 中可展示节点的稳定拓扑投影。
3. `implement.md` 的 parseable checklist。

DAG 节点投影规则：

- `priority` ← 节点 priority 或默认值。
- `name` ← 节点 name。
- `description` ← 节点 description；可附简短依赖提示，但不能改变 v1 schema。
- 不上传 reads/writes、上下文、运行结果、资源锁或敏感路径。

规范化后仍调用现有 v1 哈希与请求构造，保证已有显式 `subtasks.json` 的请求字节语义不变。

## 配置与渐进启用

建议配置：

```yaml
execution:
  dag:
    enabled: true
    require_for_complex_tasks: false
    max_concurrency: 6
    unsafe_parallel_writes: false
  context:
    per_source_bytes: 65536
    total_bytes: 262144
    dependency_results: direct
```

发布阶段：

1. 引入模型、校验、旧任务归一化和 inline 执行，默认保持串行。
2. 接入节点上下文 manifest 与 hook/pull 协议，验证跨平台一致性。
3. 启用原生 subagent/channel 的安全并行和 wait-any。
4. 更新规划模板，使复杂任务默认生成显式 DAG；观察后再考虑强制。

任一阶段都能通过关闭 `execution.dag.enabled` 回到旧串行路径。已经存在的 `execution.json` 保留，不需要回滚文件格式。

## 主要改动面

### CLI 与核心模型

- `packages/cli/src/templates/suncode/scripts/common/`：任务图解析、校验、上下文 manifest 与 runtime 状态。
- `packages/core/src/task/`：若确定作为公共 SDK 暴露，则增加稳定类型和纯函数；否则首版保持 CLI 内部，避免过早锁定 API。
- `packages/cli/src/commands/hub/submissions.ts`：保持 v1，增加 DAG 只读投影回退。
- `packages/cli/src/commands/channel/`：能力声明、批量派发、wait-any、结果转换和取消/超时语义。

### 模板与平台适配

- `packages/cli/src/templates/shared-hooks/inject-subagent-context.py`：从任务级注入扩展到 node manifest 注入。
- 各平台 agent/skill/plugin 模板：统一 node 身份、pull fallback 和结构化结果协议。
- `packages/cli/src/templates/suncode/workflow.md`：规划 DAG、inline 消费、并行安全与最终屏障。
- marketplace native/tdd/channel-driven workflows：同步新的通用调度语义。

### 分发、测试与文档

- 新 migration manifest，保持历史 manifest 不变。
- `copy-templates.js`、init/update/uninstall、registry invariants 和 migration 测试覆盖新增文件。
- Hub、workflow、hook、channel、平台模板和 DAG 核心增加定向单元/集成测试。
- docs-site 英文/中文架构、多平台、自定义工作流、Hub 与 changelog 同步更新。

## 测试策略

### 图与调度

- 显式图正常路径、单节点、菱形依赖、多根、多汇、环和损坏引用。
- inline 与并发执行器得到相同最终依赖顺序。
- fan-out before wait、wait-any 解锁、重试、失败隔离、最终屏障。
- 写 glob、逻辑资源和隔离能力的冲突矩阵。

### 上下文

- 平台 × 角色矩阵。
- JSONL 的缺失、seed-only、file/path、目录、损坏行和不存在文件。
- 顺序、内容哈希、单项/总预算、确定性截断和不可裁剪项溢出。
- hook marker 存在/缺失、push/pull 等价、并发父 session 隔离。
- Codex 干净派生和 channel context-file 传播。
- 结构化 dependency result 注入，不注入完整 transcript。

### 兼容

- 旧任务无 DAG、implement 清单和 `subtasks.json` v1 的保守归一化。
- 既有 Hub v1 payload/hash 固定样例完全不变。
- init/update/migration/uninstall 不过度删除用户文件。
- 模板源、构建产物和 marketplace/docs 子仓库的一致性。

## 风险与缓解

- **计划过度拆分**：用节点完成定义、局部验证和最小收益阈值约束粒度。
- **共享工作区竞态**：冲突不确定即串行；reviewer 只读；全局文件使用资源锁。
- **上下文看似精简但缺关键事实**：manifest 可审计、依赖结果结构化、pull fallback、缺失即诊断。
- **平台适配漂移**：共享 builder/协议，平台只实现 transport，建立平台 × 角色契约测试。
- **运行恢复重复副作用**：节点显式幂等/重试策略，持久化 dispatch/result 事件，未知状态不盲重跑。
- **Hub 契约破坏**：DAG 与 `subtasks.json` 分离，并以固定 payload/hash 测试锁定 v1。
- **迁移范围过大**：按阶段启用，复杂任务先建议后强制，保留旧串行回退开关。
