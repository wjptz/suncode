# Suncode Hub Collaboration

## Scenario: Hub Init, Login, Logout, and State

### 1. Scope / Trigger

- Trigger: CLI commands, lifecycle hooks, workflow templates, or bundled skills
  that initialize Hub, authenticate to Hub, inspect Hub state, or decide whether
  an AI session may use Hub-specific task workflows.
- Applies to `packages/cli/src/commands/hub/**`, generated workflow-state hooks,
  OpenCode plugins, and Hub-facing bundled skills.
- Hub integration is optional. Disabled local projects must not contact Hub.

### 2. Signatures

CLI commands:

```text
suncode hub init [--api-base-url <url>] [--project-api-base-url <url>] --project-id <id> [--developer-id <id>] [--start-review-policy confirm|block|bypass] [--no-auto-pull-spec] [--yes]
suncode hub login [--api-base-url <url>] [--email <email>] [--username <email-alias>] [--password <password>]
suncode hub logout [--api-base-url <url>]
suncode hub state [--json]
```

Hub login API:

```http
POST /api/auth/login
Content-Type: application/json
```

Hub health API:

```http
GET /api/v1/health
Authorization: Bearer <token>
```

### 3. Contracts

Global Hub config:

```text
~/.suncode/hub/config.json
```

```json
{
  "version": 1,
  "defaultApiBaseUrl": "https://hub.example.test"
}
```

Global Hub auth:

```text
~/.suncode/hub/auth.json
```

```json
{
  "version": 1,
  "sessions": {
    "https://hub.example.test": {
      "developerId": "1",
      "displayName": "Admin",
      "token": "jwt",
      "expiresAt": "2026-07-08T12:00:00Z",
      "loggedInAt": "2026-07-01T12:00:00Z"
    }
  }
}
```

Project config:

```yaml
hub:
  enabled: true
  mode: team
  projectId: proj_123
  apiBaseUrl: null
  developerId: null
  startReviewPolicy: confirm
  autoPullSpec: true
  review:
    enabled: false
    provider: engineer
    required: false
    trigger: manual
    unavailablePolicy: bypass
    engineer:
      command: engineer
      args: ["run"]
      timeoutSeconds: 900
      saveRawOutput: true
```

Resolution order:

1. Project `hub.apiBaseUrl` when present.
2. Global `defaultApiBaseUrl`.
3. Auth session keyed by normalized `apiBaseUrl`.

Project state cache:

```text
.suncode/.runtime/hub-state.json
```

The state cache is project-scoped and must not contain tokens, passwords,
`Authorization` headers, signed URLs, private keys, or full stack traces.

Authentication contract:

- `SUNCODE_HUB_TOKEN` is not an authentication source.
- Hub auth comes only from `suncode hub login` sessions.
- `suncode hub login` reuses the existing Hub auth API:
  `POST /api/auth/login` with `{ email, password }`, expecting
  `{ token, user }`.
- The CLI stores `String(user.id)` as the local `developerId`, uses
  `user.display_name` as the display name, and derives `expiresAt` from a JWT
  `exp` claim when present.
- Login state is global but bound to the normalized `apiBaseUrl`.
- State is project-local because it depends on the current project, active task,
  and available work.

Hook contract:

- Per-turn hooks may read project config, global config/auth summaries, current
  task metadata, and the local CLI's structured `hub state` output.
- Per-turn hooks must not implement Hub network API calls directly. For enabled
  projects with complete config and login state, they may invoke
  `suncode hub state --json` with a short timeout so the CLI remains the single
  Hub state aggregator.
- If the `suncode hub state --json` subprocess fails, times out, or returns
  invalid JSON, hooks must emit Hub as currently unavailable. They must not
  fall back to a stale `.suncode/.runtime/hub-state.json` value that makes Hub
  look usable.
- Per-turn hooks append a compact `<hub-state>...</hub-state>` block next to
  `<workflow-state>...</workflow-state>`.
- `<hub-state>` 首行必须是短状态码：`hub:ok`、`hub:off`、
  `hub:not-login`、`hub:config-error`、`hub:server-error` 或
  `hub:unknown`。其余行使用 `workflow:primary`、`hub-task:*`、`work:*`
  摘要和 `Flow add-on:` / `Do not:` 提示，明确它只是
  `<workflow-state>` 的补充层；不输出 spec 摘要、完整
  config/login/service 明细，也不复述 `nextAction` 长句。

Task display and language contract:

- Local task directory names and `task.json.id` stay stable ASCII slugs.
- `task.json.name` and `task.json.title` should use the human-readable Chinese
  task title when available.
- Hub create-task payloads use the Chinese display title for `localTaskName`
  and `title`; `localTaskId` remains the slug.
- Task artifacts, planning artifacts, and spec updates use Simplified Chinese
  as the first language by default. Code identifiers, API fields, command names,
  protocol values, error text, and quoted external terms keep their original
  language.

Spec sync config:

- `hub.autoPullSpec` controls only the automatic spec pull after
  `suncode hub intake`.
- Missing `hub.autoPullSpec` defaults to `true` for backward compatibility.
- `hub.autoPullSpec: false` skips the intake-time automatic `pull-spec` call
  and reports that manual `suncode hub pull-spec` is available.
- Manual `suncode hub pull-spec` ignores this flag and remains available on
  demand.
- `suncode hub init` writes `autoPullSpec: true` by default and supports
  disabling it with `--no-auto-pull-spec`.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Hub disabled or missing config | Report `hub:off`; no network |
| Project enabled but no `apiBaseUrl` from project or global config | Report `hub:config-error`; no network |
| Login session missing for resolved `apiBaseUrl` | Report `hub:not-login` and ask user to run `suncode hub login`; no network |
| Login session expired | Report `hub:not-login`; no network |
| Service health check fails | Report `hub:server-error`; do not enter Hub workflows |
| Service ok and work available | Report `hub:ok` plus `work:N available` and suggest task selection |
| Active task has Hub metadata | Allow Hub task lifecycle commands for that task |
| Active task has no Hub metadata | Report local-only; do not run Hub submit/mark commands |
| `SUNCODE_HUB_TOKEN` is set | Ignore it; behavior depends only on login session |
| `hub.autoPullSpec` is missing | Resolve as `true` |
| `hub.autoPullSpec: false` | `hub intake` skips automatic spec pull; manual `pull-spec` still works |

### 5. Good/Base/Bad Cases

- Good: Two projects resolve to the same normalized Hub base URL and reuse one
  global login session while keeping separate `.suncode/.runtime/hub-state.json`
  files.
- Good: `hub state` writes available-work counts and current-task classification
  without caching credentials.
- Good: `<hub-state>` says `workflow:primary` and uses `Flow add-on:` so the
  AI keeps following `<workflow-state>` first.
- Base: Local-only project has no Hub config; hook emits `hub:off` and tells the
  AI to use normal local workflow.
- Bad: A hook performs a live Hub request on every user prompt.
- Bad: A hook reads stale `hub-state.json` after live refresh failed and tells
  the AI that Hub is usable.
- Bad: A local-only task triggers `submit-plan`, `submit-completion`, or
  `mark-started` without explicit Hub binding.
- Bad: A command silently falls back to `SUNCODE_HUB_TOKEN` when no login
  session exists.

### 6. Tests Required

- Command tests for `hub init`:
  - writes global `defaultApiBaseUrl`
  - writes/replaces only the project `hub:` block
  - preserves unrelated project config
  - supports optional project `apiBaseUrl` override
  - writes explicit review defaults without enabling or requiring review
  - writes `autoPullSpec: true` by default
  - writes `autoPullSpec: false` when `--no-auto-pull-spec` or `autoPullSpec: false` is used
- Command tests for `hub login` / `hub logout`:
  - posts email/password to `/api/auth/login`
  - maps response `user.id` and `user.display_name` into the local auth session
  - stores sessions by normalized `apiBaseUrl`
  - never prints or caches token in project state
  - removes only the selected base URL's session on logout
- Command tests for `hub state`:
  - no network when Hub is off, config is incomplete, login is missing, or token
    is expired
  - detects service unavailable, no work, available work, and current-task
    `none` / `hub-bound` / `hub-pending` / `local-only`
  - ignores `SUNCODE_HUB_TOKEN`
