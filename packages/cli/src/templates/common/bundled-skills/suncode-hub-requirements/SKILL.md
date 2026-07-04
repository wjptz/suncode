---
name: suncode-hub-requirements
description: "Use when pulling Suncode Hub requirements, starting a Hub-backed team task, syncing a Hub requirement into a local Suncode task, or binding a local task to a Hub requirement."
---

# Suncode Hub Requirements

Use this skill only for projects that have Suncode Hub enabled. If Hub is disabled, say that the project is using the normal local Suncode workflow and stop this Hub-specific flow.

## Rules

- Never print or persist Hub tokens, passwords, or auth headers.
- If `<hub-state>` says `hub-task:local-only`, do not run Hub task submission or lifecycle commands unless the user explicitly asks to bind a Hub requirement.
- Do not ask the user to leave the agent and run a separate Hub command unless a command fails and manual recovery is needed.
- Do not create or bind a task without a concrete Hub requirement ID.
- Do not upload documents from unrelated task directories.
- Treat Hub API as control plane only. Long requirement documents come through Hub-signed MinIO download URLs handled by `suncode hub` commands.

## Flow

1. 运行 `suncode hub state`。
   - 如果 Hub disabled，继续普通 Suncode 流程。
   - 如果 Hub enabled 但 auth/config 缺失，说明精确缺失项；auth 缺失时请用户运行 `suncode hub login`。
2. 仅当用户想领取唯一可用的已分配 requirement 时，运行 `suncode hub intake --auto`。如果候选项不止一个，命令会返回 `ambiguous`；询问用户要领取哪个 requirement ID，然后运行 `suncode hub intake --requirement <id>`。
3. `hub intake` 创建的本地任务必须在 `task.json.name` 和 `task.json.title` 中保留生成的 `HUB-REQ-<requirementId>` 前缀。中文需求标题保留在人类可读标题中，不要翻译或转拼音。目录 slug 保持 ASCII，并以 `hub-req-<requirementId>` 开头。
4. `hub intake` 会把任务路线写入 `task.json.meta.hub.taskType`：
   - taskType: `standard` — 使用普通规划流程。
   - taskType: `quick` — 使用快速路线：`prd.md` 保持最小化，运行 `suncode hub plan-ready --task current` 上传 plan artifacts，跳过 Hub start preflight、计划审批、Hub code review/check-agent review，然后直接开始实施。Quick 仍需在可行时做最小确定性验证；完成产物按需生成并使用中文，至少要有有效的 `validation-summary.md`，最后仍通过 `suncode hub finish --task current` 上传已有完成产物。
   - taskType: `change` — 当前 requirement 是权威需求，`sourceTask` 只用于理解旧需求。编辑需求或代码前，如果存在 `research/source-task.md`，先读取它。
5. `hub intake` 默认会自动同步 Hub spec；若项目配置了 `hub.autoPullSpec: false`，intake 会跳过自动同步并提示可按需运行 `suncode hub pull-spec`。若 intake 输出包含 `spec sync FAILED`，可运行 `suncode hub pull-spec` 重试，spec 同步失败不阻塞规划。Hub spec 是权威约束，不要手工对比或合并 spec 文件。
6. Write or update only the new task's `prd.md`, `design.md`, `implement.md`, and optional `research/**` files.
7. After planning is complete, run:

```bash
suncode hub plan-ready --task current
```

For standard and change tasks, `plan-ready` submits plan artifacts, derives or uploads structured subtasks, and runs Hub start preflight. For quick tasks, `plan-ready` submits plan artifacts and any available structured subtasks, then locally skips Hub start preflight and plan approval. Write `subtasks.json` only when the derived `implement.md` checklist needs an explicit override.

If Hub review later requests changes, pull the review with `suncode hub pull-review --task <task-dir>`. If a review comment or requirement change contains a document payload, download it into the current task before editing:

```bash
suncode hub download-document --document-id "<documentId>" --task "<task-dir>"
```

Update only the current task's planning docs, then submit the plan again.
