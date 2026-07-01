/* global process */
/**
 * Suncode Workflow State Injection Plugin
 *
 * Per-turn UserPromptSubmit equivalent for OpenCode.
 *
 * On every chat.message, if a Suncode task is active, inject a short
 * <workflow-state> breadcrumb reminding the main AI what task is
 * active and its expected flow. Breadcrumb text is pulled exclusively
 * from the project's workflow.md [workflow-state:STATUS] tag blocks —
 * workflow.md is the single source of truth. There are no fallback
 * tables in this plugin: when workflow.md is missing or a tag is
 * absent, the breadcrumb degrades to a generic
 * "Refer to workflow.md for current step." line so users see (and fix)
 * the broken state instead of the plugin silently masking it.
 *
 * Unlike session-start, this plugin does NOT dedupe — the breadcrumb
 * should surface on every turn so long conversations don't drift.
 *
 * Silently skips when:
 *   - No .suncode/ directory
 *   - No active task in the session runtime context
 *   - task.json malformed or missing status
 */

import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { spawnSync } from "child_process"
import { SuncodeContext, debugLog, isSuncodeSubagent } from "../lib/suncode-context.js"

// Supports STATUS values with letters, digits, underscores, hyphens
// (so "in-review" / "blocked-by-team" work alongside "in_progress").
const TAG_RE = /\[workflow-state:([A-Za-z0-9_-]+)\]\s*\n([\s\S]*?)\n\s*\[\/workflow-state:\1\]/g

/**
 * Parse workflow.md for [workflow-state:STATUS] blocks.
 *
 * Returns {status: body}. workflow.md is the single source of truth —
 * there are no fallback tables here. Missing tags (or a missing /
 * unreadable workflow.md) fall back to a generic line in
 * buildBreadcrumb so users see the broken state and fix workflow.md
 * rather than the plugin silently masking it.
 */
function loadBreadcrumbs(directory) {
  const workflowPath = join(directory, ".suncode", "workflow.md")
  if (!existsSync(workflowPath)) return {}
  let content
  try {
    content = readFileSync(workflowPath, "utf-8")
  } catch {
    return {}
  }
  const result = {}
  for (const match of content.matchAll(TAG_RE)) {
    const status = match[1]
    const body = match[2].trim()
    if (body) result[status] = body
  }
  return result
}

/**
 * Get (taskId, status) from active task, or null if no active task.
 */
function getActiveTask(ctx, platformInput = null) {
  const active = ctx.getActiveTask(platformInput)
  const taskRef = active.taskPath
  if (!taskRef) return null
  const taskDir = ctx.resolveTaskDir(taskRef)
  if (active.stale || !taskDir || !existsSync(taskDir)) {
    return { id: taskRef.split("/").pop(), status: "stale", source: active.source }
  }
  const taskJsonPath = join(taskDir, "task.json")
  if (!existsSync(taskJsonPath)) return null
  try {
    const data = JSON.parse(readFileSync(taskJsonPath, "utf-8"))
    const status = typeof data.status === "string" ? data.status : ""
    if (!status) return null
    const id = data.id || taskRef.split("/").pop()
    return { id, status, source: active.source }
  } catch {
    return null
  }
}

/**
 * Build the <workflow-state>...</workflow-state> block.
 * - Known status (tag present in workflow.md) → detailed body
 * - Unknown status (no tag, or workflow.md missing) → generic
 *   "Refer to workflow.md for current step." line
 * - no_task pseudo-status (id === null) → header omits task info
 */
function buildBreadcrumb(id, status, templates) {
  let body = templates[status]
  if (body === undefined) {
    body = "Refer to workflow.md for current step."
  }
  let header = id === null ? `Status: ${status}` : `Task: ${id} (${status})`
  return `<workflow-state>\n${header}\n${body}\n</workflow-state>`
}

