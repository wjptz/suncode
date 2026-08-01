# `suncode platforms` Command

Machine-readable report of which AI platforms are configured and owned by
Suncode in the current project. Downstream tooling should use this command
instead of maintaining a second marker-file table that can drift when a
platform is added or its configuration directory changes.

---

## User-facing contract

```text
suncode platforms [--json]
```

- Read the configured platform set through
  `getConfiguredPlatforms(cwd)` in `configurators/index.ts`.
- Source `displayName` and `configDir` from the matching `AI_TOOLS` registry
  entry; do not hardcode platform metadata in the command.
- `--json` prints this stable schema with `JSON.stringify(..., null, 2)`:

  ```json
  {
    "platforms": [
      {
        "id": "codex",
        "displayName": "Codex",
        "configDir": ".codex"
      }
    ]
  }
  ```

- Human mode prints one `displayName (id) — configDir` entry per configured
  platform, or `No platforms configured in this project.` for an empty set.
- Both modes exit 0 for an empty set. An empty result is not an error.
- JSON output contains no ANSI escape codes.

Ownership-aware detection is part of the command contract. For a shared root
such as `.omp/`, directory existence alone is insufficient; at least one
Suncode ownership marker must exist before the platform is reported.

## 场景：基于 Suncode 所有权证据的平台枚举

### 1. 范围 / 触发条件

修改 `AI_TOOLS`、platform collector、template hash、ownership marker 或
`suncode platforms` 输出时适用。命令只报告由当前 Suncode 安装拥有的平台，
而不是机器上所有宿主 AI 工具。

### 2. 签名

```typescript
function getConfiguredPlatforms(cwd: string): Set<AITool>;
function collectPlatformTemplates(id: AITool): Map<string, string> | null;
```

稳定 JSON schema 保持：

```typescript
type PlatformsOutput = {
  platforms: Array<{
    id: AITool;
    displayName: string;
    configDir: string;
  }>;
};
```

### 3. 契约

- 对每个平台，只有当前 collector 返回的 `configDir` 内至少一条路径存在于
  `.suncode/.template-hashes.json`，或至少一个 Suncode 唯一
  `ownershipMarkers` 存在，才视为 configured。
- 文件当前是否仍存在不参与 hash ownership 判断；用户删除 tracked 文件后
  平台仍需报告，以保持 update 的 user-deleted 语义。
- `.agents/skills` 是多平台共享根，不能单独证明 Codex ownership。
- `.omp` 是共享宿主根，只有 `.omp/**/suncode-*` marker 才能证明 Suncode
  ownership；Trellis-only 与 user-only 文件必须排除。
- legacy Windsurf 只识别 `.windsurf/workflows/suncode-*` 的 hash 或磁盘
  文件，并映射到现有 `devin` 平台 id。
- 输出顺序跟随 `PLATFORM_IDS`/`AI_TOOLS` registry；human/JSON 不得各自
  维护排序或 metadata 表。
- Snow 的输出项为 `{id:"snow", displayName:"Snow CLI",
  configDir:".snow/skills"}`。

### 4. 校验与错误矩阵

| 条件 | 预期行为 |
|---|---|
| 无 `.suncode` hash 且无 marker | 返回空数组，exit 0 |
| bare `.codex` / `.snow` / `.omp` | 不报告 |
| hash 中有当前平台模板 | 报告平台，即使文件被用户删除 |
| 只有 `.agents/skills` | 不报告 Codex |
| OMP 只有 Trellis/user 文件 | 不报告 OMP |
| legacy `suncode-*` Windsurf workflow | 报告 `devin` |
| registry lookup/文件读取抛错 | stderr `Error: ...`，exit 1；debug 时含 stack |

### 5. Good / Base / Bad Cases

- Good：同一项目 hash-owned Claude、Kimi、Snow，JSON 按 registry 顺序返回
  三个完整对象。
- Base：空项目返回 `{"platforms":[]}`。
- Bad：看到 `.agents/skills` 就报告 Codex；该目录可能只由 Gemini/Pi/Kimi
  写入。
- Bad：平台文件被用户删除后从列表消失，导致 update 无法继续尊重其历史
  ownership。

### 6. 必需测试

- unit：bare dirs、hash-owned、marker-owned、user-deleted、shared-root、
  legacy Windsurf、多平台顺序。
- CLI integration：built binary 的 JSON schema、空数组 exit 0、human 文本、
  Snow metadata、无 ANSI JSON。
- 新增平台时必须证明 collector 至少有一条位于其 `configDir` 下的 ownership
  路径；否则 hash-based detection 无法成立。

### 7. Wrong vs Correct

```typescript
// Wrong
const configured = fs.existsSync(path.join(cwd, config.configDir));

// Correct
const configured = hasTrackedTemplate || hasOwnershipMarker;
```

## Failure behavior

- On a thrown error, print `Error: <message>` and exit 1.
- When `DEBUG` or `SUNCODE_DEBUG` is set, also print the stack.
- Adding a platform requires only the registry/configurator wiring; this
  command must not grow platform-specific branches.

## Test requirements

- `--json` reports `id`, `displayName`, and `configDir` from the real registry.
- `--json` reports an empty `platforms` array with exit 0 when no platform is
  configured.
- Human output includes the display name and config directory.
- Shared-root false positives, especially a Trellis-only or user-only `.omp/`,
  remain excluded.
- The integration test spawns the built CLI because `src/cli/index.ts` has
  import-time side effects; build must run before this test.

Canonical coverage lives in
`packages/cli/test/commands/platforms.integration.test.ts`.
