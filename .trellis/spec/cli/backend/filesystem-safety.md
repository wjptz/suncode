# 文件系统安全契约

> 本规范约束 Suncode 在读取 channel 上下文、JSONL manifest 和 agent 定义时的路径信任边界。任何扩展读取范围的改动都必须先满足本页契约。

## 场景：可信上下文根与符号链接隔离

### 1. 范围 / 触发条件

- 修改 `channel spawn --file`、`--jsonl`、`--agent` 的读取逻辑。
- 修改 `.suncode/tasks`、`.suncode/workspace` 或 `.suncode/agents` 的符号链接支持。
- 新增允许从 worker `cwd` 外读取上下文的配置项。

这些入口会把本地文件内容注入模型提示词；路径逃逸会直接扩大数据暴露范围，因此必须以真实路径而不是字符串前缀判定所有权。

### 2. 签名

```typescript
function parseChannelTrustSection(content: string): {
  trustedDirs: string[];
  autoTrustSymlinks?: boolean;
};

function resolveTrustedRoots(cwd: string): string[];

function assembleContext(
  cwd: string,
  files?: string[],
  jsonls?: string[],
  trustedRoots?: string[],
): AssembledContext;

function loadAgent(
  name: string,
  cwd?: string,
  trustedRoots?: string[],
): AgentDefinition;
```

配置面：

```yaml
channel:
  trusted_context_dirs:
    - ../shared-context
  auto_trust_suncode_symlinks: true
```

### 3. 契约

- `resolveTrustedRoots()` 只返回 `realpath` 后的绝对目录，并去重。
- 相对 `trusted_context_dirs` 以项目 `cwd` 为基准；不存在、断裂或无法解析的条目只警告并跳过，不能扩大信任。
- `auto_trust_suncode_symlinks` 缺省为启用，但只自动信任顶层 `.suncode/tasks` 与 `.suncode/workspace` 符号链接的真实目标；不能自动信任任意 `.suncode/**` 或 `.trellis/**`。
- `auto_trust_suncode_symlinks: false` 关闭上述自动信任；显式 `trusted_context_dirs` 仍生效。
- `--file`、manifest 自身、manifest 中的 `file` 以及 `--agent` 都必须落在 worker `cwd` 的真实路径或同一次 spawn 解析出的可信根内。
- containment 必须按路径分段判断：`/safe/root-other` 不是 `/safe/root` 的子路径；Windows 上使用 `path.sep`/`path.relative` 等平台语义，禁止裸 `startsWith(root)`。
- 读取符号链接前必须 `lstat`，随后重新解析 `realpath` 并再次做 containment 检查；失败时 fail closed，不得退回未经验证的外部路径。
- `spawn` 每次只解析一次可信根，并把同一数组同时传给 agent loader 和 context loader，避免两个读取面使用不同信任快照。
- 此配置只扩大读取白名单，不授予写权限，也不改变 channel worker 的 sandbox。

### 4. 校验与错误矩阵

| 条件 | 预期行为 |
|---|---|
| 文件位于 `cwd` 内 | 正常读取 |
| 文件位于显式可信根内 | 正常读取 |
| `.suncode/tasks` 或 `.suncode/workspace` 是有效顶层符号链接 | 缺省自动信任真实目标 |
| `auto_trust_suncode_symlinks: false` | 自动符号链接目标被拒绝，除非又被显式列出 |
| 配置条目不存在或断裂 | stderr 警告并跳过；spawn 继续 |
| 路径只共享字符串前缀 | 拒绝 |
| manifest 在 jail 内但引用 jail 外文件 | 只拒绝该 entry；其他合法 entry 继续 |
| agent 名包含 `/`、`..` 或控制字符 | 抛错，不做路径拼接读取 |
| 读取前符号链接解析到未信任位置 | 警告并拒绝 |

### 5. Good / Base / Bad Cases

- Good：`.suncode/tasks -> ../team-tasks`，配置使用缺省自动信任，JSONL 中的任务资料可读取。
- Base：普通项目没有符号链接或额外配置，所有上下文只能来自 worker `cwd`。
- Bad：用 `real.startsWith(cwdReal)` 放行 `/repo-copy/secret.md`，因为它与 `/repo` 共享字符串前缀。
- Bad：因为项目存在 `.trellis/tasks` 符号链接就自动信任其目标；Suncode 不能读取 Trellis 运行时作为兼容回退。

### 6. 必需测试

- 显式可信根：合法文件可读、不存在条目警告、重复 realpath 去重。
- 自动信任：顶层 `tasks`/`workspace` 符号链接可读，关闭开关后被拒绝。
- containment：嵌套路径通过、兄弟前缀路径拒绝、manifest 外链 entry 拒绝。
- agent：安全名称通过、路径穿越名称拒绝、`.suncode/agents` 外部符号链接只有在显式可信时通过。
- 静态竞态防线：测试或审查必须确认读取路径包含 `lstat → realpath containment → stat/read` 顺序；若未来改成文件描述符固定读取，应补针对换链竞态的集成测试。

### 7. Wrong vs Correct

#### Wrong

```typescript
const target = path.resolve(cwd, userPath);
if (target.startsWith(cwd)) {
  return fs.readFileSync(target, "utf-8");
}
```

#### Correct

```typescript
const cwdReal = fs.realpathSync(cwd);
const targetReal = fs.realpathSync(path.resolve(cwd, userPath));
const inside =
  targetReal === cwdReal || targetReal.startsWith(cwdReal + path.sep);
const trusted = trustedRoots.some(
  (root) => targetReal === root || targetReal.startsWith(root + path.sep),
);
if (!inside && !trusted) return null;
```
