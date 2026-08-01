# DAG 规划收敛门禁：技术设计

## 设计结论

采用“条件化 per-turn 提醒 + Agent 收敛判断”的最小方案，不增加任何持久化文档状态：

```text
每条用户消息
  → hook/plugin 读取 workflow-state planning block
  → 注入条件化门禁
  → Agent 检查阻塞性疑问与 planning artifacts
      ├─ 未收敛：只澄清并更新 PRD/design/implement
      └─ 已收敛：进入一次性 DAG finalization
                     ├─ execution.json 缺失：scaffold → 人工校正 → validate
                     ├─ 已有且无实质变化：直接复用
                     └─ 实质变化：原地更新 → validate
  → 展示包含 DAG 的最终规划摘要
  → 后续消息明确批准后 task.py start
```

核心不变量：breadcrumb 每轮都会出现，但其中的一次性步骤必须表达成条件门禁，而不是无条件动作命令。

## 边界与真源

### 唯一运行时真源

`packages/cli/src/templates/suncode/workflow.md` 是 packaged Suncode workflow 与 `[workflow-state:*]` body 的真源。

Python、OpenCode、Pi 等适配层保持纯解析/注入职责：

- 不读取新的 planning 状态文件；
- 不执行 `execution scaffold` / `execution validate`；
- 不复制 convergence 文案；
- 不修改 hook/plugin 代码。

### Marketplace 镜像

| 文件 | 同步策略 |
|---|---|
| `marketplace/workflows/native/workflow.md` | 与 packaged Suncode workflow 保持字节一致 |
| `marketplace/workflows/tdd/workflow.md` | 复用同一收敛门禁，保留 behavior slices、public interface、mock boundary 与 red/green/refactor 语义 |
| `marketplace/workflows/channel-driven-subagent-dispatch/workflow.md` | 复用同一收敛门禁，保留 channel coordinator、channelArgs/context-file 与 worker fan-out 语义 |

当前三份 marketplace diff 已由用户授权纳入任务；提交边界仍只包含这三个文件。

## Planning convergence 契约

### 阻塞性疑问

以下未决问题存在时不得生成或验证 DAG：

- 会增加、删除或改变交付物；
- 会改变验收标准；
- 会改变主要技术边界或接口；
- 会改变节点划分、依赖关系、读写范围、资源锁或验证要求；
- 会改变本次范围、兼容性、风险承担或用户可见行为。

措辞润色、解释已有依赖、提交信息、已明确范围外的未来设想等不阻止收敛。

### 收敛条件

Agent 只能在以下条件全部满足时进入 DAG finalization：

1. 阻塞性未决问题为空；
2. PRD 的目标、范围、非目标和验收标准明确；
3. 复杂任务的 design 与 implement 已完成且相互一致；
4. 可以稳定识别独立交付物与真实依赖；
5. 可以声明安全的 reads/writes/resources 和节点 validation；
6. 技术未知已研究，或被明确延后且不改变本次行为。

该状态是工作流判断，不写入 `task.json`、`execution.json` metadata 或 sidecar。

## 一次性 DAG finalization

### execution.json 不存在

```text
scaffold once
→ 审阅并原地编辑所有节点/边界
→ validate once
→ show/摘要
```

`scaffold` 仍只是保守起点。不得在 requirements exploration 中提前运行。

### execution.json 已存在且规划无实质变化

```text
reuse
```

不得运行 scaffold、`scaffold --force`、重复 validate 或重复全图审查。

### 规划发生实质变化

Agent 对照最新 PRD/design/implement 与已有 DAG，定位受影响节点和边界：

```text
edit existing execution.json in place
→ validate once
→ 展示 DAG 变化
→ 旧实施批准失效
```

不自动重建；不因普通对话、解释或非实质文案变化触发。

## Breadcrumb 文案结构

planning 与 planning-inline block 都必须覆盖以下信息：

1. DAG planning 是 planning-finalization step，不是 per-turn action；
2. 阻塞性疑问或 artifacts 未收敛时不得 scaffold/validate；
3. 缺少 execution.json 时只 scaffold 一次；
4. 已有且无实质变化时直接复用；
5. 实质变化时原地更新并 validate 一次；
6. 永不自动使用 `--force`；
7. DAG 必须进入最新最终规划摘要，审批发生在之后。

Phase 1.4 详细说明使用相同分支，不允许 breadcrumb 与 walkthrough 再次漂移。

## 兼容与分发

- `execution.json` v1 schema 不变；不新增 metadata、状态或 fingerprint。
- `task.json`、config、migration schema 和 runtime state 不变。
- `execution validate`、`task.py start`、runtime planHash 语义不变。
- existing/legacy tasks 的 fallback 与复杂任务门禁不变。
- `workflow.md` 继续走 hash-tracked whole-file update；不增加 breadcrumb partial merge。
- 现有 `0.6.12` DAG manifest 已负责 execution 配置与模板刷新，本任务不创建新 manifest、不改 package version。

## 测试设计

### Packaged workflow 契约

在 `packages/cli/test/templates/suncode.test.ts` 与必要的 regression invariant 中断言：

- planning 与 planning-inline 都声明 finalization-not-per-turn；
- requirements 未收敛时禁止 scaffold/validate；
- 缺失、复用、实质变化三条分支存在；
- 禁止自动 `--force`；
- DAG 出现在最终规划摘要和后续审批之前；
- Phase 1.4 walkthrough 与 breadcrumb 语义一致。

保留现有二次 scaffold 拒绝覆盖测试；不为未修改的 hook 增加虚假 mock 行为。

### Marketplace 一致性

- native 与 packaged workflow 字节一致；
- TDD planning/planning-inline/Phase 1.4 具备同一 convergence 规则，同时保留 TDD gates；
- channel-driven 对应段具备同一 convergence 规则，同时保留 channel dispatch gates；
- `git diff --check` 通过。

### Upgrade 路径

复用已有 workflow whole-file update integration 场景，并增加当前 convergence 文案断言，证明旧的 pristine workflow 经 `suncode update` 到达新契约。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 删除无条件提示后 Agent 完全忘记 DAG | breadcrumb 保留 required-once 门禁，只把动作条件化 |
| 文案仍被理解为每轮执行 | 明确使用 “not a per-turn action” 与 “do not scaffold or validate” |
| Agent 漏判实质变化 | workflow 给出具体影响维度；最终摘要和后续审批继续作为人工门禁 |
| 非实质变化造成重复返工 | 明确列出不影响 DAG 的变化类型 |
| stale 后覆盖人工计划 | 明确只允许原地编辑，自动路径禁止 `--force` |
| native/TDD/channel 漂移 | native byte parity + 两个变体的语义断言 |
| 覆盖 marketplace 既有工作 | 用户已授权；只提交三份已审计 workflow，保留所有 DAG 相关既有内容 |

## 提交与回滚

提交顺序：

1. marketplace 子仓库提交三份 workflow 的既有 DAG 同步与 convergence 修复；
2. 主仓提交 packaged workflow、spec、测试、任务 artifacts 与新的 marketplace submodule pointer。

回滚只需按相反顺序 revert 两个提交。没有 schema、migration 或 runtime 数据需要回滚。
