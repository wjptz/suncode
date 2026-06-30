# Suncode Hub Collaboration

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