- Hook tests:
  - shared Python hook emits `<hub-state>` in JSON-envelope and Kiro bare-text
    modes
  - OpenCode plugin emits `<hub-state>`
  - enabled/logged-in hooks call `suncode hub state --json`
  - subprocess failure, timeout, and invalid JSON are reported as Hub
    unavailable, not as cached-ok state
  - hook output does not contain tokens or passwords
  - local-only current task warns against Hub-specific task commands
  - hook output does not contain `spec:*`, spec revision, signed URLs, or
    deletion-candidate counts
- Task-name and language tests:
  - `task.py create` keeps `task.json.id` as the slug and writes Chinese
    `name` / `title`
  - the generated PRD uses Chinese headings and states Simplified Chinese is
    preferred
  - `hub create-task` sends Chinese `localTaskName` / `title` while retaining
    slug-based `localTaskId`
- Spec auto-pull config tests:
  - `parseHubSection` accepts `hub.autoPullSpec`.
  - `resolveHubConfig` defaults missing `autoPullSpec` to `true`.
  - `hub intake` with `autoPullSpec: false` creates/binds the task without
    requesting `/specs/bundle`.

### 7. Wrong vs Correct

#### Wrong

```ts
const token = process.env.SUNCODE_HUB_TOKEN ?? auth.sessions[apiBaseUrl]?.token;
await client.requestJson("POST", "/tasks/submit", payload);
```

This reintroduces hidden environment-token auth and can upload local-only work
without a real login/session boundary.

#### Correct

```ts
const session = getHubAuthSession(homeDir, normalizedApiBaseUrl);
if (!session || isExpired(session)) {
  throw new Error("Run `suncode hub login` before using Hub workflows.");
}
if (currentTask.state === "local-only") {
  return { status: "skipped", reason: "task is not bound to Hub" };
}
```

This keeps auth explicit, bound to the resolved Hub service, and scoped to tasks
that actually carry Hub metadata.

## Scenario: Hub Finish Binding Ensure

### 1. 范围 / 触发

- 触发：`suncode hub finish` 为 Hub 任务提交最终 spec 和按需 completion artifacts。
- 适用范围：`packages/cli/src/commands/hub/workflow.ts`、`create-task.ts`、`submissions.ts`、Hub finish 测试，以及 `suncode-hub-finish` bundled skill 文案。
- `finish` 命令负责修复 Hub pending task 的远端绑定缺口，agent 完成前不需要额外走手动 `create-task` 分支。

### 2. 签名

CLI 命令：

```text
suncode hub finish [--task current|<task>] [--task-json <path>] [--file <path>...] [--force] [--best-effort]
```

远端任务绑定来源：

```text
task.json meta.hub.remoteTaskId
.suncode/tasks/<task>/hub-manifest.json remoteTaskId
```

### 3. 合同

- 已绑定任务在 `task.json.meta.hub` 或任务 `hub-manifest.json` 中有 `remoteTaskId`。
- Hub pending task 有 `meta.hub.requirementId`，但没有 `remoteTaskId`。
- Local-only task 没有 `meta.hub.requirementId`。
- Completion artifacts 按需生成和上传，不再要求四个文件齐全。
- `submit-completion` 只收集当前任务目录中已经存在的固定候选文件：`implementation-summary.md`、`validation-summary.md`、`retrospective.md`、`reuse-assessment.md`。
- 候选 completion artifacts 的面向人内容默认使用简体中文；命令名、API 字段、代码符号、文件路径、错误字符串和引用原文可以保留原文。
- Quick task 完成时必须有有效的 `validation-summary.md`：内容必须包含已执行验证证据，或包含 `未执行` 及具体原因。该校验必须发生在 Hub binding 或 upload 之前。
- Standard/change task 不强制 completion artifacts 的固定组合；没有任何 completion artifact 时，底层 `submit-completion` 可按既有行为返回 `skipped: No artifacts found.`。
- 对 Hub pending task，`hub finish` 调用 `hubCreateTask`，成功后记录 `bind` workflow step，重新读取任务，然后继续 `submit-spec` 和 `submit-completion`。
- 底层 `submit-spec` / `submit-completion` 直接调用时仍可跳过未绑定任务；`hub finish` 不能依赖这种 skip 来处理 Hub pending task。

### 4. 校验与错误矩阵

| 条件 | 行为 |
| --- | --- |
| Quick task 缺少 `validation-summary.md` | 在 Hub binding 或 upload 之前报错 |
| Quick task 的 `validation-summary.md` 只是占位内容 | 在 Hub binding 或 upload 之前报错 |
| Standard/change task 只有一个按需 completion artifact | 上传现有 artifact，不要求补齐四个文件 |
| Standard/change task 没有任何 completion artifact | `submit-completion` 返回 `skipped: No artifacts found.`；`hub finish` 仍返回汇总结果 |
| 任务已有 `remoteTaskId` | 不执行 `bind` step，直接提交 spec 和 completion |
| 任务有 `requirementId` 但无 `remoteTaskId` | 使用 `hubCreateTask` 自动绑定，在 workflow summary 中包含 `bind`，然后提交 |
| 自动绑定失败或绑定后仍无 `remoteTaskId` | 抛错；除非用户使用 `--best-effort`，否则命令非零退出 |
| 任务没有 `requirementId` | 返回 local-only 的 `skipped`，不发送 Hub 请求 |
| 尝试绑定时 Hub 被禁用 | 返回 disabled 结果；不要伪装成成功 finish |

### 5. Good/Base/Bad Cases

- Good：pending Hub task 带有按需完成摘要时，执行 `bind -> submit-spec -> submit-completion`，先在本地记录远端任务 ID，再上传 completion artifacts。
- Good：bound task 保持原有 finish 输出形状，只体现正常 submit step 结果。
- Good：quick task 只有一份中文 `validation-summary.md`，内容包含验证证据；finish 绕过 review gate，但仍上传该完成产物。
- Base：local-only task 被报告为不适用 Hub finish，然后继续普通 local finish-work 流程。
- Bad：`hub finish` 在两个底层 submit step 都因 “Task is not bound to a remote Hub task.” 跳过后仍退出 0。
- Bad：`suncode-hub-finish` 默认要求 agent 手动运行 `hub create-task`。
- Bad：`hub finish` 无条件要求 `implementation-summary.md`、`validation-summary.md`、`retrospective.md`、`reuse-assessment.md` 四个文件齐全，导致 quick 或轻量任务为了过 gate 生成空文档。

### 6. 必需测试

- Hub finish 测试：
  - pending Hub task 自动绑定，然后提交 completion artifacts
  - 自动绑定失败时 reject，且不提交 completion
  - local-only task 返回 skipped，且不发送 Hub 请求
  - already bound task 提交时不再发 create-task 请求
  - standard/change task 只上传当前任务目录中已有的按需 completion artifacts
  - quick task 允许只上传有效 `validation-summary.md`
  - quick task 缺少 `validation-summary.md` 或验证摘要只是占位内容时，在 binding/upload 之前 reject
- Skill/template 测试应保证 `suncode-hub-finish` 与自动绑定和按需 completion artifact 行为一致，并避免默认手动 `create-task` 指令。

### 7. Wrong vs Correct

#### Wrong

```ts
const spec = await submitSpec(options);
const completion = await submitCompletion(options);
return summarizeWorkflow("finish", [
  { name: "submit-spec", result: spec },
  { name: "submit-completion", result: completion },
]);
```

这会让 Hub pending task 在两个底层 submit step 都 skipped 时仍退出 0，即使 Hub 没有收到 completion artifacts。

#### Correct

```ts
if (!remoteTaskId && task.meta.requirementId) {
  const bind = await hubCreateTask(options);
  if (!remoteTaskIdAfterBind()) {
    throw new Error("Hub finish binding failed");
  }
}
```

这让高层 finish 命令负责可修复的绑定缺口，同时保留 local-only task 的显式 skip 行为。

## Scenario: Hub Requirement Task Type Routing

### 1. Scope / Trigger