function buildHubState(ctx, input = null) {
  const config = readSuncodeConfig(ctx.directory)
  const currentTask = getCurrentHubTaskState(ctx, input)
  const hub = config && typeof config === "object" ? config.hub : null
  if (!hub || typeof hub !== "object" || hub.enabled !== true) {
    return [
      "<hub-state>",
      "Hub: off",
      "Reason: hub.enabled is not true or .suncode/config.yaml is missing",
      `Current task: ${currentTask}`,
      "AI: use the local Suncode workflow; do not run Hub-specific commands.",
      "</hub-state>",
    ].join("\n")
  }

  const projectId = stringValue(hub.projectId)
  if (!projectId) {
    return hubStateBlock([
      "Hub: on",
      "Config: invalid (hub.projectId missing)",
      `Current task: ${currentTask}`,
      "AI: ask the user to run `suncode hub init` before using Hub workflows.",
    ])
  }

  const apiBaseUrl =
    normalizeApiBaseUrl(stringValue(hub.apiBaseUrl)) || globalApiBaseUrl()
  if (!apiBaseUrl) {
    return hubStateBlock([
      "Hub: on",
      `Project: ${projectId}`,
      "Config: missing global apiBaseUrl",
      `Current task: ${currentTask}`,
      "AI: ask the user to run `suncode hub init` to set Hub apiBaseUrl.",
    ])
  }

  const session = hubAuthSession(apiBaseUrl)
  if (!session) {
    return hubStateBlock([
      "Hub: on",
      `Project: ${projectId}`,
      `Login: missing for ${apiBaseUrl}`,
      `Current task: ${currentTask}`,
      "AI: ask the user to run `suncode hub login` before using Hub workflows.",
    ])
  }
  if (hubSessionExpired(session)) {
    return hubStateBlock([
      "Hub: on",
      `Project: ${projectId}`,
      `Login: expired for ${apiBaseUrl}`,
      `Current task: ${currentTask}`,
      "AI: ask the user to run `suncode hub login` before using Hub workflows.",
    ])
  }

  const refreshed = refreshHubStateViaCli(ctx, input)
  if (!refreshed.state) {
    return hubUnavailableBlock(
      projectId,
      currentTask,
      refreshed.error || "Hub state refresh failed",
    )
  }
  return formatLiveHubState(refreshed.state, projectId, currentTask)
}

function formatLiveHubState(state, fallbackProjectId, fallbackCurrentTask) {
  const summary = state && typeof state === "object" && state.summary && typeof state.summary === "object"
    ? state.summary
    : {}
  const project = state && typeof state === "object" && state.project && typeof state.project === "object"
    ? state.project
    : {}
  const current = state && typeof state === "object" && state.currentTask && typeof state.currentTask === "object"
    ? state.currentTask
    : {}
  const hub = stringValue(summary.hub) || "unknown"
  const projectId = stringValue(project.projectId) || fallbackProjectId
  const config = stringValue(summary.config) || "unknown"
  const login = stringValue(summary.login) || "unknown"
  const service = stringValue(summary.service) || "unknown"
  const work = stringValue(summary.work) || "unknown"
  const currentTask =
    stringValue(current.state) ||
    stringValue(summary.currentTask) ||
    fallbackCurrentTask
  const lines = [
    `Hub: ${hub}`,
    "Source: live (`suncode hub state --json`)",
    `Project: ${projectId}`,
    `Config: ${config}`,
    `Login: ${login}`,
    `Service: ${service}`,
    `Work: ${workLine(state, work)}`,
    `Current task: ${currentTask}`,
  ]
  const nextAction = stringValue(state.nextAction)
  if (nextAction) {
    lines.push(`AI: ${nextAction}`)
  } else if (service === "unavailable") {
    lines.push("AI: Hub service is currently unavailable; do not use Hub-specific workflows.")
  } else if (currentTask === "local-only") {
    lines.push("AI: 当前任务未绑定 Hub；不要运行 submit-plan、submit-completion、mark-started 等 Hub 任务命令，除非用户明确要求绑定 Hub 需求。")
  } else if (work === "available") {
    lines.push("AI: ask the user whether to pull/select Hub work with `suncode hub pull`.")
  } else {
    lines.push("AI: use Hub commands only for Hub-bound tasks.")
  }
  return hubStateBlock(lines)
}

