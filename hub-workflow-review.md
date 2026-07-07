# Hub Workflow Review

Date: 2026-07-03

## Summary

Hub 的功能方向是对的，但当前 workflow 把太多“可由 CLI 确定性完成的编排步骤”交给了 AI。减负的关键不是删功能，而是把 Hub 从“AI 按说明书跑 10 多步”改成“AI 表达意图，CLI 执行状态机”。

稳定性的关键是把 Hub 状态、生命周期、spec 同步、review gate 收敛到一个可测试的状态机和少数高层命令里，避免 hooks、skills、docs、workflow 多处自然语言重复。

已创建 Trellis task：

```text
.trellis/tasks/07-03-hub-workflow-simplification
```

本 task 范围包含本 review 里的 P1 和 P2：

- P1：`preflight-start` start gate、`hub plan-ready`、auto subtasks、Hub state 降噪、`hub finish`。
- P2：Hub workflow state machine、Python/OpenCode hook 逻辑收敛、sync failure queue、`projectId` / `project_key` 命名梳理、docs/skills 分层、contract/golden tests。

额外纳入一条命名要求：通过 `suncode hub intake` / claim 自动接 Hub 需求并创建本地 task 时，面向人的任务名必须以 `HUB-REQ-` 开头，例如 `HUB-REQ-128 优化 Hub 接任务流程`；目录 slug 仍保持 ASCII，例如 `07-03-hub-req-128`。

原始静态 review 阶段未创建 Trellis/Suncode task，也未执行测试。本次已按用户要求创建上面的 Trellis task，并把 P1/P2 范围与 `HUB-REQ-` 命名要求落入 task artifacts。已静态核对的主要范围包括：

- `packages/cli/src/commands/hub/*`
- Hub bundled skills
- `packages/cli/src/templates/suncode/workflow.md`
- Hub lifecycle hooks
- `inject-workflow-state` hooks
- docs 里的 Team Hub / 配置页
- 当前未跟踪的 `kb-api(1).md`、`skill-package-api(1).md`

会话初始化提示：

```text
Trellis update available: 0.6.2 -> 0.6.5, run trellis upgrade
```

## First Principles

Hub 的本质不是“多一套 AI 流程”，而是：

1. 共享团队需求队列。
2. 把本地 task 和远端工作项稳定绑定。
3. 同步计划、子任务、spec、review、完成物。
4. 提供知识库和技能包这类团队共享上下文。
5. 在不接入 Hub 时不影响普通本地 workflow。

所以 Hub 应该是本地 Suncode workflow 的可选协作层，而不是让 AI 每次背完整操作手册的第二工作流。

不可牺牲的约束：

| Constraint | Meaning |
| --- | --- |
| Hub must be optional | `hub.enabled=false` 时，普通任务不应承担 Hub 认知和运行成本。 |
| CLI should orchestrate deterministic steps | 配置解析、任务绑定、幂等上传、manifest 更新、review gate 判断应由 CLI 做。 |
| AI should do semantic work | AI 主要负责理解需求、写 PRD/design/implement、实现/修复代码、总结验证。 |
| Security boundary must remain | token 不进 prompt；长文档走 MinIO；Hub API 只拿对象引用和 hash。 |
| Sync must be recoverable | 网络失败、hook 失败、review provider 不可用、manifest 不一致时，要能诊断和重试。 |

## Current Pain Points

### 1. Hub command surface is too wide

`hub/index.ts` 里有 20+ 个用户可见入口，例如：

- `pull`
- `create-task`
- `pull-spec`
- `submit-plan`
- `submit-subtasks`
- `preflight-start`
- `mark-started`
- `review`
- `submit-spec`
- `submit-completion`
- `sync`
- `pull-review`
- `knowledge`
- `skill-push`
- `skill-pull`

这些低层命令本身有价值，但不应该都暴露为 AI 日常 workflow 必记步骤。

当前 `suncode-hub-requirements` skill 的实际流程大致是：

1. `hub state`
2. `hub pull`
3. 人工/AI 选 requirement
4. 如有 document payload，再 `download-document`
5. 手写 `task.py create --hub-*`
6. 检查 after_create 是否绑定，不行再 `hub create-task`
7. `hub pull-spec`
8. 写 `prd.md` / `design.md` / `implement.md` / research
9. `hub submit-plan`
10. Hub team project 额外写 `subtasks.json`
11. start 后 hooks 再 `submit-subtasks` / `mark-started`