- Trigger: Hub requirement intake/pull responses include a task route type:
  `quick`, `standard`, or `change`.
- Applies to `hub intake`, Hub task metadata parsing, `<hub-state>` prompt
  formatting, `hub plan-ready`, completion review gates, workflow templates,
  and Hub bundled skills.
- Missing task type is a backward-compatible `standard` task.

### 2. Signatures

Hub requirement fields accepted by intake:

```json
{
  "id": "REQ-1001",
  "taskType": "quick",
  "kind": "quick",
  "type": "standard",
  "requirementType": "change",
  "sourceTask": {
    "id": "TASK-OLD",
    "title": "Previous requirement",
    "summary": "Historical context only"
  }
}
```

Persisted local metadata:

```json
{
  "meta": {
    "hub": {
      "taskType": "quick",
      "rawTaskType": "hotfix",
      "sourceTask": {
        "id": "TASK-OLD",
        "title": "Previous requirement",
        "summary": "Historical context only"
      }
    }
  }
}
```

### 3. Contracts

- Normalize task type from `taskType`, then `kind`, then `type`, then
  `requirementType`.
- Valid values are exactly `quick`, `standard`, and `change`.
- Unknown values must fall back to `standard` while preserving the original
  value as `rawTaskType` for visibility.
- `sourceTask` is only persisted as a safe allowlisted summary:
  `id`, `remoteTaskId`, `localTaskId`, `localTaskPath`, `title`,
  `requirementId`, `requirementRevision`, `status`, `summary`, and
  `completedAt`.
- `sourceTask.summary` must come only from an explicit `summary` field. Do not
  treat `description` as a summary fallback, because it may contain full
  historical requirement text, signed URLs, or credentials.
- Do not persist tokens, auth headers, signed URLs, arbitrary nested payloads,
  or full historical documents from `sourceTask`.
- `standard` follows the existing full planning and review flow.
- `quick` keeps only minimal planning and still runs `hub plan-ready` to submit
  plan artifacts, including `prd.md`. For quick tasks, `hub plan-ready` must
  skip plan approval and Hub start preflight after the upload, and quick still
  skips Hub code review/check-agent review.
- Quick completion submission 仍然只处理 completion artifacts；不要把
  `prd.md` 移到 `submit-completion`，因为 PRD 是 plan artifact。
- Quick completion artifacts 按需生成，不要求四个候选文件齐全；但 quick
  必须有有效的 `validation-summary.md`。
- `quick` 仍需在可行时执行最小确定性验证。如果未执行检查，
  `validation-summary.md` 必须写明 `未执行` 和原因。
- `hub finish` must reject quick tasks before binding or upload when
  `validation-summary.md` is missing or only a placeholder. It must contain
  executed validation evidence, or `未执行` with a concrete reason.
- `hub review` must return `skipped` for quick tasks before checking provider
  availability, patching Hub status, writing `reviews/`, or submitting review
  artifacts.
- `change` follows the standard flow but intake writes source-task context into
  the PRD and `research/source-task.md`. The current requirement remains the
  authority; `sourceTask` is historical context only.
- `<hub-state>` must expose `task-type:quick` for quick Hub tasks, allow
  `plan-ready` as an upload-only step, and guard the AI away from Hub code
  `review`.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Task type missing | Persist `taskType: "standard"` and use normal flow |
| Task type unknown | Persist `taskType: "standard"` plus `rawTaskType`; do not fail intake |
| `quick` task calls `hub plan-ready` | Submit plan artifacts and any available structured subtasks, then skip Hub start preflight/plan approval without contacting the preflight endpoint |
| `quick` task calls `hub preflight-start` directly or through `task.py start` | Return/perform a local skip before contacting Hub, because quick tasks do not use the start preflight gate |
| `quick` task calls `hub review` | Return `skipped` before provider, status, or artifact side effects |
| `quick` task finishes while review is required | Bypass the review gate, but still upload existing completion artifacts |
| `quick` task finishes with missing or placeholder `validation-summary.md` | Throw before Hub binding or upload |
| `change` task includes `sourceTask` | Persist only the allowlisted summary and write `research/source-task.md` |
| `sourceTask` has `description` but no explicit `summary` | Persist other allowlisted fields, but do not synthesize `summary` |
| `sourceTask` contains secrets or signed URLs | Do not persist those fields |

### 5. Good/Base/Bad Cases

- Good: A quick task is claimed, started from the minimal PRD, validated with a
  short Chinese evidence trail in `validation-summary.md`, and finished through
  Hub so the needed completion artifact uploads.
- Good: A change task includes the old task summary in research while the PRD
  states the current Hub requirement is authoritative.
- Base: Older Hub responses without type continue as standard tasks.
- Bad: A quick task is marked done locally without `suncode hub finish`.
- Bad: `sourceTask` is treated as a second current requirement or copied
  wholesale into local files.

### 6. Tests Required

- Intake tests for default standard, quick, change with sourceTask, and unknown
  raw type fallback.
- Hub state prompt test for quick allowed/do-not actions.
- Plan-ready test proving quick tasks upload plan artifacts but skip Hub start
  preflight/plan approval.
- Preflight/start test proving quick tasks skip Hub start preflight before any
  Hub request, including the `task.py start` `before_start` hook path.
- Finish/completion test proving quick bypasses required review while still
  uploading existing completion artifacts.
- Finish tests proving quick missing or placeholder `validation-summary.md`
  rejects before binding or upload.
- Review test proving quick tasks skip provider checks, status patches,
  `reviews/` writes, and review submissions.
- Intake test proving `sourceTask.description` is not persisted as `summary`.
- Template/skill tests proving quick/change routing remains visible to agents.

## Scenario: Hub Spec 拉取

### 1. 范围 / 触发

- 触发：`suncode hub intake` 成功认领 Hub requirement 后，默认自动拉取项目权威 spec；项目显式配置 `hub.autoPullSpec: false` 时跳过这次自动拉取。恢复会话、用户要求手动刷新，或 intake/plan-ready 输出 spec 同步失败时也可手动运行 `suncode hub pull-spec`。
- 适用范围：`packages/cli/src/commands/hub/**`、生成的 `<hub-state>` hook、OpenCode plugin、以及 Hub 相关 bundled skill。
- Hub spec 同步是固定 CLI 流程。AI 只允许调度命令并读取结构化结果，不允许手工逐文件对比、合并、重写、删除或恢复 spec。

### 2. 命令与接口

CLI 命令：

```text
suncode hub pull-spec [--json]
suncode hub spec-deletions list [--json]
suncode hub spec-deletions keep --id <id> --as .suncode/spec/local/<name>.md
suncode hub spec-deletions discard --id <id>
```

Hub API：

```http
GET /api/v1/projects/{projectId}/specs/bundle
Authorization: Bearer <token>
```

推荐 Hub 响应：

```json
{
  "revision": "spec-rev-42",
  "etag": "\"sha256:bundle\"",
  "bundleHash": "sha256:bundle",
  "basePath": ".suncode/spec",
  "files": [
    {
      "path": "cli/backend/index.md",
      "sha256": "sha256:file",
      "size": 1234,
      "contentType": "text/markdown",
      "download": {
        "url": "https://minio.example.test/presigned/specs/proj_123/spec-rev-42/index.md",
        "method": "GET",
        "expiresAt": "2026-07-01T12:10:00+08:00"
      },
      "objectRef": {
        "provider": "minio",
        "bucket": "suncode-hub",
        "objectKey": "specs/proj_123/spec-rev-42/cli/backend/index.md"
      },
      "language": "zh-CN",
      "updatedAt": "2026-07-01T12:00:00+08:00"
    }
  ],
  "deleted": ["old/path.md"]
}
```

`download.url` can be either an external object-storage URL or a Hub system API
URL under the resolved `hub.apiBaseUrl`. When it is under the Hub API base URL,
the CLI must send the login session JWT as `Authorization: Bearer <token>`.
When it is an external object-storage URL, the CLI must not attach the Hub JWT
unless Hub explicitly includes an authorization header in `download.headers`.

### 3. 契约

Hub 是团队 spec 的权威来源。本地同步策略固定为 `remote_wins`：

