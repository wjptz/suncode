---
name: suncode-hub-spec-sync
description: "在启动、规划、恢复或绑定 Suncode Hub 任务时使用；也用于拉取/选择 Hub 需求后、<hub-state> 显示 hub-task:hub-bound 或 hub-task:hub-pending 时、或用户要求在开工前从 Hub 刷新项目 spec 时。"
---

# Suncode Hub Spec 同步

只在已启用 Hub 的团队任务中使用本 skill。Hub 服务端是团队 spec 的权威来源；AI 只调度固定 CLI 同步命令，并遵循结构化结果。

## 规则

- 不要手工对比、合并、重写或删除 spec 文件。
- 不要逐个打开 spec 文件来判断哪里变了。
- 不要把 local-only spec 当成 Hub 权威规范。
- 不要把 Hub 已删除的文件恢复到旧的 Hub-managed 路径。
- 如果 Hub 关闭、登录缺失、服务不可用，或 spec 同步失败，停止 Hub 任务规划，并说明准确阻塞原因。
- 如果存在 local-only spec，继续 Hub 任务。它们不阻塞当前任务。
- 如果存在删除候选，继续 Hub 任务。只有用户明确要求时才复盘这些候选。

## 流程

1. 优先读取 `<hub-state>`。
2. 如果 Hub 为 off，使用普通本地 Suncode 工作流，并停止本 Hub 专用流程。
3. 如果 Hub 配置或登录缺失，让用户执行 `<hub-state>` 或 `suncode hub state` 中提示的具体设置命令。
4. 运行固定同步命令：

```bash
suncode hub pull-spec --json
```

5. 命令成功后，在已同步的 Hub spec 约束下继续。
6. 命令失败或超时时，将 Hub spec 判断为当前不可用；同步成功前不要规划或实现 Hub 任务。
7. 如果结果包含 `localOnly`，说明 local-only spec 不阻塞、也不是 Hub 权威规范。
8. 如果结果包含 `deletionCandidates`，说明被删除内容已保存，后续可按用户要求复盘。

## 删除候选复盘

只有用户明确要求复盘被删除 spec 时，才运行：

```bash
suncode hub spec-deletions list --json
```

逐个判断候选内容是否仍值得作为 local-only 补充保留。保留时使用：

```bash
suncode hub spec-deletions keep --id "<id>" --as ".suncode/spec/local/<name>.md"
```

丢弃时使用：

```bash
suncode hub spec-deletions discard --id "<id>"
```

保留下来的文件只是本地补充。如果它与 Hub spec 冲突，以 Hub spec 为准。
