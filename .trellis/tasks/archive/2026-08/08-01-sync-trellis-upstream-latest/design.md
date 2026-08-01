# Trellis v0.6.9-v0.6.11 语义同步设计

## 1. 设计目标

以 Suncode 当前架构为目标系统，把官方 Trellis 三个稳定版中的 15 组行为重新实现为 Suncode contract。上游 commit 是行为和测试证据，不是可覆盖本地文件的模板。

设计遵循四个不变量：

1. **身份隔离**：产品只认 `.suncode` / `SUNCODE_*` / `suncode-*`；本仓 `.trellis` 保持开发工作流身份。
2. **所有权可证**：shared platform root、symlink root 和 generated file 必须有 hash、唯一 marker 或 realpath containment 证据。
3. **状态机闭合**：session cleanup、Codex failure、idle timeout、context budget 必须覆盖成功、失败、模糊和重试分支。
4. **source/mirror 一致**：live `.trellis` scripts 与 packaged `.suncode` scripts 的通用行为不能漂移；platform-specific adapters 共享可测试语义。

## 2. 变更分层

```text
官方 v0.6.9-v0.6.11 行为
          │
          ├── Python workflow/runtime safety
          │     A1 A2 A3 A9 A13 A14
          │
          ├── Platform templates/configurators
          │     A4 A5 A6 A7 A8 A10 A15
          │
          ├── Channel supervisor/adapters
          │     A11 A12
          │
          └── Specs / CI / regression gates
                all packages
```

实施按依赖关系分批，不按 release commit 顺序机械重放。先建立通用 helper/contract，再接各 adapter 和平台，最后收紧 CI。

## 3. Identity 转换

| 官方 Trellis 行为 | Suncode 实现 |
| --- | --- |
| `.trellis/config.yaml` product setting | `.suncode/config.yaml` template；本仓 `.trellis/config.yaml` 只接开发工作流适用项 |
| `context_injection` notice 中的 Trellis | Suncode |
| `no-trellis` | `no-suncode` |
| `.trellis/tasks`, `.trellis/workspace` auto-trust | `.suncode/tasks`, `.suncode/workspace` |
| `.codex/agents/trellis-*.toml` | `.codex/agents/suncode-*.toml` |
| Snow `trellis-*` commands/agents/hooks | Snow `suncode-*` assets |
| `TRELLIS_CONTEXT_ID` 等 | `SUNCODE_CONTEXT_ID` 等 |
| `@mindfoldhq/trellis*` | `@wjptz/suncode*` |

不新增 Trellis compatibility alias，不探测或迁移用户 `.trellis` 产品数据。

## 4. A1/A2：Context materialization contract

### 4.1 统一 limits

在 Suncode config 中定义：

```yaml
context_injection:
  max_file_bytes: 32768
  max_artifact_bytes: 65536
  max_total_bytes: 131072
```

- 缺失项使用默认值。
- 非整数或负数 fallback 到对应默认值并写 stderr warning。
- `0` 表示禁用该层限制。
- 单个 injected context 使用一个共享 total budget，读取顺序保持 `jsonl → prd → design → implement`。

### 4.2 materialization

Python、Pi、OpenCode 都执行：

1. 以 bytes 读取；
2. NUL 或 strict UTF-8 decode 失败判定为 binary；
3. binary 只输出包含 path、size、reason 的 reference notice；
4. text 按 UTF-8 code point 边界截断；
5. 若完整 block 超出 total budget，降级为 index notice；
6. notice 自身计入 budget；
7. 若详细 notice 也无法容纳，只输出一次固定长度的终止提示并停止后续
   物化，避免恶意 binary/JSONL 条目绕过总预算造成无界增长；
8. 所有 model-visible 文案使用 Suncode identity。

三份实现可以保持语言原生，但测试必须锁定同一默认值、顺序、边界和 notice 关键字段。

### 4.3 per-turn skip

`prompt_injection.skip_keyword` 默认 `no-suncode`。匹配规则：case-insensitive、keyword 两侧不能是 `\w` 或 `-`；空 keyword 永不匹配。hook 在解析 active task 或加载 workflow 前检查，命中时返回空输出。SessionStart 和 subagent hook 不读取该开关。

## 5. A3/A7/A9/A13/A14：Python workflow scripts

### 5.1 任务和 journal