| 条件 | 行为 |
| --- | --- |
| Hub 有、本地没有 | 写入 `.suncode/spec/**` |
| Hub 与本地内容不同 | 使用 Hub 内容覆盖本地 |
| Hub 删除了之前由 Hub 管理的 spec | 先保存删除候选，再删除本地权威路径 |
| 本地存在 Hub 从未管理过的 spec | 报告为 `localOnly`，不阻塞、不删除 |

项目同步 manifest：

```text
.suncode/.runtime/hub-specs.json
```

```json
{
  "version": 1,
  "projectId": "proj_123",
  "apiBaseUrl": "https://hub.example.test",
  "policy": "remote_wins",
  "revision": "spec-rev-42",
  "etag": "\"sha256:bundle\"",
  "bundleHash": "sha256:bundle",
  "syncedAt": "2026-07-01T12:00:00.000Z",
  "files": {
    ".suncode/spec/cli/backend/index.md": {
      "sha256": "sha256",
      "managedBy": "hub"
    }
  }
}
```

删除候选保存位置：

```text
.suncode/.runtime/hub-spec-deletions/<revision>/manifest.json
.suncode/.runtime/hub-spec-deletions/<revision>/<previous-spec-relative-path>
```

删除候选不是权威 spec，不能被当作普通 `.suncode/spec/**` 指导加载。它只用于用户显式要求时的可选复盘。

保留删除候选时，只能写入 `.suncode/spec/local/**` 作为本地补充，并添加说明：该文件不是 Hub 权威规范；如与 Hub spec 冲突，以 Hub spec 为准。命令必须拒绝把候选恢复到旧的 Hub-managed 路径。

### 4. 校验与错误矩阵

| 条件 | 行为 |
| --- | --- |
| Hub disabled | 返回 `disabled`，不访问网络 |
| 配置缺失、登录缺失或登录过期 | 与其他 Hub 命令一样抛出配置/鉴权错误 |
| 服务请求失败或超时 | fail closed，不更新 manifest |
| bundle path 是绝对路径、空路径或包含 `..` | 拒绝 bundle，不写文件 |
| 文件缺少 download URL，或下载文本 hash/size 不匹配 | 拒绝 bundle，不写文件 |
| `download.url` 属于 Hub 系统接口 | 使用 `suncode hub login` session JWT 发送 `Authorization: Bearer <token>` |
| `download.url` 属于外部对象存储域名 | 不自动发送 Hub JWT，避免把登录 token 泄露给对象存储 |
| Hub 更新或删除了本地改过的 Hub-managed spec | 执行 Hub 结果；删除前保存旧内容 |
| 存在 local-only spec | 报告它，不阻塞、不删除 |
| `spec-deletions keep` 目标不在 `.suncode/spec/local/**` | 抛出面向用户的错误 |
| `hub intake` 之后 spec 同步失败 | 保留本地任务和远程绑定，在 intake message 中报告 `spec sync FAILED` 和 `suncode hub pull-spec` 重试命令，不回滚、不阻塞规划 |
| `hub.autoPullSpec: false` 后运行 `hub intake` | 保留任务创建/绑定流程，不请求 `/specs/bundle`；message 提示自动拉取已禁用，可按需手动运行 `suncode hub pull-spec` |

### 5. 正例 / 基线 / 反例

- 正例：`pull-spec` 收到全量 bundle 后，覆盖过期的 Hub-managed 文件、删除远端已删除文件、写入删除候选，并更新 `.suncode/.runtime/hub-specs.json`。
- 正例：本地 `.suncode/spec/local/debugging.md` 被报告为 local-only，但不阻塞 Hub 任务继续。
- 正例：Hub 返回 `/api/v1/.../specs/files/...` 这类系统接口下载地址时，CLI 下载 spec 文件会带 `Authorization: Bearer <login-token>`。
- 正例：Hub 返回 MinIO/S3 预签名地址时，CLI 不会把 Hub login token 加到对象存储请求上。
- 正例：`pull-spec --json` 展示 revision、local-only 和 deletion candidates；
  `<hub-state>` 不展示 spec 摘要，只提示 Hub 是否可用于当前 workflow。
- 正例：`hub.autoPullSpec` 默认开启时，`hub intake` 成功绑定远程任务后自动执行一次 spec 同步；失败只写入可行动的重试提示，不让任务认领失效。
- 正例：项目配置 `hub.autoPullSpec: false` 时，`hub intake` 不请求 spec bundle，只提示可按需手动运行 `suncode hub pull-spec`。
- 基线：没有历史 spec manifest 时，第一次 bundle 写入所有远端文件，同时保留无关 local-only 文件。
- 反例：AI 手工 diff 每个 spec 文件并决定如何合并。
- 反例：被 Hub 删除的 Hub-managed spec 被恢复到旧路径，导致下一次 Hub 同步继续冲突。
- 反例：hook 在每次用户 prompt 都拉取全量 spec bundle。

### 6. 必测项

- `pull-spec` 命令测试：
  - 写入新的远端 spec。
  - 使用远端内容覆盖已变化的 Hub-managed spec。
  - 删除本地权威路径前，把被 Hub 删除的 Hub-managed spec 保存成 deletion candidate。
  - 报告 local-only spec，且不阻塞、不删除。
  - Hub 系统接口下载地址会带 login JWT。
  - 外部对象存储下载地址不会带 Hub JWT。
  - 配置/登录缺失、服务失败、非法路径、hash/size 不匹配时，不写成功 manifest。
- `spec-deletions` 命令测试：
  - `list` 返回 pending/kept/discarded 候选。
  - `keep` 只能写入 `.suncode/spec/local/**`。
  - `discard` 将候选标记为 discarded。
- Intake 集成测试：
  - `hub.autoPullSpec: false` 时，`hub intake` 不调用 spec bundle 接口，并提示可按需手动运行 `suncode hub pull-spec`。
- State/hook 测试：
  - `hub state --json` 不包含 spec 摘要。
  - `<hub-state>` 使用 `hub:*`、`workflow:primary`、`hub-task:*`、`work:*` 紧凑行，并通过 `Flow add-on:` 表达对 `<workflow-state>` 的补充关系。
  - hook 输出不包含 token、password、auth header、spec 摘要或 signed URL。
- Skill/template 测试：
  - `suncode-hub-spec-sync` 会被安装到各平台 skill root。
  - `suncode-hub-requirements` 说明 `hub intake` 默认自动同步 spec；如果 `hub.autoPullSpec: false`，intake 会跳过自动同步并提示可手动运行 `suncode hub pull-spec`。
  - `suncode-hub-spec-sync` 定位为恢复、手动刷新、同步失败重试，而不是每次规划前的默认步骤。

### 7. 错误与正确示例

#### 错误

```ts
for (const file of localSpecs) {
  const remote = await askAiWhetherToKeep(file);
  if (remote === "delete") fs.rmSync(file);
}
```

这会让 AI 变成同步引擎，破坏 Hub 审核人员作为权威来源的模型。

#### 正确

```ts
const result = await pullHubSpecs({ cwd, homeDir, fetch });
if (result.status !== "updated") {
  throw new Error("Hub specs are not available for this Hub task.");
}
```

这让同步保持确定、可审计，并由 CLI 负责。AI 只调度命令并遵循结构化结果。

## Scenario: Hub Skill And Agent Package Pull/Push

### 1. Scope / Trigger

- Trigger: CLI commands that upload local Suncode skill packages to Hub or
  download Hub skill packages into the project; same behavior for agent
  packages.
- Applies to `packages/cli/src/commands/hub/**` and Hub command tests.
- Skill/agent package sync is deterministic CLI behavior. It must not invoke
  AI, read task review state, or modify Trellis/Suncode workflow artifacts.

### 2. Signatures

CLI commands:

```text
suncode hub skill-push <skill-name>
suncode hub skill-pull <skill-name>
suncode hub agent-push <agent-name>
suncode hub agent-pull <agent-name>
```

Package API base path:

```text
{apiBaseUrl}/api/agent-hub
```

Skill package Hub APIs:

```http
POST /api/agent-hub/skill-packages/presign-upload
POST /api/agent-hub/skill-packages/finalize-upload
GET /api/agent-hub/projects/{project_key}/skill-packages
GET /api/agent-hub/skill-packages/{id}
GET /api/agent-hub/files/skill-package-files/{fileId}/download
```

Agent package Hub APIs:

```http
POST /api/agent-hub/agent-packs/presign-upload
POST /api/agent-hub/agent-packs/finalize-upload
GET /api/agent-hub/projects/{project_key}/agent-packs
GET /api/agent-hub/agent-packs/{id}
GET /api/agent-hub/files/agent-pack-files/{fileId}/download
```

Hub-managed upload target:

```http
PUT <presign.upload_url>
```

### 3. Contracts

Local package path:

```text
<cwd>/.agents/skills/<skill-name>/
<cwd>/.suncode/agents/<agent-name>.md
```

Required root file:

```text
<cwd>/.agents/skills/<skill-name>/SKILL.md
<cwd>/.suncode/agents/<agent-name>.md
```

Agent pack upload maps the local single markdown file to Hub package
`file_path: "AGENT.md"`, matching the current console/API main flow. The CLI
may read `.suncode/agents/<agent-name>/AGENT.md` as a compatibility fallback,
but the default generated Suncode agent layout is `.suncode/agents/<name>.md`.

Command defaults:

| Field | Value |
| --- | --- |
| `scope` | `project` |
| `project_key` | resolved project `hub.projectId` |
| auth source | existing `suncode hub login` session |
| content transfer | raw bytes / `Buffer` |

`skill-push` / `agent-push` request flow per file:

1. `POST /skill-packages/presign-upload` or
   `POST /agent-packs/presign-upload` with `skill_name` or `agent_name`,
   `project_key`, `scope`, `file_path`, `size`, and `content_type`.
2. `PUT presign.upload_url` with raw file bytes, presign response headers, and
   the Hub login `Authorization` header when `upload_url` is under the
   resolved Hub `/api/agent-hub/` base path.
3. `POST /skill-packages/finalize-upload` or
   `POST /agent-packs/finalize-upload` with `skill_name` or `agent_name`,
   `project_key`, `scope`, `file_path`, `upload_session_id`, `upload_id`, and
   `file_ref`.

`presign.object_key` is only a backward-compatible response field. New CLI
code must not require it, construct it, persist it, or send it back in finalize
requests. Hub resolves the trusted uploaded object from
`upload_session_id + upload_id + file_ref`.

`skill-pull` / `agent-pull` flow:

1. List packages for the resolved `project_key`.
2. Select the package with the requested name, preferring
   `scope === "project"` and matching `project_key` when the list has multiple
   same-name rows.
3. Fetch package detail and file metadata.
4. Download every file through the `/files/.../download` endpoint as bytes.
5. Write skill files under `.agents/skills/<skill-name>/`, overwriting
   same-name files without deleting unrelated local files.
6. Write agent packages as the current single-file markdown layout at
   `.suncode/agents/<agent-name>.md`.

Relative paths stored in Hub must use POSIX `/`. Pull must reject empty paths,
absolute paths, backslashes, `.` / `..` segments, and any path that escapes the
local package directory after normalization.

