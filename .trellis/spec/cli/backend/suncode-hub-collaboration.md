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
suncode hub init [--api-base-url <url>] [--project-api-base-url <url>] --project-id <id> [--developer-id <id>] [--start-review-policy confirm|auto] [--yes]
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

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Hub disabled or missing config | Report `hub off`; no network |
| Project enabled but no `apiBaseUrl` from project or global config | Report config error; no network |
| Login session missing for resolved `apiBaseUrl` | Ask user to run `suncode hub login`; no network |
| Login session expired | Report expired login; no network |
| Service health check fails | Report Hub unavailable; do not enter Hub workflows |
| Service ok and work available | Report available work and suggest `suncode hub pull` / task selection |
| Active task has Hub metadata | Allow Hub task lifecycle commands for that task |
| Active task has no Hub metadata | Report local-only; do not run Hub submit/mark commands |
| `SUNCODE_HUB_TOKEN` is set | Ignore it; behavior depends only on login session |

### 5. Good/Base/Bad Cases

- Good: Two projects resolve to the same normalized Hub base URL and reuse one
  global login session while keeping separate `.suncode/.runtime/hub-state.json`
  files.
- Good: `hub state` writes available-work counts and current-task classification
  without caching credentials.
- Base: Local-only project has no Hub config; hook emits `hub off` and tells the
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
- Task-name and language tests:
  - `task.py create` keeps `task.json.id` as the slug and writes Chinese
    `name` / `title`
  - the generated PRD uses Chinese headings and states Simplified Chinese is
    preferred
  - `hub create-task` sends Chinese `localTaskName` / `title` while retaining
    slug-based `localTaskId`

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

Local file, scoped to the target task directory only:

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
| `subtasks.json` missing | Return `skipped`; no network |
| `subtasks` empty | Return `skipped`; no network |
| Entry missing `priority`, `name`, or `description` | Throw a user-facing error |
| `subtasksHash` equals `lastSubtasksHash` and not `--force` | Return `skipped`; no network |
| Hub returns non-2xx | Bubble `HubHttpError` to command handler |
| `--best-effort` set | Print warning and exit 0 from CLI wrapper |

### 5. Good/Base/Bad Cases

- Good: Current task has two structured subtasks; command POSTs exactly those
  items and stores `lastSubtasksHash`.
- Base: Local-only project has no Hub enabled; `after_start` does not add Hub
  hooks.
- Bad: Command scans `.suncode/tasks/**/subtasks.json` and uploads sibling task
  work.
- Bad: Command sends `prd.md`, `design.md`, or `implement.md` bodies in the
  subtask API payload.

### 6. Tests Required

- Unit/function-level test for `submitSubtasks`:
  - reads only the target task's `subtasks.json`
  - rejects or ignores sibling task `subtasks.json`
  - sends `priority`, `name`, `description`, `subtasksHash`
  - stores `lastSubtasksHash`
  - skips unchanged hashes
- Integration test for generated `get_hooks("after_start")`:
  - Hub disabled returns no built-in Hub hook
  - Hub team enabled returns `submit-subtasks` before `mark-started`
- Template test:
  - workflow documents `subtasks.json`
  - planning breadcrumb reminds Hub projects to create it before start

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