这个对 AI 来说太重，而且每一步都有分支和失败修复。

### 2. Derived artifacts are maintained by AI

`subtasks.json` 当前是 Hub team project start 前必需，但它本质是从 `implement.md` 派生出来的结构化显示数据。让 AI 额外写一次 JSON 会带来三个问题：

- 和 `implement.md` 容易漂移。
- 轻微格式错误会影响 Hub 同步。
- 每个 Hub task 都多一个机械步骤。

更合理的是 CLI 在 `submit-plan` 或 `preflight-start` 时自动从 `implement.md` 解析/生成初版 subtasks；必要时再允许人工覆盖 `subtasks.json`。

### 3. Hub state injection is useful but noisy

当前 shared hook 会构造 `<hub-state>`。Hub 关闭时也会注入多行：

- `hub:off`
- `workflow:primary`
- `hub-task:*`
- `reason:*`
- `Flow add-on:*`
- `Do not:*`

这对安全有帮助，但对普通本地任务是长期噪音。减负思路：

- Hub off：默认不注入 Hub block，或只注入一行极短 guardrail。
- Hub on 但无 Hub task：只在用户提到 Hub/team/requirement 时刷新 live state。
- Hub-bound 当前任务：才注入完整、机器可读的最小状态。
- Hub service error：fail closed，但不要让 AI 每轮都陷入 Hub 故障处理，除非当前任务确实 Hub-bound。

### 4. Hook, CLI, skills, docs duplicate semantics

同一类规则分散在：

- `packages/cli/src/commands/hub/state.ts`
- `packages/cli/src/templates/shared-hooks/inject-workflow-state.py`
- `packages/cli/src/templates/opencode/plugins/inject-workflow-state.js`
- `packages/cli/src/templates/common/bundled-skills/suncode-hub-*`
- `docs-site/start/team-hub.mdx`
- `docs-site/advanced/configuration.mdx`
- `packages/cli/src/templates/suncode/workflow.md`

比如 Hub state 的“下一步行为”在 CLI 和 hook 里都用自然语言表达；Python hook 和 OpenCode JS hook 也各自实现了一套类似逻辑。这是稳定性风险：以后改一个状态，很容易漏掉另一个平台。

### 5. `preflight-start` / `startReviewPolicy` is not wired strongly enough

`packages/cli/src/commands/hub/lifecycle.ts` 已有 `preflightStart()`，配置里也有 `hub.startReviewPolicy: confirm|block|bypass`，docs 也解释了 start review policy。

但当前 `workflow.md` 和 Hub skills 中，没有把 `suncode hub preflight-start` 明确接到 `task.py start` 前；built-in hooks 的 `after_start` 也只是：

- `submit-subtasks`
- `mark-started`

这会导致语义缺口：配置上看起来支持“开始前审批/确认”，但 AI 可能直接 `task.py start`，然后才 after_start 同步 started。这个应该优先修。

### 6. `projectId` / `project_key` terminology is confusing

CLI 配置和 task meta 叫 `projectId`，但当前未跟踪的 Agent Hub API 文档里，知识库和技能包端点都强调 `/projects/:key` 是 `project_key`，不是数据库自增 ID。

建议：

- 新文档用 `hub.projectKey`，或明确写“`hub.projectId` 当前实际存的是 Agent Hub project_key”。
- CLI 内部可保留 `projectId` 做兼容。
- Agent Hub endpoints 侧 helper 命名为 `projectKey`。
- 新增配置 alias 时不要破坏旧配置。

## Recommended Default Hub Workflow

目标：保留现有能力，但让 AI 日常只记少数高层意图命令。

### Intake: claim Hub requirement

新增或包装高层命令：

```bash
suncode hub intake
```

或：

```bash
suncode hub claim --requirement <id>
```

它内部完成：

1. 检查 Hub config / login / service。
2. 拉取 assigned requirements。
3. 支持选择或指定 requirement。
4. 下载 requirement document payload 到当前 task/inbox。
5. 创建本地 task，写入 Hub meta。
6. 绑定 remote task。
7. 拉取 Hub authoritative spec。
8. 输出 task 路径和下一步。

AI 只需要做：理解需求并写 planning artifacts。

