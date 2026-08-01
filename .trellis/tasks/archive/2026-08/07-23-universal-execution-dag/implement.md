# 实施计划

## 实施原则

- 先建立纯模型与兼容边界，再接调度和平台适配；任何并行能力都不得绕过图校验、资源冲突和最终检查。
- 规范计划与运行状态严格分离；`execution.json` 可审查，`.suncode/.runtime/` 可恢复但不上传。
- 上下文 manifest、结构化结果和能力模型是调度协议的一部分，不是后续附加日志。
- 每个阶段先通过定向测试，再扩大平台模板和文档范围。

## 实施清单

- [x] [P1] 定义并实现 `execution.json` v1 的类型、解析、严格校验、规范哈希和诊断，覆盖单节点、多节点、缺失依赖、自依赖与环。
- [x] [P1] 实现旧任务归一化：无图任务生成隐式单节点，`implement.md` 与 `subtasks.json` v1 只生成保守串行链，并提供 DAG 功能开关与回退诊断。
- [x] [P1] 建立执行器能力模型和共享调度状态机，完成 ready-set、fan-out-before-wait、wait-any、重试、失败传播、取消和最终集成屏障。
- [x] [P1] 实现读写范围、逻辑资源锁与隔离能力的冲突检测；共享工作区 reviewer 默认只读，fixer 单写，并为危险并行提供自动串行化。
- [x] [P1] 定义节点上下文 manifest、确定性来源顺序、单项/总预算、哈希、截断记录、敏感信息过滤和本地 artifact 布局。
- [x] [P1] 定义结构化 NodeResult 与直接依赖结果注入，保证调度器不依赖 subagent transcript 即可解锁后继和执行恢复。
- [x] [P1] 将 inline 执行接入统一 DAG 状态机，保持默认并发度 1，并验证新旧任务行为等价。
- [x] [P1] 改造共享 context hook 和 agent pull fallback，以 task/run/node/attempt 定位同一 manifest；Codex 原生派发强制干净上下文，channel 使用文件引用传递上下文。
- [x] [P1] 接入 native subagent 与 channel 适配器的能力声明、批量派发、wait-any、超时/取消和结果转换，验证两个安全节点真实重叠执行。
- [x] [P1] 在 `.suncode/.runtime/` 实现原子 snapshot、追加事件、上下文/结果索引和中断恢复；计划哈希变化、孤儿 worker 与非幂等重试必须给出明确诊断。
- [x] [P1] 保持 Hub `subtasks.json` v1 payload/hash 不变，增加 `execution.json` 的三字段投影回退，并锁定显式覆盖优先级。
- [x] [P1] 更新工作流、brainstorm/planning 模板和平台 agent/plugin 模板，使复杂任务生成 DAG、inline 也消费 DAG、subagent 按节点获取最小上下文。
- [x] [P1] 新增 migration manifest 并同步模板构建、初始化、更新、卸载与 registry invariants；不得修改历史 manifest。
- [x] [P1] 补齐图、调度、上下文、恢复、Hub、workflow、channel、hook 与平台契约测试，并运行 CLI/core 的最小有效质量门。
- [x] [P2] 同步 marketplace 的 native/tdd/channel-driven 工作流与 docs-site 中英文架构、多平台、自定义工作流、Hub、迁移和 changelog 文档。
- [x] [P2] 以基准任务验证并发重叠、inline 等价、上下文体积/截断可审计和旧任务回退，记录启用建议与已知限制。

## 建议依赖图

```text
graph-schema ─┬─ legacy-normalization ─┐
              ├─ capability-scheduler ├─ inline-adapter ───────────┐
              └─ conflict-policy ──────┘                            │
context-manifest ─ node-result ─ hook-pull-adapters ─ native/channel┤
graph-schema ─ runtime-recovery ─────────────────────────────────────┤
graph-schema ─ hub-projection ───────────────────────────────────────┤
                                                                    ▼
                   workflow/templates → migration → integration-tests
                                                                    │
                                                                    ▼
                                                        docs + benchmarks
```

实际 `execution.json` 在首个实施阶段由上述依赖关系生成；首版计划阶段暂不创建一个当前运行时无法校验的伪执行文件。

## 阶段交付

### 阶段 A：模型与兼容基线

- 完成 schema、校验、规范哈希、旧任务归一化和 Hub v1 固定样例。
- 此阶段不启用并行；inline 仍可用，关闭开关可完全回退旧路径。

### 阶段 B：调度、冲突与运行状态

- 完成能力模型、状态机、ready-set、wait-any、冲突策略和恢复。
- 使用内存/伪执行器验证并发时序，避免先把平台差异带入核心算法。

### 阶段 C：上下文与结果协议

- 完成 manifest builder、预算/截断、依赖结果和 hook/pull 一致性。
- 先接 inline 与一个原生适配器形成纵向闭环，再推广到 channel 和其他平台。

### 阶段 D：模板、迁移与文档

- 更新工作流规划要求、所有受支持平台模板、marketplace、migration 和 docs-site。
- 运行完整兼容矩阵并记录尚未具备 clean context/wait-any 的平台降级行为。

## 验证清单

### 定向测试

- DAG schema/validator/normalizer 单元测试。
- 调度状态机的 fan-out、wait-any、冲突、失败、重试与 barrier 测试。
- 上下文 builder 的 JSONL、目录、排序、预算、截断、哈希、push/pull 与 session 隔离测试。
- Hub 显式 `subtasks.json` 固定 payload/hash 与 DAG 投影测试。
- channel wait/spawn、shared hook、Codex/OpenCode 等重点平台契约测试。
- migration、init/update/uninstall、registry invariants 集成测试。

### 质量门

- CLI lint、typecheck、单元与定向集成测试。
- core 类型/测试（仅在公共 SDK 被修改时）。
- 模板复制后的源/构建产物一致性检查。
- docs-site 与 marketplace 在各自仓库执行对应检查，并分别提交。
- 提交前运行 GitNexus `detect_changes({scope: "compare", base_ref: "main"})`，确认影响范围符合计划。

## 回滚点

- 阶段 A 后可关闭 DAG 开关，旧串行执行和 Hub v1 不受影响。
- 阶段 B/C 的 runtime 与上下文 artifacts 都是新增路径，关闭适配器即可停止使用。
- 平台适配器逐个启用；单个平台失败只降级 inline/channel，不阻断其他平台。
- migration 只能新增后继版本，已经发布的历史 manifest 不修改、不重写。

## 完成定义

- PRD 中全部验收项有自动化证据或明确的人工基准记录。
- 共享工作区的并行写安全规则有失败测试，不能只靠提示词约束。
- 节点上下文来源、截断和结果回传可从 runtime artifacts 独立审计。
- 旧任务和显式 Hub v1 覆盖的兼容固定样例保持不变。
- 文档清楚区分执行 DAG、任务生命周期树、Hub subtasks 和运行时状态。