- `add_session.py`：repeatable `--change` / `--test` / `--next-step`；没有内容的 section 不渲染 placeholder。
- `task.py create --meta key=value`：fail-fast 校验；只写字符串值；后一个重复 key 覆盖前一个。
- `task.py set-meta`：在现有 `meta` dict 上更新单一 key，不能重建整个 dict，因此 `meta.hub` 保留。
- task list：parent 引用不存在于 active set 时，把 child 当作顶层显示。
- spec 明确 core schema 管 canonical task record，Python scripts 管 workflow mutations；两侧字段变更必须配套。

### 5.2 Session cleanup

`clear_active_task` 先用当前 platform input 解析 `ActiveTask`：

- resolved 且有 `task_path/context_key`：只删除 `previous.context_key` 对应 session file；
- unresolved/ambiguous：不删除任何 session；
- 返回删除前的 resolved state，供 finish 输出使用。

这避免 platform 请求 key 与 single-session fallback key 不同导致删除错误文件。

### 5.3 Journal union

`ensureGitattributes(cwd)` 是 additive-only：

- 文件不存在：写入 bundled Suncode rule；
- 已存在等价 `journal-*.md merge=union`：no-op；
- 已存在但无规则：保留全部内容，在末尾追加；
- dry-run 不写；
- 只对 append-only journal 设置 union，不处理 regenerated `index.md`。

### 5.4 Bounded Git probes

- `run_git(..., timeout=None)` 默认保持无上限，只有 session-context probe 显式传 2 秒。
- 自动 polyrepo scan 仍限制 depth=2，并新增 max repos=8。
- 发现第 9 个 repo 时放弃整个自动结果并警告配置显式 `packages.*.git=true`，避免展示不完整的随机子集。
- `git status` timeout/失败时不得将 repo 报成 clean。

### 5.5 UTF-8

受影响 Python hook 在模块加载后、第一次 stdin read 前 best-effort reconfigure。失败只回退旧 stream，不中止 hook；Windows stdout/stderr 处理保持现状。

## 6. A4/A8/A10：Native agent contracts

### 6.1 Codex model preservation

解析器只接受 flat TOML 顶层、uncommented：

```toml
model = "..."
model_reasoning_effort = "..."
```

扫描时跳过 multiline string body，正确处理 escaped quotes/backslashes 和 inline comment。只处理 `.codex/agents/suncode-{implement,check,research}.toml`。init overwrite 和 update desired-files/hash comparison 前都应用 preserved keys。

静态模板只给注释提示：

```toml
# model = "gpt-5.6-terra"
# model_reasoning_effort = "high"
```

### 6.2 Codex saved hook output

agent context loading 优先级：

1. 若输入含 `Full hook output saved to: <path>`，先读取该文件；
2. 读取失败，转 active-task role fallback；
3. 没有 saved notice 且有完整 marker，信任 hook payload；
4. marker 缺失，转 active-task role fallback；
5. 没有 active task path 时询问 main session，不猜测其他 session。

### 6.3 Kimi research

Kimi built-in `explore` 无写工具，因此 `suncode-research` 明确派发 `coder`。prompt 必须包含 active task path、已是 research agent 的 recursion guard，以及“只能写 task/research”范围。

### 6.4 Pi model/thinking

Model 优先级：per-call > agent frontmatter > invoking context `provider/id`。Thinking 优先级保持 per-call > model suffix > agent frontmatter > agent suffix > invoking thinking。枚举统一加入 `max`，并同步 parser、schema、display label 和 child CLI args。

## 7. A5/A15：Platform registry 与所有权

### 7.1 Snow CLI

新增 registry data、configurator、template collector、CLI flag、init/update/uninstall surfaces：

- `.snow/skills/`：Suncode commands-as-skills；
- `.snow/commands/suncode-*.json`；
- `.snow/agents/suncode-*.md`；
- `.snow/hooks/` 与 Suncode context writer；
- `.snow/SNOW.md` managed block。

模板要通过现有 placeholder/neutral shared-skill pipeline，不能复制 Trellis 名称或上游 marketplace pointer。

### 7.2 配置平台识别算法

`getConfiguredPlatforms(cwd)` 采用分层证据：

1. 加载 `.suncode/.template-hashes.json`；
2. 对每个平台收集当前模板路径，只要 manifest 含该平台自身 configDir 下的模板记录，即认为 Suncode 管理过该平台；
3. `ownershipMarkers` 仍用于 OMP 等共享 root 的唯一 Suncode marker，并与 hash 证据取并集；
4. legacy Windsurf 只在 manifest 有 `.windsurf/workflows/suncode-*` 或目录存在 `suncode-*` 文件时认作 Devin；
5. `.agents/skills` 等共享层不能单独证明具体平台；
6. 裸 native config directory 永远不构成所有权。