function hubUnavailableBlock(projectId, currentTask, reason) {
  return hubStateBlock([
    "Hub: on",
    "Source: live refresh failed",
    `Project: ${projectId}`,
    "Service: unavailable",
    `Reason: ${reason}`,
    `Current task: ${currentTask}`,
    "AI: Hub state refresh failed or timed out; treat Hub as currently unavailable and do not use Hub-specific workflows.",
  ])
}

function refreshHubStateViaCli(ctx, input = null) {
  const cli = process.env.SUNCODE_CLI || "suncode"
  const timeout = hubStateHookTimeoutMs()
  const env = { ...process.env, SUNCODE_HOOKS: "0" }
  const contextKey = ctx.getContextKey(input)
  if (contextKey) env.SUNCODE_CONTEXT_ID = contextKey
  const result = spawnSync(cli, ["hub", "state", "--json"], {
    cwd: ctx.directory,
    env,
    encoding: "utf-8",
    timeout,
    shell: process.platform === "win32",
  })
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      return { state: null, error: "Hub state refresh timed out" }
    }
    return { state: null, error: "Hub state refresh failed" }
  }
  if (result.status !== 0) {
    return { state: null, error: "Hub state refresh failed" }
  }
  try {
    const parsed = JSON.parse(result.stdout || "")
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { state: parsed, error: null }
    }
  } catch {
    // Invalid CLI JSON means the hook cannot trust the state.
  }
  return { state: null, error: "Hub state refresh failed" }
}

function hubStateHookTimeoutMs() {
  const raw = process.env.SUNCODE_HUB_STATE_HOOK_TIMEOUT_MS
  const parsed = raw ? Number.parseInt(raw, 10) : 1500
  const timeout = Number.isFinite(parsed) ? parsed : 1500
  return Math.min(Math.max(timeout, 50), 10000)
}

function hubStateBlock(lines) {
  return ["<hub-state>", ...lines, "</hub-state>"].join("\n")
}

function readSuncodeConfig(directory) {
  const configPath = join(directory, ".suncode", "config.yaml")
  if (!existsSync(configPath)) return {}
  let content
  try {
    content = readFileSync(configPath, "utf-8")
  } catch {
    return {}
  }
  const hub = {}
  let inHub = false
  for (const raw of content.split("\n")) {
    const line = raw.replace(/\r$/, "")
    if (/^hub:\s*$/.test(line)) {
      inHub = true
      continue
    }
    if (inHub && /^\S/.test(line)) break
    if (!inHub) continue
    const match = line.match(/^ {2}([A-Za-z][\w]*):\s*(.*)$/)
    if (!match) continue
    const key = match[1]
    const value = stripYamlScalar(match[2])
    if (key === "enabled") hub.enabled = ["true", "yes", "1", "on"].includes(value.toLowerCase())
    else if (value && value !== "null" && value !== "~") hub[key] = value
  }
  return { hub }
}

function getCurrentHubTaskState(ctx, input = null) {
  const active = ctx.getActiveTask(input)
  const taskRef = active.taskPath
  if (!taskRef) return "none"
  const taskDir = ctx.resolveTaskDir(taskRef)
  if (!taskDir || !existsSync(taskDir)) return "unknown"
  const data = readJson(join(taskDir, "task.json"))
  if (!data || typeof data !== "object") return "unknown"
  const hub = data.meta && typeof data.meta === "object" ? data.meta.hub : null
  if (!hub || typeof hub !== "object") return "local-only"
  if (stringValue(hub.remoteTaskId) || hub.bindingStatus === "bound") return "hub-bound"
  if (
    stringValue(hub.requirementId) ||
    ["pending", "pending_parent", "failed"].includes(hub.bindingStatus)
  ) {
    return "hub-pending"
  }
  return "local-only"
}