For the default single-file agent layout, pull must additionally reject
directory paths, multi-file packages, and non-markdown file names before writing
`.suncode/agents/<agent-name>.md`.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Hub disabled, missing config, missing login, or expired login | Same user-facing error behavior as other authenticated Hub commands |
| `<skill-name>` / `<agent-name>` is empty, `.`, `..`, or contains `/` or `\` | Reject before touching filesystem or Hub |
| Local skill package directory does not exist | `skill-push` throws a clear local package error |
| Local skill root `SKILL.md` missing or not a file | `skill-push` throws a clear root manifest error |
| Local agent markdown `.suncode/agents/<agent-name>.md` missing or not a file | `agent-push` throws a clear local agent markdown error |
| Local collected file is empty or exceeds the per-file limit | Reject that package before upload |
| Presign response misses `upload_url`, `upload_session_id`, `upload_id`, or `file_ref` | Throw before PUT/finalize so the CLI does not create an untrusted finalize payload |
| Presign or finalize returns non-2xx | Throw `HubHttpError`; do not hide the Hub status |
| Hub-managed `PUT` returns non-2xx | Throw an upload error without logging upload URLs or auth headers |
| Hub list has no matching package | pull command reports the package is missing |
| Hub list has multiple indistinguishable same-name packages | pull command reports ambiguity instead of guessing |
| Hub file path is empty, absolute, contains `..`, backslashes, or resolves outside package dir | Reject before writing any pulled file |

### 5. Good/Base/Bad Cases

- Good: `skill-push code-review` uploads `SKILL.md` and
  `references/rules.md` in deterministic order, finalizing with
  `upload_session_id`, `upload_id`, and `file_ref`.
- Good: `agent-push reviewer-agent` reads
  `.suncode/agents/reviewer-agent.md` and uploads it as Hub `AGENT.md` with
  `agent_name` payload fields while reusing the same package sync machinery.
- Good: `skill-pull code-review` overwrites existing
  `.agents/skills/code-review/SKILL.md` and writes nested reference files while
  preserving unrelated local files.
- Good: `agent-pull reviewer-agent` overwrites existing
  `.suncode/agents/reviewer-agent.md` and rejects traversal paths before
  writing anything outside the Suncode agent root.
- Base: A project with Hub enabled and a valid login can sync a project-scoped
  package without any active task.
- Bad: The implementation reuses the existing `/api/v1` Hub client for
  `/api/agent-hub` endpoints.
- Bad: Pull accepts `../escape.md` from Hub and writes outside
  `.agents/skills/<skill-name>/` or `.suncode/agents/`.
- Bad: Finalize sends only `object_key`, or the CLI prints/persists
  `Authorization` headers or Hub-managed upload URLs.

### 6. Tests Required

- Command registration test proving `hub skill-push`, `hub skill-pull`,
  `hub agent-push`, and `hub agent-pull` are registered under `suncode hub`.
- Push tests:
  - local `.agents/skills/<skill-name>/SKILL.md` and
    `.suncode/agents/<agent-name>.md` are required
  - request order is presign, Hub-managed `PUT`, finalize per file
  - presign payloads include `skill_name` or `agent_name`, `project_key`,
    `scope`, `file_path`, `size`, and `content_type`
  - finalize payloads include `upload_session_id`, `upload_id`, and `file_ref`
    from the presign response, and do not require `object_key`
  - Hub `/api/agent-hub` requests include login auth; upload `PUT` includes
    login auth only when the upload URL is under the Hub `/api/agent-hub/`
    base path
- Pull tests:
  - list, detail, and `/files/.../download` endpoints are called in order
  - same-name local files are overwritten
  - nested relative paths are written under the package directory
  - path traversal from Hub metadata is rejected before any outside write

### 7. Wrong vs Correct

#### Wrong

```ts
const client = createHubApiClient(config);
await client.requestJson(
  "POST",
  "/skill-packages/presign-upload",
  payload,
);
```

This accidentally routes the request through the existing `/api/v1` client,
which does not match the skill package API base path.

#### Correct

```ts
await requestAgentHubJson(
  config,
  "POST",
  "/skill-packages/presign-upload",
  payload,
);
```

This keeps `/api/agent-hub` isolated from the task/spec Hub client and avoids
changing existing Hub workflow behavior.

#### Wrong

```ts
await requestAgentHubJson(config, "POST", "/skill-packages/finalize-upload", {
  skill_name: skillName,
  file_path: file.relativePath,
  object_key: presign.presign.object_key,
});
```

This relies on a naked storage key that the v2 protocol treats as a
compatibility-only field.

#### Correct

```ts
await requestAgentHubJson(config, "POST", "/skill-packages/finalize-upload", {
  skill_name: skillName,
  file_path: file.relativePath,
  upload_session_id: presign.presign.upload_session_id,
  upload_id: presign.presign.upload_id,
  file_ref: presign.presign.file_ref,
});
```

This lets Hub resolve the trusted uploaded object from the upload session
instead of accepting a client-supplied storage key.

## Scenario: Hub Knowledge Search

### 1. Scope / Trigger

- Trigger: CLI commands that search project knowledge in Suncode Hub so AI or
  scripts can resolve unclear vocabulary, API contracts, or page contracts.
- Applies to `packages/cli/src/commands/hub/**` and Hub command tests.
- Knowledge search is deterministic CLI behavior. It must not invoke AI, mutate
  task state, rebuild indexes, or cache returned knowledge as runtime truth.

### 2. Signatures

CLI command:

```text
suncode hub knowledge <query...> [--top-k <n>]
```

Knowledge API base path:

```text
{apiBaseUrl}/api/agent-hub
```

Hub API:

```http
POST /api/agent-hub/projects/{project_key}/knowledge/vector-search
Authorization: Bearer <token>
Content-Type: application/json
```

Request body:

```json
{
  "query": "登录接口字段",
  "top_k": 3
}
```

### 3. Contracts

Command defaults and validation:

| Field | Contract |
| --- | --- |
| `project_key` | resolved project `hub.projectId` |
| `query` | `<query...>` joined with spaces and trimmed; must be non-empty |
| `top_k` | default `3`; valid integer range `1..20` |
| auth source | existing `suncode hub login` session |
| output | JSON by default for AI/script consumption |

Command output shape:

```json
{
  "query": "登录接口字段",
  "results": [
    {
      "title": "登录接口",
      "module": "auth",
      "endpointPath": "POST /api/auth/login",
      "snippet": "请求体包含 email 和 password。"
    }
  ]
}
```

The CLI output is intentionally compact for AI consumption. It must not expose
raw Hub `artifact` objects, score values, database ids, tag lists, `topK`, or
`projectKey` unless a later command explicitly needs those fields.

`/api/agent-hub` callers must use the shared agent-hub helper, not
`createHubApiClient()`, because the latter is scoped to `/api/v1` task/spec
workflows.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Hub disabled | Return a disabled result and do not contact Hub |
| Missing config, missing login, or expired login | Same user-facing error behavior as other authenticated Hub commands |
| `<query...>` is empty after trimming | Throw `Knowledge query is required.` before network |
| `--top-k` is missing | Use `3` |
| `--top-k` is non-integer or outside `1..20` | Throw `Knowledge top_k must be an integer between 1 and 20.` before network |
| Hub returns `{ "error": "..." }` | Surface that message through `HubHttpError` |
| Hub returns structured `{ error: { code, message, details } }` | Surface message/code/details through `HubHttpError` |
| Request times out | Throw an agent-hub timeout error for the `knowledge` service name |

### 5. Good/Base/Bad Cases

- Good: `suncode hub knowledge 登录接口字段` sends a single vector-search request
  with `{ query: "登录接口字段", top_k: 3 }` and prints compact JSON containing
  only the original `query` and AI-facing `results`.
- Good: `suncode hub knowledge 页面契约 --top-k 12` sends `top_k: 12`.
- Base: Hub is disabled locally; command returns disabled and does not perform
  network I/O.
- Bad: The command silently calls `/knowledge/qa/index` to rebuild an index
  before searching.
- Bad: The command rewrites or stores returned snippets into local spec/task
  files.
- Bad: The command uses `SUNCODE_HUB_TOKEN` or logs the login token.

### 6. Tests Required

- Command registration test proving `hub knowledge` is registered.
- Function-level command tests:
  - default `top_k = 3` request URL, method, body, and Authorization header
  - compact output removes raw Hub metadata while preserving title, module,
    endpoint path, and snippet
  - custom `topK` request body
  - empty query rejects before `fetch`
  - invalid `topK` rejects before `fetch`
  - Hub disabled returns disabled before `fetch`
- Existing skill package tests must still pass after extracting the shared
  `/api/agent-hub` helper.

### 7. Wrong vs Correct

#### Wrong

```ts
const client = createHubApiClient(config);
await client.requestJson(
  "POST",
  `/projects/${projectId}/knowledge/vector-search`,
  { query, top_k: topK },
);
```

This sends a knowledge endpoint through the `/api/v1` client and risks changing
task/spec Hub workflows to support an unrelated API family.

#### Correct

```ts
await requestAgentHubJson(
  config,
  "POST",
  `/projects/${projectKey}/knowledge/vector-search`,
  { query, top_k: topK },
  fetchImpl,
  "knowledge",
);
```

This keeps `/api/agent-hub` routing explicit and gives knowledge-specific
timeout/error messages without duplicating the agent-hub protocol code.

## Scenario: Hub Plan-Ready Orchestration And Debug Logging

### 1. Scope / Trigger

- Trigger: CLI code that prepares a Hub-bound planning task for start by running
  plan submission, structured subtask submission, and start preflight.
- Applies to `packages/cli/src/commands/hub/workflow.ts`,
  `index.ts`, `submissions.ts`, `lifecycle.ts`, `client.ts`, upload helpers,
  and Hub command tests.

### 2. Signatures

CLI command:

```text
suncode hub plan-ready [--task <task>] [--task-json <path>] [--force] [--confirm-unapproved-review] [--debug]
```

Debug environment:

```text
SUNCODE_HUB_DEBUG_PLAN_READY=1
SUNCODE_HUB_DEBUG_PLAN_READY=true
```

### 3. Contracts

- `plan-ready` owns the high-level sequence:
  `submit-plan -> submit-subtasks -> preflight-start`.
- Debug logging is opt-in only. It is enabled by `--debug` or
  `SUNCODE_HUB_DEBUG_PLAN_READY=1|true`.
- Debug logs must include the current plan-ready step, HTTP method, sanitized
  request URL, response status, and the step that failed.
- Debug logs must not include authorization headers, login tokens, raw request
  bodies, artifact contents, passwords, or signed URL query strings. URLs with
  query strings must redact the query as `?[redacted]`.
- When a network request throws before a response exists, debug mode should
  rethrow a user-facing error that includes the method and sanitized URL, e.g.:

```text
plan-ready request failed: POST https://hub.example.test/api/v1/.../preflight-start: fetch failed
```

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| `--debug` or `SUNCODE_HUB_DEBUG_PLAN_READY=1|true` | Print plan-ready step and request diagnostics |
| Debug disabled | Preserve normal concise command output; do not print request diagnostics |
| Request returns an HTTP response | Log `request <METHOD> <URL> -> HTTP <status>` |
| Request throws before response | Log the failing request and rethrow with method + sanitized URL |
| URL has query parameters | Log path plus `?[redacted]`, not the raw query string |
| Headers or body contain secrets | Do not log headers or bodies |

### 5. Good/Base/Bad Cases

- Good: `suncode hub plan-ready --task current --debug` shows that
  `preflight-start` failed while calling
  `/api/v1/projects/{projectId}/tasks/{remoteTaskId}/preflight-start`.
- Good: a signed upload URL is logged without its query string.
- Base: without `--debug`, `plan-ready` behaves exactly like the normal
  high-level command and only prints the final command result or top-level
  error.
- Bad: a generic `Error: fetch failed` gives no failing step or URL.
- Bad: debug logs print `Authorization`, JWTs, artifact contents, or signed URL
  query parameters.

### 6. Tests Required

- Function-level command test for `hubPlanReady` with debug enabled:
  - logs step start/success/failure lines
  - logs method and sanitized URL for preflight
  - rethrows a network failure with method and sanitized URL
- Existing plan-ready success and stop-before-preflight tests must continue to
  pass without debug logging requirements.

### 7. Wrong vs Correct

#### Wrong

```ts
console.error("fetch failed");
console.error(headers.authorization);
console.error(uploadUrl);
```

This hides the failing request context and leaks secrets or signed URL query
parameters.

#### Correct

```ts
logger(`[hub plan-ready] request POST ${sanitizeDebugUrl(url)}`);
throw new Error(`plan-ready request failed: POST ${sanitizeDebugUrl(url)}: ${message}`);
```

This gives enough context to debug routing and connectivity while keeping
credentials out of logs.

## Scenario: Structured Subtask Sync

### 1. Scope / Trigger

- Trigger: CLI commands, lifecycle hooks, or workflow templates that synchronize
  Suncode task state with Suncode Hub.
- Applies to `packages/cli/src/commands/hub/**` and generated
  `.suncode/scripts/common/config.py` Hub lifecycle hooks.
- Hub integration is optional. Disabled local projects must not contact Hub.

### 2. Signatures

CLI command:

```text
suncode hub submit-subtasks --task-json <path> [--force] [--best-effort]
suncode hub submit-subtasks --task <task> [--force] [--best-effort]
```

Lifecycle hook order for Hub team projects:

```text
after_start:
  suncode hub submit-subtasks --task-json "$TASK_JSON_PATH" --best-effort
  suncode hub mark-started --task-json "$TASK_JSON_PATH" --best-effort
```

Hub API:

```http
POST /api/v1/projects/{projectId}/tasks/{remoteTaskId}/subtasks
Idempotency-Key: hub:submit-subtasks:{remoteTaskId}:{subtasksHash}
```

### 3. Contracts

Local source, scoped to the target task directory only:

1. If `.suncode/tasks/<task>/subtasks.json` exists, treat it as the explicit
   override.
2. Otherwise derive structured subtasks from parseable checklist lines in
   `.suncode/tasks/<task>/implement.md`.

Every complex task `implement.md` must include this parseable checklist section:

```md
## 实施清单

- [ ] [P1] 子任务名称: 子任务说明
- [ ] [P2] 子任务名称: 子任务说明
```

Override file:

```text
.suncode/tasks/<task>/subtasks.json
```

Accepted JSON shape:

```json
{
  "version": 1,
  "subtasks": [
    {
      "priority": "P1",
      "name": "Implement API contract",
      "description": "Add the command/API changes needed for the reviewed task."
    }
  ]
}
```

Hub request body fields:

| Field | Contract |
| --- | --- |
| `developerId` | Hub developer identity from task metadata or config |
| `requirementId` | Optional Hub requirement correlation |
| `requirementRevision` | Optional local requirement revision |
| `localTaskId` | Current task directory basename |
| `localTaskPath` | POSIX repo-relative task path |
| `subtasksHash` | SHA-256 of canonical `{ version: 1, subtasks }` JSON |
| `subtasks` | Array of `{ priority, name, description }` |

Task manifest fields after success:

```json
{
  "lastSubtasksHash": "sha256",
  "lastSubtasksSubmissionId": "SUBTASKS-5001",
  "lastSubtasksRevision": 2
}
```

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Hub disabled | Return `disabled`; no network |
| Task has no remote Hub binding | Return `skipped`; no network |
| `subtasks.json` missing and `implement.md` has parseable checklist items | Derive subtasks from `implement.md` and submit |
| `subtasks.json` missing and `implement.md` has no parseable checklist items | Return `skipped`; no network |
| `subtasks` empty | Return `skipped`; no network |
| Entry missing `priority`, `name`, or `description` | Throw a user-facing error |
| `subtasksHash` equals `lastSubtasksHash` and not `--force` | Return `skipped`; no network |
| Hub returns non-2xx | Bubble `HubHttpError` to command handler |
| `--best-effort` set | Print warning and exit 0 from CLI wrapper |

### 5. Good/Base/Bad Cases

- Good: Current task has a `subtasks.json` override with two structured
  subtasks; command POSTs exactly those items and stores `lastSubtasksHash`.
- Good: Current task has no override but `implement.md` contains a parseable
  `## 实施清单` checklist; command derives and POSTs those items.
- Base: Local-only project has no Hub enabled; `after_start` does not add Hub
  hooks.
- Bad: Command scans `.suncode/tasks/**/subtasks.json` and uploads sibling task
  work.
- Bad: Command sends `prd.md`, `design.md`, or `implement.md` bodies in the
  subtask API payload.
- Bad: Workflow template asks for subtasks in prose or an ordered list that is
  not parseable as checklist items.

### 6. Tests Required

- Unit/function-level test for `submitSubtasks`:
  - uses the target task's `subtasks.json` override when present
  - generates structured subtasks from the target task's `implement.md`
    `## 实施清单` checklist when no override exists
  - rejects or ignores sibling task `subtasks.json`
  - sends `priority`, `name`, `description`, `subtasksHash`
  - stores `lastSubtasksHash`
  - skips unchanged hashes