manifest 记录即使对应 managed file 被用户删除，仍保留“此前由 Suncode 配置”的事实，让 update 能遵守 user-deleted path contract；损坏 manifest 则回退唯一 marker，不回退裸目录。

## 8. A6：Trusted context roots

新增独立 resolver，每次 spawn 解析一次：

- `channel.trusted_context_dirs` 中路径相对 cwd 解析，也允许 absolute；必须能 realpath。
- 默认 auto-trust 仅检查 `.suncode/tasks` 和 `.suncode/workspace` 自身是否为顶层 symlink。
- `auto_trust_suncode_symlinks: false` 可关闭自动信任。
- explicit/auto roots 去重。
- agent file、`--file`、`--jsonl` row 和 OMP referenced file 都以 `cwd realpath ∪ trusted roots` 做 containment。
- lexical fallback 只用于不存在路径的拒绝判断；实际读取前再次 realpath/stat，防 TOCTOU。

不自动信任 `.trellis` symlink，也不把任意 `.suncode/*` symlink 扩为可信。

## 9. A11/A12：Channel 状态机

### 9.1 Codex terminal failures

`CodexCtx` 增加 `terminalErrorSeen`：

- `turn/completed` 且 `turn.status=failed`：提取 `turn.error.message`，发一次 error；
- `error` 且 `willRetry=true`：发 warning progress，不 terminal；
- `error` 且不可重试：发一次 error；
- 同一 turn 的两个 failure event 任意顺序都去重；
- `encodeCodexUserMessage` 开始新 turn 时重置；
- terminal error 后不再发 done。

### 9.2 Idle timeout

worker 的 terminal event 只是某个 turn 结束，supervisor 仍可接受下一 turn。idle timer 的 fire guard 只保留：

- 已取消；
- shutdown in progress；
- child exited。

完成 turn 后 `reset()` 应重新开始 TTL，到期请求 `SIGTERM / idle-timeout`。

## 10. CI 与验证设计

### 定向 suites

| 行为包 | 主要 tests |
| --- | --- |
| A1/A2/A9/A13/A14 | context injection integration、prompt skip、regression、task/session Python scripts |
| A3/A7 | add-session、task tree/meta、init/update、gitattributes |
| A4/A8/A10 | Codex configurator/template、Kimi template、Pi template |
| A5/A15 | platform registry/init/update/uninstall/platforms JSON、Snow templates |
| A6 | channel context trust、OMP template |
| A11/A12 | channel Codex adapter、supervisor idle |

### 全量门禁

1. Python 3.9 `py_compile` 所有 tracked `.py`，pycache 写到临时目录；
2. basedpyright；
3. ESLint；
4. TypeScript typecheck；
5. core/CLI build；
6. CLI full tests，Python/后端相关测试设置 60 秒硬超时；
7. `git diff --check`；
8. template/source mirror assertions；
9. GitNexus `detect_changes(compare main)`；
10. staged path whitelist 复核。

## 11. 脏工作与提交边界

本轮不修改 `docs-site`、`marketplace`，也不触碰任务创建前已有的 AGENTS/CLAUDE/GitNexus skill/draft 改动。即使测试或 format 工具改变这些路径，也必须停止并报告，不能自动还原用户文件。

提交分两层：

1. **implementation commit**：A1-A15、测试、spec、task research/plan 和真实验证摘要；
2. **checkpoint commit**：ledger + sync-state only，在 implementation commit 已验证后执行。

任务 archive/journal 是后续 bookkeeping，不与 implementation 混在一起。

## 12. 风险

- `getConfiguredPlatforms`、`update`、platform registry、channel adapter/supervisor、Pi extension 和 shared hooks 都是高 fan-out 路径；预计 GitNexus 会报告 HIGH/CRITICAL。
- Snow 增加跨平台注册面，容易漏掉 init/update/uninstall/template-hash/tests。
- 当前两个子模块均有用户脏改，任何“顺便同步 docs/marketplace”都会造成所有权冲突，所以本轮明确排除。
- Python/Pi/OpenCode 三份 context implementation 存在文案/边界漂移风险，必须用共享 contract assertions 而非只测 happy path。