function globalApiBaseUrl() {
  const config = readJson(join(homedir(), ".suncode", "hub", "config.json"))
  return config && typeof config === "object"
    ? normalizeApiBaseUrl(stringValue(config.defaultApiBaseUrl))
    : null
}

function hubAuthSession(apiBaseUrl) {
  const auth = readJson(join(homedir(), ".suncode", "hub", "auth.json"))
  const sessions = auth && typeof auth === "object" ? auth.sessions : null
  if (!sessions || typeof sessions !== "object") return null
  const session = sessions[apiBaseUrl]
  return session && typeof session === "object" ? session : null
}

function hubSessionExpired(session) {
  const expiresAt = stringValue(session.expiresAt)
  if (!expiresAt) return false
  const timestamp = Date.parse(expiresAt)
  return Number.isFinite(timestamp) && timestamp <= Date.now()
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"))
  } catch {
    return null
  }
}

function workLine(state, fallback) {
  const work = state && typeof state === "object" ? state.work : null
  const count = work && typeof work === "object" ? work.availableCount : null
  if (Number.isInteger(count)) {
    return count > 0 ? `${count} available requirements` : "none"
  }
  return fallback
}

function normalizeApiBaseUrl(value) {
  return value ? value.trim().replace(/\/+$/, "") : null
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function stripYamlScalar(value) {
  const withoutComment = value.replace(/\s+#.*$/, "").trim()
  if (
    (withoutComment.startsWith('"') && withoutComment.endsWith('"')) ||
    (withoutComment.startsWith("'") && withoutComment.endsWith("'"))
  ) {
    return withoutComment.slice(1, -1)
  }
  return withoutComment
}

// OpenCode 1.2.x expects plugins to be factory functions (see inject-subagent-context.js comment).
export default async ({ directory }) => {
  const ctx = new SuncodeContext(directory)
  debugLog("workflow-state", "Plugin loaded, directory:", directory)

  return {
      // chat.message fires on every user message. Inject breadcrumb in-place
      // so it persists in conversation history.
      "chat.message": async (input, output) => {
        try {
          // Skip Suncode sub-agent turns — the per-turn breadcrumb is for the
          // main session only; sub-agent context comes from the parent's
          // tool.execute.before injection.
          if (isSuncodeSubagent(input)) {
            debugLog("workflow-state", "Skipping suncode subagent turn:", input?.agent)
            return
          }
          if (process.env.SUNCODE_HOOKS === "0" || process.env.SUNCODE_DISABLE_HOOKS === "1") {
            return
          }
          if (process.env.OPENCODE_NON_INTERACTIVE === "1") {
            return
          }
          if (!ctx.isSuncodeProject()) {
            return
          }
          const templates = loadBreadcrumbs(directory)
          const task = getActiveTask(ctx, input)
          const breadcrumb = task
            ? buildBreadcrumb(task.id, task.status, templates, task.source)
            : buildBreadcrumb(null, "no_task", templates)
          const context = `${breadcrumb}\n\n${buildHubState(ctx, input)}`

          const parts = output?.parts || []
          const textPartIndex = parts.findIndex(
            p => p.type === "text" && p.text !== undefined,
          )
          if (textPartIndex !== -1) {
            const originalText = parts[textPartIndex].text || ""
            parts[textPartIndex].text = `${context}\n\n${originalText}`
          } else {
            parts.unshift({ type: "text", text: context })
          }
          debugLog(
            "workflow-state",
            "Injected breadcrumb for task",
            task ? task.id : "none",
            "status",
            task ? task.status : "no_task",
          )
        } catch (error) {
          debugLog(
            "workflow-state",
            "Error in chat.message:",
            error instanceof Error ? error.message : String(error),
          )
        }
      },
  }
}