底层命令 `pull`、`download-document`、`create-task`、`pull-spec` 应保留，但文档标为 advanced/debug，不作为 AI 默认流程。

### Plan-ready: submit plan and preflight start

新增或增强：

```bash
suncode hub plan-ready --task current
```

内部完成：

1. 确认 task 已 Hub-bound。
2. 确认/刷新 Hub spec 状态。
3. 收集 `prd.md`、`design.md`、`implement.md`、`research/**`。
4. 上传 plan artifacts。
5. 如果没有 `subtasks.json`，从 `implement.md` 自动生成最小 subtasks。
6. 上传 subtasks。
7. 调用 `preflight-start`，根据 `startReviewPolicy` 返回：
   - `ok`
   - `needs_confirmation`
   - `blocked`

这样 `subtasks.json` 从“AI 必写文件”降级为“可选覆盖文件”。

### Start: preflight before `task.py start`

推荐长期方案：新增 before-start gate。

对 Hub-bound task，在状态翻到 `in_progress` 前运行：

```bash
suncode hub preflight-start
```

短期方案：在 `workflow.md` Phase 1.5 明确写：

```bash
suncode hub preflight-start --task current
python3 ./.suncode/scripts/task.py start <task-dir>
```

长期还是 CLI gate 更稳，因为 AI 容易跳过自然语言步骤。

### Review: keep one command

`hub review` 的方向是对的：一个命令负责编排 round、diff、provider、`result.md`、`review.json`、上传、状态同步。

建议触发方式：

```bash
suncode hub review --task current
```

默认只在以下情况触发：

- 用户要求 review。
- `hub.review.required=true` 且准备完成。
- Hub 返回 `changes_requested`。
- `suncode hub finish` 内部发现 completion 被 review gate 阻塞。

### Finish: one high-level completion command

新增：

```bash
suncode hub finish --task current
```

内部完成：

1. 确认 task Hub-bound。
2. 如果 `review.required=true`，确认最新 approved review 仍匹配当前 diff。
3. 检查 completion artifacts：
   - `implementation-summary.md`
   - `validation-summary.md`
   - `retrospective.md`
   - `reuse-assessment.md`
4. 如果文件缺失，返回结构化缺口，不要静默 skip。
5. 如果 spec 有变更，提交 spec。
6. 提交 completion。
7. 输出“可以继续普通 Suncode archive/finish”。

现有 `submit-spec`、`submit-completion` 保留为低层命令。

## Hub State Injection

建议把 `<hub-state>` 改成三档注入。

### Hub off: silent or one-line guardrail

默认不注入 `<hub-state>`，或仅注入：

```text
<hub-state>hub:off; use local workflow unless user asks for Hub</hub-state>
```

只有用户消息包含 `hub`、`team`、`requirement`、`团队任务` 等意图时才展开完整诊断。

### Hub on but current task is local-only

```text
<hub-state>
hub:ok
hub-task:local-only
do-not: submit-plan submit-completion mark-started
</hub-state>
```

不需要每轮告诉 AI “ask before pulling Hub work”等长句。

### Hub-bound task

```text
<hub-state>
hub:ok
hub-task:hub-bound
work:3 available
allowed:intake sync submit-plan review finish
blocked:none
</hub-state>
```

AI 更容易稳定读取机器行，而不是自然语言段落。

### Live refresh: TTL + on-intent

当前 hook 在 Hub enabled + logged in 时会调用 `suncode hub state --json`，默认 1500ms timeout。建议：

- 每轮先读 `.suncode/.runtime/hub-state.json`。
- 如果 cache 新鲜，例如 60 秒内，直接用 cache。
- 只有以下情况 live refresh：
  - 用户明确提 Hub。
  - 当前 task 是 Hub-bound/hub-pending。
  - cache 过期。
  - 上次状态是 config/login/server-error 且用户要求重试。
- refresh 失败 fail closed，但不要把 stale cache 当可用 Hub。

## Stability Improvements

### 1. Centralize Hub workflow state

新增内部模块，例如：

```text
packages/cli/src/commands/hub/workflow-state.ts
```

集中定义：

- Hub config state
- login state
- service state
- current task state
- spec sync state
- review gate state
- allowed actions
- blocked reason
- next action code

然后：

- `hub state --json` 输出这个状态机。
- `hub state --prompt` 输出 `<hub-state>`。
- Python hook 和 OpenCode JS hook 不再各自拼 Hub 状态逻辑，只调用 CLI 或读取 CLI 生成的 prompt。
- docs/skills 只引用状态码，不复制完整判断逻辑。

