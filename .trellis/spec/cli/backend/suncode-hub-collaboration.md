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

## Scenario: Hub Spec 拉取

### 1. 范围 / 触发

- 触发：Hub 任务规划或实现前，需要通过 CLI、生命周期 hook、工作流模板或 bundled skill 拉取 Hub 上的项目权威 spec。
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
| 文件缺少 MinIO download URL，或下载文本 hash/size 不匹配 | 拒绝 bundle，不写文件 |
| Hub 更新或删除了本地改过的 Hub-managed spec | 执行 Hub 结果；删除前保存旧内容 |
| 存在 local-only spec | 报告它，不阻塞、不删除 |
| `spec-deletions keep` 目标不在 `.suncode/spec/local/**` | 抛出面向用户的错误 |

### 5. 正例 / 基线 / 反例

- 正例：`pull-spec` 收到全量 bundle 后，覆盖过期的 Hub-managed 文件、删除远端已删除文件、写入删除候选，并更新 `.suncode/.runtime/hub-specs.json`。
- 正例：本地 `.suncode/spec/local/debugging.md` 被报告为 local-only，但不阻塞 Hub 任务继续。
- 正例：`pull-spec --json` 展示 revision、local-only 和 deletion candidates；
  `<hub-state>` 不展示 spec 摘要，只提示 Hub 是否可用于当前 workflow。
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
  - 配置/登录缺失、服务失败、非法路径、hash/size 不匹配时，不写成功 manifest。
- `spec-deletions` 命令测试：
  - `list` 返回 pending/kept/discarded 候选。
  - `keep` 只能写入 `.suncode/spec/local/**`。
  - `discard` 将候选标记为 discarded。
- State/hook 测试：
  - `hub state --json` 不包含 spec 摘要。
  - `<hub-state>` 使用 `hub:*`、`workflow:primary`、`hub-task:*`、`work:*` 紧凑行，并通过 `Flow add-on:` 表达对 `<workflow-state>` 的补充关系。
  - hook 输出不包含 token、password、auth header、spec 摘要或 signed URL。
- Skill/template 测试：
  - `suncode-hub-spec-sync` 会被安装到各平台 skill root。
  - `suncode-hub-requirements` 在写规划 artifact 前触发 spec sync。

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

## Scenario: Hub Skill Package Pull/Push

### 1. Scope / Trigger

- Trigger: CLI commands that upload local Suncode skill packages to Hub or
  download Hub skill packages into the project.
- Applies to `packages/cli/src/commands/hub/**` and Hub command tests.
- Skill package sync is deterministic CLI behavior. It must not invoke AI, read
  task review state, or modify Trellis/Suncode workflow artifacts.

### 2. Signatures

CLI commands:

```text
suncode hub skill-push <skill-name>
suncode hub skill-pull <skill-name>
```

Skill package API base path:

```text
{apiBaseUrl}/api/agent-hub
```

Hub JSON APIs:

```http
POST /api/agent-hub/skill-packages/presign-upload
POST /api/agent-hub/skill-packages/finalize-upload
GET /api/agent-hub/projects/{project_key}/skill-packages
GET /api/agent-hub/skill-packages/{id}
GET /api/agent-hub/skill-package-files/{fileId}/content
```

Object storage upload:

```http
PUT <presign.upload_url>
```

### 3. Contracts

Local package path:

```text
<cwd>/.agents/skills/<skill-name>/
```

Required root file:

```text
<cwd>/.agents/skills/<skill-name>/SKILL.md
```

Command defaults:

| Field | Value |
| --- | --- |
| `scope` | `project` |
| `project_key` | resolved project `hub.projectId` |
| auth source | existing `suncode hub login` session |
| content transfer | raw bytes / `Buffer` |

`skill-push` request flow per file:

1. `POST /skill-packages/presign-upload` with `skill_name`,
   `project_key`, `scope`, `file_path`, `file_size`, and `content_type`.
2. `PUT presign.upload_url` with raw file bytes and presign response headers.
3. `POST /skill-packages/finalize-upload` with `skill_name`,
   `project_key`, `scope`, `file_path`, `file_size`, `content_type`,
   `object_key`, and optional checksum metadata.

`skill-pull` flow:

1. List packages for the resolved `project_key`.
2. Select the package with `name === <skill-name>`, preferring
   `scope === "project"` and matching `project_key` when the list has multiple
   same-name rows.
3. Fetch package detail and file metadata.
4. Download every file content endpoint as bytes.
5. Write each file under `.agents/skills/<skill-name>/`, overwriting same-name
   files without deleting unrelated local files.