- Integration test for generated `get_hooks("after_start")`:
  - Hub disabled returns no built-in Hub hook
  - Hub team enabled returns `submit-subtasks` before `mark-started`
- Template test:
  - workflow documents `subtasks.json`
  - planning breadcrumb requires the parseable `## 实施清单` checklist before
    start

### 7. Wrong vs Correct

#### Wrong

```ts
const files = globSync(".suncode/tasks/**/subtasks.json");
await client.requestJson("POST", "/subtasks", { subtasks: files.map(readJson) });
```

This uploads unrelated task state and has no clear Hub task ownership.

#### Correct

```ts
const task = readHubTask(taskJsonPath, cwd);
const filePath = path.join(task.taskDir, "subtasks.json");
const subtasks = readStructuredSubtasks(task.taskDir);
await client.requestJson(
  "POST",
  `/projects/${projectId}/tasks/${remoteTaskId}/subtasks`,
  { localTaskId: task.localTaskId, localTaskPath: task.localTaskPath, subtasks },
  `hub:submit-subtasks:${remoteTaskId}:${subtasksHash}`,
);
```

This keeps ownership anchored to one resolved local task and makes retries
idempotent.

## Scenario: Hub Review Round and Idempotency State

### 1. Scope / Trigger

- Trigger: CLI code that creates Hub review rounds, patches Hub task review
  status, submits review artifacts, or computes review idempotency keys.
- Applies to `packages/cli/src/commands/hub/review.ts`,
  `lifecycle.ts`, `submissions.ts`, `manifest.ts`, and review tests.

### 2. Signatures

CLI command:

```text
suncode hub review [--task <task>] [--task-json <path>] [--provider engineer]
suncode hub pull-review [--task <task>] [--task-json <path>] [--cursor <cursor>]
```

Hub writes:

```http
PATCH /api/v1/projects/{projectId}/tasks/{remoteTaskId}/status
POST /api/v1/projects/{projectId}/tasks/{remoteTaskId}/review-submissions
```

### 3. Contracts

- Review round selection must use both durable manifest state and local artifact
  directories:
  `max(nextReviewRoundFromFiles(taskDir), (manifest.lastReviewRound ?? 0) + 1)`.
- Local `reviews/round-NNN/` directories are artifacts, not the only source of
  review history. Deleting them must not make the CLI reuse a previously
  submitted round number when `hub-manifest.json` still records that round.
- Review submission idempotency keys must use the review summary round that is
  sent in the payload:
  `hub:submit-review:{remoteTaskId}:{review.round}:{reviewBundleHash}`.
- Hub code review prompt must not include a `Review Boundary` section or a
  changed-file list derived from `git diff --name-only`; those lists can grow
  without useful prioritization and waste provider context. The prompt must
  also avoid embedding task document bodies, previous review JSON, or diff
  contents. It should stay lightweight: describe the current review task, list
  task/requirement file paths to inspect, constrain provider behavior to
  task-relevant implementation review, and let the provider read task files,
  related module code, and any directory-level code area hints.
- Hub code review prompt is an implementation review prompt: it checks whether
  the code implementation satisfies the requirement, design, and implementation
  plan. It must not ask the provider to review the plan itself as the primary
  artifact.
- Hub code review prompt must emphasize requirement-level and logic-level
  review rather than low-level validation re-runs. The expected focus includes
  functional completeness, logic correctness, boundary cases, data/API
  contracts, user-visible behavior, security/side effects, and maintainability.
- Hub code review prompt must not ask the provider to run build, tests, lint,
  format, dependency install, code generation, or other validation commands.
  Existing validation artifacts may be read as background only.
- Hub code review prompt may include directory-level code area hints derived
  from git changes. These hints must be directories/modules only, capped to a
  small number, and must not disclose a concrete changed-file list.
- Hub code review prompt must tell the provider to return a single fenced JSON
  block with the fixed parseable fields `status`, `summary`, `mustFix`,
  `advisory`, `mustFixCount`, and `advisoryCount`. Descriptive fields should be
  Chinese. The prompt must explain that the CLI renders that JSON into
  `reviews/round-NNN/result.md`; the provider must not edit `result.md`
  directly.