### 2. Keep OpenCode JS plugin, but remove duplicated Hub logic

OpenCode 确实需要自己的 JS plugin 入口。这不是问题，也不应该删。

问题不在入口重复，而在 Python hook 和 OpenCode JS plugin 里面重复维护了 Hub 状态构造逻辑。

正确目标：

```text
Python hook         -> call CLI -> inject CLI-generated <hub-state>
OpenCode JS plugin -> call CLI -> inject CLI-generated <hub-state>
```

也就是保留：

```text
.claude/.codex/.../inject-workflow-state.py
.opencode/plugins/inject-workflow-state.js
```

但把 Hub 判断集中到 CLI，例如：

```bash
suncode hub state --prompt --hook
```

两个 hook 只做平台适配：

1. 找 repo root。
2. 解析当前 session/context id。
3. 设置 `SUNCODE_HOOKS=0` 防止递归。
4. 短超时调用 CLI。
5. 把 CLI 返回的 `<hub-state>` 注入对应平台。

### 3. Make best-effort hook failures visible

当前 built-in Hub lifecycle hooks 都带 `--best-effort`。这对“不阻塞本地工作”是好的，但同步失败可能只在 stderr 警告里出现，后续 AI 不知道。

建议新增：

```text
.suncode/.runtime/hub-sync-queue.jsonl
```

当 after_create / after_start / after_archive 的 Hub 命令失败时，记录：

- taskJsonPath
- event
- command
- error
- attempt
- firstFailedAt
- lastFailedAt
- nextRetryAt

再提供：

```bash
suncode hub sync-pending
suncode hub state
```

`hub state` 显示 `pendingSyncCount`。

### 4. Distinguish fail-closed and fail-soft

| Scenario | Strategy | Reason |
| --- | --- | --- |
| Hub config invalid | fail closed for Hub flow | 错项目/错服务会污染团队状态。 |
| login missing/expired | fail closed for Hub flow | 没鉴权不能同步。 |
| Hub spec sync before Hub task planning | fail closed | 团队 spec 是权威约束。 |
| preflight-start | fail closed | 这是开始 gate。 |
| required review gate | fail closed | 完成前审核要求必须可靠。 |
| mark-started status sync | fail-soft + queue | 本地实现不应因状态同步暂时失败而丢进度。 |
| submit completion after archive | configurable | 团队可选 strict；默认 fail-soft + queue。 |
| knowledge search | fail-soft | 是辅助检索，不应阻塞任务。 |
| skill pull/push | fail explicit | 用户直接执行的命令，失败应明确返回。 |

### 5. Keep remote-wins spec sync, but reduce noise

`pullHubSpecs` 的方向是好的：

- remote spec authoritative
- sha256 / size 校验
- 删除的 Hub-managed spec 先保存 deletion candidate
- local-only spec 不阻塞

建议保留这套设计。但 workflow 不要让 AI 每次手工判断 localOnly/deletionCandidates。

命令输出分层：

- 默认人类摘要：`updated: 2, deleted: 1 preserved, local-only: 3 ignored`
- JSON 保留详细候选。
- 只有用户要求复盘删除候选时才打开 `spec-deletions list/keep/discard`。

### 6. Add API contract tests

Hub 涉及两个服务面：

1. `/api/v1`: requirements, tasks, artifacts, specs, review
2. `/api/agent-hub`: knowledge, skill packages

建议对 CLI 与服务端加 contract fixture：

- requirement response
- document payload
- artifact upload session
- spec bundle
- review submission
- knowledge vector search
- skill package list/detail/file content

当前 CLI 很多地方是手写 normalize。可以继续保留，但应加 golden fixture tests，至少保证字段改名时 CLI 失败得清楚，而不是返回空结果。

## Recommended Command Layers

### Default user/AI layer

| Action | Command |
| --- | --- |
| Check Hub availability | `suncode hub state` |
| Claim Hub requirement | `suncode hub intake` |
| Submit plan and prepare start | `suncode hub plan-ready --task current` |
| Run review | `suncode hub review --task current` |
| Submit completion | `suncode hub finish --task current` |

### Advanced/debug layer

保留现有低层命令，但 docs 标为 advanced/debug：

