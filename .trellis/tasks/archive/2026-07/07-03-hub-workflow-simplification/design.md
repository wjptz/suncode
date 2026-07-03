# Hub Workflow Simplification Design

## Scope

本设计覆盖 `hub-workflow-review.md` 的 P1 和 P2。目标不是删除 Hub 能力，而是把默认工作流压缩为少数高层意图命令，并把 Hub 状态判断、hook prompt、生命周期 gate 和同步失败处理收敛到可测试 CLI 状态机。

## Architecture

### Command layers

默认用户/AI 层：

| Action | Command |
| --- | --- |
| Check availability | `suncode hub state` |
| Claim requirement | `suncode hub intake` |
| Submit plan and prepare start | `suncode hub plan-ready --task current` |
| Run review | `suncode hub review --task current` |
| Submit completion | `suncode hub finish --task current` |

Advanced/debug 层保留现有低层命令：`pull`、`download-document`、`create-task`、`pull-spec`、`submit-plan`、`submit-subtasks`、`submit-spec`、`submit-completion`、`sync`、`pull-review`、`latest-review`、`preflight-start`、`mark-started`、`spec-deletions *`。

独立能力层保留 `knowledge`、`skill-push`、`skill-pull`，但不混入默认 task lifecycle。

### Hub workflow state module

新增内部模块，建议路径：

```text
packages/cli/src/commands/hub/workflow-state.ts
```

职责：

- 读取 Hub config/login/service/current task/spec/review/sync queue。
- 计算 `hubCode`、`taskState`、`allowedActions`、`blockedReasons`、`nextActionCode`。
- 为 `hub state --json` 提供结构化输出。
- 为 `hub state --prompt --hook` 生成 `<hub-state>` prompt block。

该模块应避免读取 secrets；token 只在 auth/client 边界使用，不进入 prompt、state cache 或 manifest。

### Hook integration

保留平台入口：

- shared Python hook：Claude/Codex/Gemini/Qoder/CodeBuddy/Droid/Kiro/Trae 等。
- OpenCode JS plugin：OpenCode `chat.message` plugin。

变更目标：

```text
Python hook         -> short timeout -> suncode hub state --prompt --hook -> inject output
OpenCode JS plugin -> short timeout -> suncode hub state --prompt --hook -> inject output
```

hook 只负责：

1. 找 repo root。
2. 解析 session/context id。
3. 设置 `SUNCODE_HOOKS=0` 防递归。
4. 短超时调用 CLI。
5. CLI 失败时注入最小 fail-closed block。

### Intake state machine

`suncode hub intake` 的核心状态：

| State | Behavior |
| --- | --- |
| no work | 输出 `no_available_work`，不创建任务 |
| exactly one + `--auto` | 领取并创建本地 task |
| multiple | 输出 `ambiguous` 和候选列表，不创建任务 |
| explicit `--requirement <id>` | 领取指定 requirement |
| matched document payload | 下载到 task/inbox 或约定目录 |
| bound | 创建/更新 Hub remote task binding，拉取 authoritative spec |

多候选不能猜测。AI 看到 `ambiguous` 后必须让用户选择或根据用户已给出的自然语言意图匹配唯一 ID。

### Intake task naming

自动创建本地 task 时：

```text
displayTitle = "HUB-REQ-<requirementId> <requirement.title>"
task.json.title = displayTitle
task.json.name = displayTitle
slug = "hub-req-" + slugifyAscii(requirementId) + optionalAsciiTitlePart
directory = MM-DD-slug
```

示例：

```text
requirementId: REQ-128
title: 优化 Hub 接任务流程

task.json.title: HUB-REQ-128 优化 Hub 接任务流程
task.json.name:  HUB-REQ-128 优化 Hub 接任务流程
directory:       07-03-hub-req-128
```

中文标题不默认翻译，不默认拼音。title 里已有 ASCII 信息时可以追加到 slug，例如 `Agent Hub API` -> `hub-req-131-agent-hub-api`。

### Plan-ready orchestration

`suncode hub plan-ready --task current` 顺序：

