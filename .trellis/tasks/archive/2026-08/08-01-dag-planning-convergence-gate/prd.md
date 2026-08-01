# 修复 DAG 规划重复生成与验证

## 目标与用户价值

开启 `execution.dag.enabled` 后，DAG 只能在需求与实施计划已经收敛时生成一次；普通需求沟通、解释和未改变实施结构的规划回合不得重新执行 `execution scaffold` 或 `execution validate`。

用户应当可以连续澄清需求而不承担重复建图、重复审查和重复验证的时间成本，同时在规划发生实质变化时仍能可靠发现并更新过期 DAG。

## 已确认事实

- `workflow.md` 把 Phase 1.4 标记为 `[required · once when execution.dag.enabled]`，但 planning 与 planning-inline breadcrumb 每轮都会无条件注入“create and validate `execution.json`”。
- Python、OpenCode、Pi 的 per-turn hook/plugin 只读取并注入 breadcrumb，不会主动调用 DAG CLI；重复动作主要来自 Agent 对持续性提示的执行。
- `execution scaffold` 已有计划时默认拒绝覆盖，只有显式 `--force` 才会替换；它不是后台自动重建器。
- `execution validate` 是只读结构校验；`task.py start` 还会在 `planning -> in_progress` 边界检查显式计划。
- runtime 已通过规范化 `planHash` 检测 `execution.json` 在 run 启动后的变化，但当前无法发现 PRD/design/implement 已变化而 DAG 未同步的情况。
- 原 DAG 需求与设计将 `execution.json` 定义为稳定、可审查的计划，不是每轮对话产生的临时产物。
- `marketplace/workflows/native`、`tdd` 和 `channel-driven-subagent-dispatch` 的 planning breadcrumb 也包含无条件 create/validate 指令；三份文件当前已有未提交改动，与本任务修改面重叠。

## 需求

### R1. 以规划收敛而不是对话回合作为 DAG 触发条件

- 需求探索期间只更新 `prd.md`、必要的 `design.md` 和 `implement.md`，不得 scaffold 或 validate DAG。
- Agent 必须区分阻塞性未决问题和非阻塞性问题。只有会改变交付物、验收标准、技术边界、节点依赖、读写范围、资源锁或验证要求的问题才阻止规划收敛。
- 当阻塞性未决问题为空、规划材料之间没有冲突且节点边界可以被可靠表达时，规划状态才可视为 `planning_converged`。

### R2. DAG 只生成一次，并按实质变化更新

- `planning_converged` 且 `execution.json` 不存在时，允许 scaffold 一次，随后必须人工校正并 validate。
- 已存在且仍匹配当前规划的 DAG 必须直接复用；普通沟通不得重复 scaffold 或 validate。
- 规划发生实质变化时，应原地更新受影响节点、边和约束，再 validate 一次；不得自动使用 `scaffold --force` 覆盖已审查计划。
- 仅措辞、解释、提交信息或明确不在本次范围内的未来讨论，不应使 DAG 失效。
- 是否属于实质变化由 Agent 对照最新 PRD/design/implement 与已有 DAG 判断；本任务不新增持久化 freshness、fingerprint 或文档状态字段。

### R3. 审批顺序

- DAG 是最终实施计划的一部分，必须在最终规划摘要之前生成并展示。
- 正确顺序为：需求收敛 → 生成/更新并验证 DAG → 展示最新最终规划摘要 → 用户在后续消息中明确批准 → `task.py start`。
- DAG 生成后的实质规划变化必须使旧批准失效，并重新展示变化后的最终规划摘要。

### R4. Per-turn breadcrumb 契约

- planning 与 planning-inline breadcrumb 必须继续提醒 Phase 1.4 这个一次性必需门禁，不能简单删除 DAG 指引。
- 提示必须明确：需求探索期间不得处理 DAG；计划不存在时才 scaffold；存在且未失效时跳过；实质变化后只更新并重新验证。
- Python、OpenCode、Pi 等平台仍从同一 `workflow.md` block 获取语义，不在各适配器复制规则。

### R5. 安全与兼容

- 保留 `execution.dag.enabled`、`require_for_complex_tasks`、单节点 DAG、legacy serial fallback 和 `task.py start` 最终门禁的既有语义。
- 不改变 ready/claim/complete、NodeResult、executor、恢复或 final barrier 的运行时契约。
- 已有无新增规划状态元数据的 `execution.json` 必须保持可读、可验证和可启动。

## 范围外

- 不优化 DAG 调度器、validator 算法性能或 subagent 并发策略。
- 不让 Agent 在需求仍不明确时用 DAG 代替需求澄清。
- 不根据自然语言聊天记录直接计算语义 hash；权威输入仍是任务规划 artifacts。
- 不增加 PRD/design/implement fingerprint、`missing/current/stale/invalid` 状态机、validated timestamp、sidecar 或其他文档状态机制。
- 不自动 `--force` 重建或覆盖人工审查过的 `execution.json`。
- 不改变已启动 runtime 的 planHash 冻结与恢复行为。

## Acceptance Criteria

- [x] planning 状态下连续发生普通需求沟通、且规划 artifacts 未实质变化时，不执行 `execution scaffold` 或 `execution validate`。
- [x] 阻塞性未决问题仍存在时，Agent 继续澄清并更新规划 artifacts，不生成 DAG。
- [x] 规划首次收敛且没有 `execution.json` 时，只 scaffold 一次、校正一次并 validate 一次。
- [x] 已有且未失效的 `execution.json` 在后续回合被复用，不发生覆盖、重写或重复审查。
- [x] 改变交付物、依赖、读写范围、资源锁或验证要求后，旧 DAG 被识别为需要更新，并在更新后只 validate 一次。
- [x] 非实质措辞变化不会错误触发 DAG 更新。
- [x] planning 与 planning-inline 两个 breadcrumb 均表达相同的一次性、条件化门禁，并保持 Phase 1.4 可达。
- [x] DAG 出现在最终规划摘要中；用户批准发生在该摘要之后，实质变化会要求重新批准。
- [x] 二次 scaffold 仍默认拒绝覆盖；任何自动路径都不使用 `--force`。
- [x] 现有 task start、legacy fallback 和 runtime planHash 回归测试继续通过。
- [x] 新增回归测试覆盖 per-turn breadcrumb、首次生成、未变化复用、实质变化和兼容路径。

## 关键决策

- 采用轻量的 Agent 规则方案：Agent 根据显式 convergence checklist 判断首次建图时机，并根据规划 artifacts 判断已有 DAG 是否受到实质影响。
- 不引入 planning fingerprint 或复杂文档状态机制；这些机制仍需要 Agent 解释语义变化，无法替代收敛判断，且会扩大 schema、迁移和误报成本。
- 保留 `task.py start` 的最终结构门禁和 runtime `planHash`；它们负责计划合法性与运行时冻结，不承担规划语义 freshness 判断。
- 用户已明确授权本任务接管 `marketplace` 三份现有 workflow 改动；它们作为此前 DAG 工作的延续，在保留现有内容的基础上修正 convergence 契约并形成独立子仓库提交。
- `marketplace/workflows/native/workflow.md` 必须继续与 packaged Suncode workflow 字节一致；TDD 和 channel-driven 变体保留各自角色语义，但共享相同的 planning convergence 门禁。
- `docs-site`、其余用户脏改、package version、migration schema 和 DAG runtime 不进入本任务。