- `pull`
- `download-document`
- `create-task`
- `pull-spec`
- `submit-plan`
- `submit-subtasks`
- `submit-spec`
- `submit-completion`
- `sync`
- `pull-review`
- `latest-review`
- `preflight-start`
- `mark-started`
- `spec-deletions *`

### Independent capability layer

这些不应成为 Hub task 的默认步骤，只在用户明确需要时用：

- `suncode hub knowledge`
- `suncode hub skill-push`
- `suncode hub skill-pull`

知识库和技能包是上下文/能力共享，不是每个任务的生命周期 gate。

## Intake Selection Semantics

“一个高层命令”不等于“AI 盲接任务”。`intake` 应该是确定性的列出/选择/领取状态机，而不是让 CLI 在多个候选里猜。

### Multiple candidates

默认命令：

```bash
suncode hub intake
```

行为：

- 没有可接需求：输出 `no_available_work`。
- 只有 1 个可接需求：可以继续，或根据 `--auto` 策略继续。
- 有 2 个或更多：只列出候选，不 claim，不创建本地 task。

示例：

```text
Hub has 2 available requirements:

[1] REQ-128  Hub workflow simplification
    priority: high
    status: ready
    updated: 2026-07-03

[2] REQ-129  Skill package API docs
    priority: normal
    status: ready
    updated: 2026-07-02

Select one:
  suncode hub intake --requirement REQ-128
  suncode hub intake --requirement REQ-129
```

`--json` 应返回：

```json
{
  "status": "ambiguous",
  "availableCount": 2,
  "requirements": [
    {
      "id": "REQ-128",
      "title": "Hub workflow simplification",
      "priority": "high",
      "status": "ready"
    },
    {
      "id": "REQ-129",
      "title": "Skill package API docs",
      "priority": "normal",
      "status": "ready"
    }
  ],
  "nextActions": [
    "suncode hub intake --requirement REQ-128",
    "suncode hub intake --requirement REQ-129"
  ]
}
```

AI 看到 `status=ambiguous` 时，正确行为是问用户接哪一个。CLI 不应该按优先级、更新时间、列表第一项自行领取，除非用户或命令明确要求自动策略。

### Explicit selection

推荐支持：

```bash
suncode hub intake --list
suncode hub intake --requirement REQ-128
suncode hub intake --requirement REQ-128 --yes
```

可选短形式：

```bash
suncode hub intake REQ-128
```

但文档里更推荐显式 `--requirement`。

### Auto mode

```bash
suncode hub intake --auto
```

安全规则：

| Candidate count | Behavior |
| --- | --- |
| 0 | 不创建，返回 no work |
| 1 | 可以创建 |
| >1 | 不创建，返回 ambiguous |

即使叫 `--auto`，也不能在多个候选里猜。

## Task Naming Semantics

任务命名分两层：

| Layer | Owner | Recommendation |
| --- | --- | --- |
| 本地 task title | Hub requirement title 默认带入 | 不让 AI 重写语义 |
| 本地 task slug / 目录名 | CLI 从 ID/title 派生 | 稳定、去重、可覆盖 |

建议 Hub-bound task 默认带远端 ID，方便追踪：

```text
07-03-req-128-hub-workflow-simplification
```

如果两个需求标题很像，也不会撞名；人也能从目录名看出绑定关系。

### Chinese titles

中文 title 应拆成两件事处理：

1. 展示名保留中文：`task.json.title` / `task.json.name` / `prd.md` 标题 / Hub 展示字段都用中文。
2. 目录名和稳定 id 用 ASCII：不能直接从中文 title 硬生成目录 slug；默认用远端 requirement id 兜底。

例如 Hub 需求：

```text
requirementId: REQ-130
title: 优化 Hub 接任务流程
```

默认生成：

```text
.trellis/tasks/07-03-req-130/
```

`task.json` 写：

```json
{
  "id": "req-130",
  "name": "优化 Hub 接任务流程",
  "title": "优化 Hub 接任务流程",
  "meta": {
    "hub": {
      "remoteRequirementId": "REQ-130",
      "bindingStatus": "bound"
    }
  }
}
```

`prd.md` 第一行：

```md
# 优化 Hub 接任务流程
```

也就是说：中文只做展示和文档语义，ASCII id 只做路径、脚本参数、机器追踪。

不建议 CLI 在 AI 不介入时把中文自动翻成英文 slug，例如：

