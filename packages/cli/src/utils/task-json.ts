/**
 * Canonical task.json shape — single source of truth shared by all TS
 * writers. The canonical types and factory now live in the
 * `@wjptz/suncode-core` task API; this module re-exports them under
 * the legacy `TaskJson` / `emptyTaskJson` names for CLI call sites.
 *
 * New code should prefer `SuncodeTaskRecord` / `emptyTaskRecord` from
 * `@wjptz/suncode-core/task` directly.
 */

import {
  emptyTaskRecord,
  type SuncodeTaskRecord,
} from "@wjptz/suncode-core/task";

export type TaskJson = SuncodeTaskRecord;

export const emptyTaskJson = emptyTaskRecord;