- Hub code review prompt must not include a parseable fenced JSON example,
  because providers may echo the prompt and the parser must not mistake a
  prompt example for the final review result.
- Hub review parsing must prefer the final fenced `json` block in provider
  output, so provider banners, echoed examples, and token-usage footers do not
  override the actual result.
- The engineer review provider must set a larger `spawnSync` output buffer than
  Node's default 1 MiB so verbose provider transcripts do not get truncated
  before the final JSON block.
- Review result normalization must preserve provider-selected findings instead
  of dropping findings solely because their file path is outside a local
  changed-file list.
- Review artifact upload must include only `reviews/round-NNN/prompt.md` and
  `reviews/round-NNN/result.md`. Local `review.json`, `diff.patch`, and
  `raw-output.md` remain local diagnostics/state files and must not be uploaded
  to Hub as artifacts.
- Hub task status patches from `suncode hub review` are lifecycle-state patches,
  not review-result patches. Entering review always patches `in_review`. After
  the provider result and review artifact submission, `approved` patches
  `in_review` again, while `changes_requested` and `blocked` patch
  `in_progress` so the task returns to implementation work.
- Review result status remains preserved separately in `review.json`, the
  review submission payload, and `hub-manifest.json.lastReviewStatus`.
- Status patch payloads include `updatedAt`, so the status idempotency key must
  include a payload discriminator:
  `hub:review-status:{remoteTaskId}:{status}:{payloadHash}`.
- `payloadHash` must be derived from the exact status body passed to
  `requestJson`; otherwise the same key can be reused with a different body.
- `suncode hub review` is the post-implementation code review workflow. It
  must not be described in workflow prompts or bundled skill descriptions as
  the command for checking plan approval, plan comments, or start-review state.
- Plan-stage Hub comments/status after `suncode hub plan-ready` are read with
  `suncode hub pull-review --task current`. Hub-bound prompt allowed-actions
  should expose `plan-ready pull-review finish`, not a bare `review` action that
  can be confused with the code-review provider flow.
- The `suncode-hub-review` skill must treat actively interrupting an in-progress
  review as a red-line violation. Review provider runs own their configured
  timeout; agents must wait for `suncode hub review` to finish or fail by that
  timeout, not send Ctrl-C, kill the process, wrap it in a shorter external
  timeout, issue channel interrupts, or start a replacement review because the
  current one is slow.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| AI needs plan approval/comments after `plan-ready` | Use `pull-review`; do not trigger the code review provider |
| Provider reports findings for files outside the local diff | Preserve the provider-selected findings in `result.md`, `review.json`, and review submission metadata |
| Previous review artifacts were deleted but `hub-manifest.json` has `lastReviewRound = 1` | Next review is round 2 |
| Same task enters `in_review` again in a later review run | Status patch uses a different idempotency key because `updatedAt` changed |
| Review summary missing when submitting review artifacts | Throw `Review submission requires a review summary.` |
| Review submission key round and payload `review.round` disagree | Bug; add/keep a regression test before changing the key logic |
| Provider prints banners/examples before final JSON | Parse the final fenced `json` block |
| Provider output includes `tokens used` after final JSON | Ignore the footer and parse the fenced JSON |
| Provider transcript exceeds Node's default spawn buffer | Preserve output up to the configured large provider buffer and parse the final JSON if present |
| `suncode hub review` is slow but still running | Do not interrupt it; wait for the command's own timeout or final result |
| Review provider returns `changes_requested` or `blocked` | Submit the review result, then patch Hub task status back to `in_progress` |
| Review provider returns `approved` | Submit the review result, then keep Hub task status as `in_review` |
| `hub-manifest.json` is also deleted | CLI cannot infer remote review history locally; Hub may still reject reused server-side keys |

### 5. Good/Base/Bad Cases

- Good: User deletes `reviews/round-001/` after a successful review, reruns
  `suncode hub review`, and the CLI submits `review.round = 2` with a
  `hub:submit-review:*:2:*` key.
- Good: Two separate review runs patch `in_review`; both use distinct
  idempotency keys because their payloads have distinct `updatedAt` values.
- Good: A review with must-fix findings patches `in_review` on entry and
  `in_progress` after the review result is submitted.
- Good: An approved review patches `in_review` on entry and `in_review` again
  after the review result is submitted.
- Good: Provider prompt is an entry-point document: it lists the task directory,
  task/review files, and a capped directory-level code area hint; it does not
  embed PRD/design/implement bodies, concrete changed-file lists, or diff
  contents, and result files preserve the provider-selected findings.
- Good: After `plan-ready`, workflow text tells the AI to inspect Hub plan
  comments/status with `suncode hub pull-review --task current`.
- Base: Fresh Hub-bound task with no manifest and no review artifacts starts at
  round 1.
- Bad: `<hub-state>` or a bundled skill exposes a bare `review` action during
  planning, causing the AI to call `suncode hub review` instead of
  `pull-review`.
- Bad: Round calculation scans only `reviews/` and ignores
  `manifest.lastReviewRound`.
- Bad: Status patch key is only `hub:review-status:{remoteTaskId}:{status}`
  while the body still includes `updatedAt`.
- Bad: The CLI expands an unbounded changed-file list into the provider prompt
  or filters provider findings only by local changed-file membership.
- Bad: The CLI embeds full task documents, previous review JSON, or large diff
  contents into `prompt.md`, causing the provider's first context to balloon.
- Bad: The review prompt asks the provider to review the PRD/design/plan itself
  rather than reviewing the code implementation against those files.
- Bad: An agent decides a slow `suncode hub review` is taking too long and
  actively interrupts, kills, externally times out, or replaces that review
  instead of waiting for the configured provider timeout.

### 6. Tests Required

- Regression test for rerunning `hubReview` after deleting local `reviews/`:
  - first submission body has `review.round = 1`
  - second submission body has `review.round = 2`
  - submission idempotency keys contain matching round numbers
  - all status patch idempotency keys are unique across the two runs
- Status transition tests:
  - `changes_requested` / `blocked` review result patches
    `in_review -> in_progress`
  - `approved` review result patches `in_review -> in_review`
  - review submission payload and local manifest still preserve the actual
    review result status
- Existing review artifact tests must still prove only the target round is
  uploaded, and only `prompt.md` / `result.md` are included in the upload
  session.
- Existing completion-gate tests must still prove approved reviews bind to the
  current diff/head.
- Hub state prompt tests must prove Hub-bound allowed actions mention
  `pull-review` for Hub comments/status and do not expose the old
  `submit-plan review` sequence.
- Review prompt scope regression test:
  - provider prompt does not contain a `Review Boundary` section
  - provider prompt does not contain a `Changed Files` list
  - provider prompt lists task files but does not embed task document bodies or
    diff contents
  - provider prompt may include directory-level code area hints without listing
    concrete changed file paths
  - provider prompt explains JSON-only output, Chinese descriptive fields, and
    CLI-rendered `result.md`
  - provider prompt does not contain a parseable fenced JSON example
  - provider parser uses the final fenced JSON block when earlier examples are
    present
  - provider output larger than Node's default spawn buffer still preserves and
    parses the final JSON block
  - provider-selected findings are preserved in `result.md` and `review.json`
- Bundled `suncode-hub-review` skill test:
  - skill content explicitly marks manual interruption of an in-progress review
    as a red-line violation
  - skill content explains that the configured provider timeout is the only
    normal timeout mechanism

### 7. Wrong vs Correct

#### Wrong

```ts
const round = nextReviewRound(task.taskDir);
const statusKey = ["hub:review-status", remoteTaskId, status].join(":");
```

This makes local artifact deletion reset the round counter and reuses the same
status key with a different `updatedAt` body.

#### Correct

```ts
const round = Math.max(
  nextReviewRound(task.taskDir),
  (manifest.lastReviewRound ?? 0) + 1,
);
const statusKey = [
  "hub:review-status",
  remoteTaskId,
  status,
  hashText(JSON.stringify(payload)).slice(0, 16),
].join(":");
```

This treats the manifest as durable review history and keeps idempotency keys
aligned with the payload actually sent to Hub.