Relative paths stored in Hub must use POSIX `/`. Pull must reject empty paths,
absolute paths, and any path that escapes the local skill directory after
normalization.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Hub disabled, missing config, missing login, or expired login | Same user-facing error behavior as other authenticated Hub commands |
| `<skill-name>` is empty, `.`, `..`, or contains `/` or `\` | Reject before touching filesystem or Hub |
| Local skill directory does not exist | `skill-push` throws a clear local package error |
| Local root `SKILL.md` missing or not a file | `skill-push` throws a clear root manifest error |
| Local collected file is empty or exceeds the per-file limit | Reject that package before upload |
| Presign or finalize returns non-2xx | Throw `HubHttpError`; do not hide the Hub status |
| Object storage `PUT` returns non-2xx | Throw an upload error without logging signed URL secrets |
| Hub list has no matching package | `skill-pull` reports the package is missing |
| Hub list has multiple indistinguishable same-name packages | `skill-pull` reports ambiguity instead of guessing |
| Hub file path is empty, absolute, contains `..`, or resolves outside package dir | Reject before writing any pulled file |

### 5. Good/Base/Bad Cases

- Good: `skill-push code-review` uploads `SKILL.md` and
  `references/rules.md` in deterministic order, using Hub auth only for
  `/api/agent-hub` requests and not for object storage `PUT`.
- Good: `skill-pull code-review` overwrites existing
  `.agents/skills/code-review/SKILL.md` and writes nested reference files while
  preserving unrelated local files.
- Base: A project with Hub enabled and a valid login can sync a project-scoped
  skill package without any active task.
- Bad: The implementation reuses the existing `/api/v1` Hub client for
  `/api/agent-hub` endpoints.
- Bad: Pull accepts `../escape.md` from Hub and writes outside
  `.agents/skills/<skill-name>/`.
- Bad: The CLI prints or persists `Authorization` headers or presigned upload
  URLs.

### 6. Tests Required

- Command registration test proving `hub skill-push` and `hub skill-pull` are
  registered under `suncode hub`.
- Push tests:
  - local `.agents/skills/<skill-name>/SKILL.md` is required
  - request order is presign, object storage `PUT`, finalize per file
  - presign/finalize payloads include `skill_name`, `project_key`, `scope`,
    `file_path`, `file_size`, and `content_type`
  - Hub requests include login auth; object storage `PUT` does not include Hub
    Authorization unless the presign response explicitly asks for headers
- Pull tests:
  - list, detail, and content endpoints are called in order
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
  "top_k": 5
}
```

### 3. Contracts

Command defaults and validation:

| Field | Contract |
| --- | --- |
| `project_key` | resolved project `hub.projectId` |
| `query` | `<query...>` joined with spaces and trimmed; must be non-empty |
| `top_k` | default `5`; valid integer range `1..20` |
| auth source | existing `suncode hub login` session |
| output | JSON by default for AI/script consumption |

Command output shape:

```json
{
  "projectKey": "proj_123",
  "query": "登录接口字段",
  "topK": 5,
  "count": 1,
  "artifacts": [
    {
      "artifact": {
        "id": 12,
        "title": "登录接口",
        "side": "backend",
        "module": "auth",
        "endpoint_path": "POST /api/auth/login",
        "tags": ["登录", "鉴权"]
      },
      "score": 0.9125,
      "snippet": "请求体包含 email 和 password。"
    }
  ]
}
```

`/api/agent-hub` callers must use the shared agent-hub helper, not
`createHubApiClient()`, because the latter is scoped to `/api/v1` task/spec
workflows.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Hub disabled | Return a disabled result and do not contact Hub |
| Missing config, missing login, or expired login | Same user-facing error behavior as other authenticated Hub commands |
| `<query...>` is empty after trimming | Throw `Knowledge query is required.` before network |
| `--top-k` is missing | Use `5` |
| `--top-k` is non-integer or outside `1..20` | Throw `Knowledge top_k must be an integer between 1 and 20.` before network |
| Hub returns `{ "error": "..." }` | Surface that message through `HubHttpError` |
| Hub returns structured `{ error: { code, message, details } }` | Surface message/code/details through `HubHttpError` |
| Request times out | Throw an agent-hub timeout error for the `knowledge` service name |

### 5. Good/Base/Bad Cases

- Good: `suncode hub knowledge 登录接口字段` sends a single vector-search request
  with `{ query: "登录接口字段", top_k: 5 }` and prints JSON containing
  `projectKey`, `query`, `topK`, `count`, and `artifacts`.
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
  - default `top_k = 5` request URL, method, body, and Authorization header
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
- Status patch payloads include `updatedAt`, so the status idempotency key must
  include a payload discriminator:
  `hub:review-status:{remoteTaskId}:{status}:{payloadHash}`.
- `payloadHash` must be derived from the exact status body passed to
  `requestJson`; otherwise the same key can be reused with a different body.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Previous review artifacts were deleted but `hub-manifest.json` has `lastReviewRound = 1` | Next review is round 2 |
| Same task enters `in_review` again in a later review run | Status patch uses a different idempotency key because `updatedAt` changed |
| Review summary missing when submitting review artifacts | Throw `Review submission requires a review summary.` |
| Review submission key round and payload `review.round` disagree | Bug; add/keep a regression test before changing the key logic |
| `hub-manifest.json` is also deleted | CLI cannot infer remote review history locally; Hub may still reject reused server-side keys |

### 5. Good/Base/Bad Cases

- Good: User deletes `reviews/round-001/` after a successful review, reruns
  `suncode hub review`, and the CLI submits `review.round = 2` with a
  `hub:submit-review:*:2:*` key.
- Good: Two separate review runs patch `in_review`; both use distinct
  idempotency keys because their payloads have distinct `updatedAt` values.
- Base: Fresh Hub-bound task with no manifest and no review artifacts starts at
  round 1.
- Bad: Round calculation scans only `reviews/` and ignores
  `manifest.lastReviewRound`.
- Bad: Status patch key is only `hub:review-status:{remoteTaskId}:{status}`
  while the body still includes `updatedAt`.

### 6. Tests Required

- Regression test for rerunning `hubReview` after deleting local `reviews/`:
  - first submission body has `review.round = 1`
  - second submission body has `review.round = 2`
  - submission idempotency keys contain matching round numbers
  - all status patch idempotency keys are unique across the two runs
- Existing review artifact tests must still prove only the target round is
  uploaded.
- Existing completion-gate tests must still prove approved reviews bind to the
  current diff/head.

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