1. 解析并校验当前 Hub-bound task。
2. 可选刷新/确认 Hub spec sync 状态。
3. 收集 `prd.md` / `design.md` / `implement.md` / `research/**`。
4. 运行 `submit-plan`。
5. 读取 `subtasks.json` override；不存在时从 `implement.md` 生成 structured subtasks。
6. 运行 `submit-subtasks`。
7. 运行 `preflight-start`。
8. 输出结构化结果和下一步。

### Start gate design

首选方案是新增 `before_start` lifecycle hook，并让 `task.py start` 在任何本地状态变更前运行该 hook：

```text
task.py start <task>
  -> resolve task
  -> run before_start hooks
       -> built-in Hub hook calls suncode hub preflight-start --task-json "$TASK_JSON_PATH"
  -> if before_start succeeds, set active task and task.json.status=in_progress
  -> run existing after_start hooks
       -> submit-subtasks
       -> mark-started
```

这个设计把 `preflight-start` 和 `task.py start` 合并成用户心智上的一个“开始任务”动作，但保留职责边界：

- `preflight-start`：远端 Hub gate，检查计划/审批/策略是否允许开始。
- `task.py start`：本地状态切换和 active task 绑定。
- `after_start`：本地已经开始后做 best-effort 远端同步。

Hub built-in `before_start` hook 必须只对 Hub-bound task 生效。判断边界应尽量放在 `suncode hub preflight-start` 自身：Hub disabled 返回 `disabled`、未绑定 task 返回 `skipped`，并且 hook runner 不应让 skipped/disabled 干扰普通本地 start。真正的 Hub preflight error 才阻止本地 start。

Fallback 方案：如果 lifecycle hook 机制改动风险过大，可以在 `task.py start` 内部直接识别 Hub-bound task 并调用 `suncode hub preflight-start`。这是可接受的退路，但不作为首选，因为它会让 Python task 脚本直接承载 Hub 业务。

### Auto subtasks

默认 parser 应先支持简单稳定格式：

```md
- [ ] 1. Add plan-ready command
- [ ] 2. Add auto subtasks
```

生成字段：

```json
{
  "priority": "P2",
  "name": "Add plan-ready command",
  "description": "Derived from implement.md item 1."
}
```

如果 `subtasks.json` 存在，优先使用 override 并走现有验证。parser 不应把任意 prose 猜成任务；解析不到时返回缺口。

### Finish orchestration

`suncode hub finish --task current` 顺序：

1. 校验 Hub-bound task。
2. 如果 `hub.review.required=true`，确认 latest approved review 匹配当前 diff/head。
3. 检查 completion artifacts 是否存在。
4. 运行 `submit-spec`，让现有 hash manifest 判断是否有变化。
5. 运行 `submit-completion`。
6. 输出可继续 archive/finish 的结果，或输出明确缺口。

### Sync failure queue

新增：

```text
.suncode/.runtime/hub-sync-queue.jsonl
```

记录 best-effort hook 失败：

```json
{
  "version": 1,
  "event": "after_archive",
  "taskJsonPath": ".suncode/tasks/07-03-hub-req-128/task.json",
  "command": "suncode hub submit-completion ...",
  "error": "Hub service unavailable",
  "attempt": 1,
  "firstFailedAt": "2026-07-03T12:00:00Z",
  "lastFailedAt": "2026-07-03T12:00:00Z",
  "nextRetryAt": "2026-07-03T12:05:00Z"
}
```

`hub state` 显示 pending count；`hub sync-pending` 重试并更新 attempt / timestamps。

## Compatibility

- Existing low-level commands remain available.
- Existing `hub.projectId` remains accepted for compatibility.
- OpenCode keeps JS plugin entrypoint.
- Existing `.suncode/hub-spec-manifest.json` hash-based `submit-spec` behavior remains the base mechanism.
- Existing review command remains a single-command review orchestrator.

## Risks

- Hook prompt centralization can break multiple platforms if output format changes without tests.
- `before_start` 如果把 skipped/disabled 当失败，会干扰普通本地任务；测试必须覆盖 Hub off、local-only、Hub-bound pass、Hub-bound failure。
- `implement.md` parsing can become too clever; keep parser conservative and allow `subtasks.json` override.
- `finish` may hide important lower-level failures if it over-aggregates; output must preserve failing step and suggested retry command.
- Naming changes can affect tests and users relying on slug shape; add compatibility tests and keep slug ASCII.