```text
优化 Hub 接任务流程 -> optimize-hub-intake-workflow
```

原因是这不是确定性编排，而是语义翻译。不同模型、不同词典、不同人会取出不同 slug，后续追踪会变乱。

也不建议默认拼音：

```text
优化 Hub 接任务流程 -> you-hua-hub-jie-ren-wu-liu-cheng
```

拼音可读性一般，依赖中文分词/多音字规则，还会引入额外库。可以作为未来可选项，但不该是默认规则。

如果中文 title 里有 ASCII，可以保留有用部分：

```text
REQ-131 / Agent Hub 知识库 API 对接
-> req-131-agent-hub-api
```

纯中文 title 默认只用 requirement id：

```text
REQ-132 / 登录状态识别
-> req-132
```

允许用户或 AI 显式覆盖 slug：

```bash
suncode hub intake --requirement REQ-130 --slug hub-intake-workflow
```

推荐生成：

```text
.trellis/tasks/07-03-req-130-hub-intake-workflow/
```

### Proposed slug rule

```text
displayTitle = requirement.title
safeRequirementKey = slugifyAscii(requirement.id or requirement.key)
asciiTitlePart = slugifyAscii(requirement.title)

if --slug provided:
  slug = safeRequirementKey + "-" + slugifyAscii(--slug)
else if asciiTitlePart is non-empty:
  slug = safeRequirementKey + "-" + asciiTitlePart
else:
  slug = safeRequirementKey
```

创建结果：

```text
task.json.id     = slug
task.json.name   = requirement.title
task.json.title  = requirement.title
directory        = MM-DD-slug
Hub localTaskId  = slug
Hub localTaskName/title = requirement.title
```

当前 `task.py create` 还有一个需要修的点：`name` 现在写的是 slug，不是中文展示名。对于 Hub intake，至少新命令创建本地 task 时应写 `name/title = 中文 title`；更彻底一点是把 `task.py create` 本身也改成 `name = title`、`id = slug`。

## Recommended Delivery Order

### P1: reduce AI workflow burden and wire start gate

1. 在 `workflow.md` Phase 1.5 接入 `preflight-start`，或更好地新增 before-start gate。
2. 新增 `suncode hub plan-ready --task current`：
   - `submit-plan`
   - auto subtasks
   - `preflight-start`
3. 把 `subtasks.json` 从“Hub team project 必写”改成“CLI 自动生成，可手工覆盖”。
4. Hub off/local-only 时压缩 `<hub-state>` 注入。

### P1: high-level finish command

新增：

```bash
suncode hub finish --task current
```

它负责 required review gate、completion artifact 检查、`submit-spec`、`submit-completion`。

`suncode-hub-finish` skill 改成只调用这个命令并解释结果。

### P2: unified Hub state machine

1. 新增 `hub/workflow-state.ts`。
2. `hub state --json` 输出状态码和 allowed/blocked actions。
3. `hub state --prompt` 生成 hook block。
4. Python/OpenCode hook 调 CLI，不再复制 Hub state 分支。
5. 为状态机加 golden tests。

### P2: sync failure queue

1. best-effort hook 失败写 `.suncode/.runtime/hub-sync-queue.jsonl`。
2. `hub state` 显示 pending sync。
3. `hub sync-pending` 重试。
4. archive/finish 时如果有当前 task 的 pending critical sync，明确提醒。

### P2: naming and docs

1. 统一 `projectId` / `project_key` 术语。
2. Team Hub docs 只讲默认 5 个动作。
3. 低层命令移到 advanced/debug。
4. `suncode-hub-*` skills 合并或降级成一个 router skill + references，减少自动触发面。

## Minimal Executable Change Set

如果尽量小改，建议先做 4 件事：

1. Workflow 文档修正：把 `preflight-start` 明确放到 Hub task `task.py start` 前。
2. Hub state 降噪：Hub off/local-only 注入极简 block；Hub-bound 才展开。
3. 自动 subtasks：允许 `submit-subtasks` 从 `implement.md` 生成默认 subtasks，`subtasks.json` 只作为 override。
4. 新增 `hub plan-ready`：把 `submit-plan + submit-subtasks + preflight-start` 合成一个命令。

这 4 件不需要重做整个 Hub 架构，但能显著降低 AI 操作复杂度，并堵上 start review policy 的稳定性缺口。
