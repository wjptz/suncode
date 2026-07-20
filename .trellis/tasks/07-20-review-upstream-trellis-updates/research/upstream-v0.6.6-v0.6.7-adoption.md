# Trellis v0.6.6 / v0.6.7 采纳评估

## 结论摘要

值得采纳，而且价值主要集中在“用户数据安全、文件系统边界、并发顺序、Windows/Pi/ZCode 正确性”，不是品牌、版本号或迁移 manifest。

推荐采用“按上游 commit 的行为语义移植到 Suncode，再补 Suncode 自有测试”的方式；不建议 merge/cherry-pick 整个 tag，也不建议运行 `trellis update` 作为源码同步机制。原因是本仓与上游在 `v0.6.5` 后已经独立演进，并且双方都使用了 `v0.6.6`、`v0.6.7` 等同名 tag，但对应 commit 不同。

建议收口为四组：

1. P0 数据与文件系统安全：原子写、卸载保护、归档边界、下载回滚、迁移所有权、旧日志改名防覆盖。
2. P1 Channel 可靠性：名称路径防逃逸、目录发现防御、stdout 串行、Windows npm node-script shim。
3. P1/P2 平台与工作流正确性：Pi 上下文持久化和 prompt 稳定、ZCode 新目录、Codex inline 不生成无用 JSONL、task create hygiene、journal stale branch、Pi 本地 session 目录。
4. P1/P2 完整 OMP 平台：平台注册与模板、command/skill/agent 生成、session/context/compaction extension、task 平台识别、Suncode ownership-aware update/uninstall。

用户已决定本轮纳入完整 Oh My Pi（OMP）支持，理由是当前冲突面有限，而推迟会让未来跨更多版本重新追踪依赖链。落地仍采用 Suncode 命名和所有权隔离，不原样复制 Trellis 资产。

## 版本与证据边界

### 真实版本拓扑

| 对象 | commit | 证据 |
| --- | --- | --- |
| 官方 Trellis fork 基线 `v0.6.5` | `01ec8d6503b2338194e9bd2e9dbbcf22054c1bba` | `git merge-base main upstream/main`；官方 tag `git ls-remote --tags upstream v0.6.5` |
| 官方 Trellis `v0.6.6` | `41b6a460d298861991b082c7a7fbfa1f9f42fc6f` | [官方 release](https://github.com/mindfold-ai/Trellis/releases/tag/v0.6.6)、[官方 compare](https://github.com/mindfold-ai/Trellis/compare/v0.6.5...v0.6.6) |
| 官方 Trellis `v0.6.7` | `e7c5ead4d0dfd717d11a40b6bc0c80d8af94c49a` | [官方 release](https://github.com/mindfold-ai/Trellis/releases/tag/v0.6.7)、[官方 compare](https://github.com/mindfold-ai/Trellis/compare/v0.6.6...v0.6.7) |
| 本仓 Suncode HEAD / `v0.6.10` | `9664eec3a031ecd07c6439dde5e5cf85033df06c` | `packages/cli/package.json:3`、`packages/core/package.json:3` |
| 本仓同名 `v0.6.6` | `609269df46f6db37ff993de200655aa98177fabe` | 本地 tag；与官方 `41b6a46` 不同 |
| 本仓同名 `v0.6.7` | `7525a8a5a15c7e93c1b938c32701cd342c4a2b4f` | 本地 tag；与官方 `e7c5ead` 不同 |

### 三套“版本”不能混用

- 源码仓版本：`@wjptz/suncode` / `@wjptz/suncode-core` 当前是 `0.6.10`。
- 当前全局 `trellis --version`：已验证为 `0.6.7`。
- `get_context.py` 的 `0.6.2 -> 0.6.7` 提示：表示当前项目生成文件的 Trellis 模板状态落后，不表示当前源码仓或全局 CLI 是 `0.6.2`。

因此本任务评估的“fork 后两个上游版本”确定为官方 `v0.6.6` 和 `v0.6.7`，而不是本仓 `0.6.6 -> 0.6.7` 的本地提交，也不是项目生成文件 `0.6.2 -> 0.6.7` 的升级跨度。

### 调研限制

- 官方三个 tag 已拉到 `refs/remotes/upstream/releases/v0.6.5|v0.6.6|v0.6.7`，未覆盖本仓 tag/branch。
- `git fetch` 在主仓 ref 已成功后，因 `docs-site`、`marketplace` submodule 的历史 commit 无法从对应远端取得而返回失败；本报告没有把 submodule 状态当成主仓代码证据。
- YCE 本地代码检索成功，联网侧超时；外部事实改由官方 GitHub release/tag/compare/ref 核验。
- `git cherry` 把全部上游 commit 标为非 patch-equivalent。由于本仓已重命名包、路径和模板，这只说明不能直接认定补丁等价，不能单独证明功能缺失；每项结论都继续检查了当前实现。

## 初次 fork 后必须保留的边界

以下不是推断，而是初次迁移会话 `019f18a1-1330-7c43-8214-993ea4209dfd` 与归档任务的明确决策：

- Suncode 与 Trellis 是两个独立产品，不保留 Trellis 兼容别名。
- Suncode 不读取、迁移、改写或删除用户的 `.trellis`、`TRELLIS_*`、Trellis managed block 或 `~/.trellis/channels`。
- Suncode 当前运行时必须继续使用 `.suncode`、`SUNCODE_*`、`@wjptz/suncode*` 和 Suncode managed block。
- 上游历史 manifest、license 和 fork attribution 可以保留 Trellis 文本，但不能重新进入当前 Suncode 运行时。
- 本仓 Hub、中文规划文档、Suncode workflow/spec 注入、Agent Hub、channel/mem 扩展和 ZCode pull-based prelude 属于 fork 后定制，不能被上游模板机械覆盖。

主证据：

- `.trellis/tasks/archive/2026-06/06-29-suncode-full-migration/prd.md`
- `.trellis/tasks/archive/2026-06/06-29-suncode-full-migration/design.md`
- `.trellis/tasks/archive/2026-06/06-30-suncode-persistence-isolation/prd.md`
- `.trellis/tasks/archive/2026-06/06-30-suncode-persistence-isolation/design.md`

## 上游 v0.6.6 变化评估

官方 `v0.6.5...v0.6.6` 包含 51 个 commit。排除 release/journal/archive/submodule/二维码等仓库维护提交后，实质性变化如下。

### 建议采纳

1. Pi 上下文从用户输入变换迁到不可见持久化消息，并使 `systemPrompt` 跨 turn 字节稳定。
   - 上游 commits：[`dd35d97`](https://github.com/mindfold-ai/Trellis/commit/dd35d9712224bf59d6b56925bd0a03e18f61b2ae)、[`cd1baa6`](https://github.com/mindfold-ai/Trellis/commit/cd1baa654685f4cf2d754df0532252f4d9f6a40a)、[`de6676c`](https://github.com/mindfold-ai/Trellis/commit/de6676c81a3d6d21da3df44bf148e43b33cbef4c)。
   - 当前缺口：`packages/cli/src/templates/pi/extensions/suncode/index.ts.txt:1661` 仍通过 `input` transform 追加运行时内容，并把 `turn.wf/turn.ov` 每轮拼进 `systemPrompt`。
   - 价值：不污染用户原始消息，保留运行时上下文历史，减少 provider prefix cache 失效。

2. Channel stdout 行处理串行化与背压。
   - 上游 commit：[`3653353`](https://github.com/mindfold-ai/Trellis/commit/3653353069f859d2577be20cf95a3208ba7b6803)。
   - 当前缺口：`packages/cli/src/commands/channel/supervisor/stdout.ts:32` 对每一行独立启动 Promise，`applyParseResult` 可并发追加事件，输入顺序不能由该层保证。
   - 价值：避免高频 stdout 下事件乱序、terminal/turn 状态竞态和错误事件插队。

3. Windows 上支持 npm 生成的 Node script `.cmd` shim。
   - 上游 commit：[`e7e6fde`](https://github.com/mindfold-ai/Trellis/commit/e7e6fde035eab118237d003a9a27c3b3386e771e)。
   - 当前缺口：`packages/cli/src/commands/channel/supervisor.ts:84` 只解析 `.exe` shim，无法通过 `process.execPath + script.js` 启动 Codex 一类 node-script shim。
   - 价值：修复 Windows channel worker 无法启动某些 npm CLI 的问题，同时维持 `shell: false`，不引入命令注入面。

4. ZCode sub-agent 路径与资产模型修复。
   - 上游 commits：[`4370aea`](https://github.com/mindfold-ai/Trellis/commit/4370aea4b5dae9890511792647901df490929994)、[`5ec3a06`](https://github.com/mindfold-ai/Trellis/commit/5ec3a06828dfb0f2c762f98892951d1f0e159606)、[`bd0bc80`](https://github.com/mindfold-ai/Trellis/commit/bd0bc80cd4c7016e56546064105c710dd56465bb)。
   - 当前缺口：`packages/cli/src/configurators/zcode.ts:8,48,50,77` 仍生成 `.zcode/cli/agents/`；本仓已有 pull-based prelude，但目录仍是旧契约。
   - 价值：切到 ZCode 实际读取的 `.zcode/agents/`，同时过渡期继续管理旧路径，避免 update/uninstall 遗留。

5. Codex inline 模式不再生成无消费方的 `implement.jsonl` / `check.jsonl`。
   - 上游 commit：[`b1b8e0e`](https://github.com/mindfold-ai/Trellis/commit/b1b8e0e07e6a83e9a7603a3c1eefbb96b4758f9a)。
   - 当前缺口：`packages/cli/src/templates/suncode/scripts/common/task_store.py:119-152` 看到 `.codex/` 就无条件视为 sub-agent 平台，没有读取 `codex.dispatch_mode`。
   - 价值：让生成文件与本仓 inline 工作流一致，减少空 manifest 和错误 ready gate 信号。

6. task create 的日期前缀保护、空描述提示、`--no-start` 与激活回显。
   - 上游 commits：[`4744375`](https://github.com/mindfold-ai/Trellis/commit/4744375d2e146a5e450e931f0397f3a3207d87ff)、[`ffa99db`](https://github.com/mindfold-ai/Trellis/commit/ffa99db537e5e7b6cdfb2d38096489bff75ca208)。
   - 当前缺口：`packages/cli/src/templates/suncode/scripts/common/task_store.py:305` 仍直接把 `MM-DD` 与用户 slug 拼接；当前没有 `--no-start`、空描述提示或激活来源回显。
   - 价值：防止 `MM-DD-MM-DD-name`，支持批量建 backlog 不抢当前任务，提高任务可搜索性。

7. journal 记录忽略已不存在的 task branch。
   - 上游 commit：[`7ad836b`](https://github.com/mindfold-ai/Trellis/commit/7ad836b4a9e1e87ef47cc0a652038db9ee4e4137)。
   - 当前缺口：`packages/cli/src/templates/suncode/scripts/add_session.py:546-556` 直接信任 `task.json.branch`。
   - 价值：删除 feature branch 后不会继续把旧 branch 写入 journal/index。

### 已决策采纳：完整 OMP 平台

OMP 是 `v0.6.6` 最大新增面。用户已明确要求本轮纳入，以避免未来跨版本重新追踪依赖。完整上游行为由以下 commit 链组成，实施时必须以 `v0.6.6` 最终状态为准，不能只复制首个 feature commit：

- [`a6f7fc2`](https://github.com/mindfold-ai/Trellis/commit/a6f7fc2)：平台注册、`--omp`、configurator、commands/skills/agents/extension 模板、CLI adapter 和 task store 基础能力。
- [`70693fb`](https://github.com/mindfold-ai/Trellis/commit/70693fb)：session-start 富上下文、主会话与 sub-agent 精确任务上下文。
- [`49dca22`](https://github.com/mindfold-ai/Trellis/commit/49dca22)：`context` handler、`session_before_compact` 和压缩后感知再注入。
- [`5b37032`](https://github.com/mindfold-ai/Trellis/commit/5b37032)、[`ba2bad2`](https://github.com/mindfold-ai/Trellis/commit/ba2bad2)：implement/research agent 的 `model: pi/task`。
- [`dcdda3f`](https://github.com/mindfold-ai/Trellis/commit/dcdda3f)：生成 command YAML frontmatter。
- [`9286fac`](https://github.com/mindfold-ai/Trellis/commit/9286fac)、[`7545cb2`](https://github.com/mindfold-ai/Trellis/commit/7545cb2)、[`1fbcd9b`](https://github.com/mindfold-ai/Trellis/commit/1fbcd9b)：session-aware active task、extension blocker 回归和 stale session identity 修复。

上游 `packages/cli/src/configurators/omp.ts:1-86` 生成 `.omp/commands`、`.omp/skills`、`.omp/agents` 和 extension；平台注册位于 `packages/cli/src/types/ai-tools.ts:438-453`。Suncode 落地必须把 `trellis-*`、`/trellis:` 和 `.omp/extensions/trellis` 转为对应 Suncode 命名。

Suncode 还需要额外解决上游未处理的共存问题：当前 `packages/cli/src/configurators/index.ts:526-545` 仅按 `configDir` 存在检测平台。由于 Trellis 和 Suncode 都可能使用 `.omp`，OMP 必须覆盖为 ownership-aware 检测，仅存在 Trellis OMP 文件不能触发 Suncode update/uninstall。

可排除 `.omp` dogfood、上游 task/journal/archive、docs 和 release 内容。上游没有新增 OMP `mem` reader。兼容性结论是：本轮上游 OMP extension 只从 `ctx.sessionManager.getSessionId()` / `getSessionFile()` 获取运行时身份，没有定义可供离线索引的稳定磁盘根和 JSONL schema；现有 Pi adapter 则明确依赖 Pi 的 `~/.pi/agent/sessions/`、项目级 `.pi/settings.json` 与 Pi JSONL 格式。两者没有足够证据证明磁盘格式兼容，因此本轮不新增 `suncode mem --platform omp`，也不把 OMP 会话伪装为 Pi memory source。后续只有在 OMP 官方持久化目录与记录 schema 稳定后才能单独增加 adapter。

## 上游 v0.6.7 变化评估

官方 `v0.6.6...v0.6.7` 包含 20 个 commit、44 个文件变化；核心是一轮文件系统/数据安全审计修复。

### 全部建议采纳，但按 Suncode 契约改造

1. Channel / worker 名称路径逃逸防护 + discovery 防御。
   - 上游 commits：[`4899d5a`](https://github.com/mindfold-ai/Trellis/commit/4899d5a0cdad82fd2678a0abebc083d48f938258)、[`dc371bc`](https://github.com/mindfold-ai/Trellis/commit/dc371bc5e196857d4cd8efd674c46c9bc490b6a5)。
   - 当前缺口：`packages/core/src/channel/internal/store/paths.ts:45,73` 与 `packages/cli/src/commands/channel/store/paths.ts:67,88` 直接把 channel/worker 名拼进路径；当前没有 `assertSafeName`。
   - 价值：阻止 `../../x` 一类名称逃出 `~/.suncode/channels/<project>`，避免后续 recursive delete 作用到任意目录；扫描旧目录时跳过不合法名称，避免安全校验反过来阻断 discovery。
   - 适配要求：channel name 是存储 handle，建议沿用 ASCII slug 约束；人类可读中文继续放 forum title，不用放在目录名。

2. TypeScript 与 Python 状态文件原子写。
   - 上游 commit：[`c285bd3`](https://github.com/mindfold-ai/Trellis/commit/c285bd37511675c85e9af92fdc9de289413d8c68)。
   - 当前缺口：`packages/cli/src/templates/suncode/scripts/common/io.py:25-34` 直接 `write_text`；`file-writer.ts`、`registry-config.ts`、`template-hash.ts` 直接 `writeFileSync`。
   - 价值：崩溃、Ctrl-C、磁盘满时不留下半截 `task.json`、config 或 template hash。

3. uninstall 只移除 `AGENTS.md` 的 Suncode managed block，并保护未提交用户数据。
   - 上游 commits：[`5066b18`](https://github.com/mindfold-ai/Trellis/commit/5066b18f4ed1ed4c84fc4b8c8a151c3beac28af1)、[`76e44a9`](https://github.com/mindfold-ai/Trellis/commit/76e44a93e5ee4a694351f7ec66c3306038e126b7)。
   - 当前缺口：`packages/cli/src/commands/uninstall.ts:71-122` 没有 `AGENTS.md` structured scrubber；`uninstall.ts:374-477` 没有 `.suncode/spec|tasks|workspace` 的 Git dirty guard。
   - 价值：卸载不删用户在 managed block 外的 agent 规则；脚本化 `--yes` 默认拒绝销毁未提交 spec/PRD/journal。
   - 适配要求：常量与 bypass 必须使用 `SUNCODE` / `SUNCODE_ALLOW_DIRTY_UNINSTALL`，不能读取 Trellis 变量。

4. task archive 只允许 `.suncode/tasks/` 的直接子目录。
   - 上游 commit：[`f3bffb0`](https://github.com/mindfold-ai/Trellis/commit/f3bffb03ebda17555754489ea6d6d2f403dd7443)。
   - 当前缺口：`packages/cli/src/templates/suncode/scripts/common/task_store.py:449-537` 调用 `resolve_task_dir` 后没有根边界校验；`task_utils.py:175` 的 fallback 可把未知名字解析成仓库根下的真实目录。
   - 价值：`task.py archive src` 之类误输入不会把源码目录移入 task archive。

5. 模板 overwrite 先下载到临时目录，成功后再替换；临时目录清理不覆盖主结果。
   - 上游 commits：[`d7fe3a0`](https://github.com/mindfold-ai/Trellis/commit/d7fe3a030587c5210efcf62d84f3524919c328da)、[`8ebad8b`](https://github.com/mindfold-ai/Trellis/commit/8ebad8b9ca934d02771af41b6768e6f2fc5823de)。
   - 当前缺口：`packages/cli/src/utils/template-fetcher.ts:907-910` 在下载前直接删除目标；append cleanup 的 `rm` 异常还会替换下载结果。
   - 价值：网络失败时不丢现有 spec；Windows `EBUSY/EPERM` 清理异常不遮蔽真实成功/失败。

6. `rename-dir` 只自动迁移 manifest 证明属于 Suncode 的目录。
   - 上游 commit：[`524c936`](https://github.com/mindfold-ai/Trellis/commit/524c9361c0d088b20b905c6e028d5bcba2b87e94)。
   - 当前缺口：`packages/cli/src/commands/update.ts:1339-1430` 中 `rename-dir` 在目标不存在时“always auto (includes user files)”。
   - 价值：不会把用户自己的同名编辑器目录误当成 Suncode 资产移动；与本仓“产品数据所有权隔离”原则一致。

7. `traces-N.md -> journal-N.md` 不覆盖已经存在的 journal。
   - 上游 commit：[`0c2e276`](https://github.com/mindfold-ai/Trellis/commit/0c2e276c48542502a7b33e15753eb0b6c071cd28)。
   - 当前缺口：`packages/cli/src/commands/update.ts:2304-2333` 直接 `renameSync` 到目标，且 workspace 不在 update backup 中。
   - 价值：避免不可恢复的 session journal 数据覆盖。

8. `mem` 支持项目本地 `.pi/settings.json` 的相对 `sessionDir`。
   - 上游 commit：[`c15b5e5`](https://github.com/mindfold-ai/Trellis/commit/c15b5e58bdc4dc35ea24a35b15f321580582e8c5)。
   - 当前缺口：`packages/core/src/mem/internal/paths.ts:31-67` 只读全局 Pi settings；`packages/core/src/mem/adapters/pi.ts:153` 不把 `cwd` 传给 root discovery。
   - 价值：项目为 Pi 单独配置 session 目录时，`suncode mem` 仍能发现对应会话。

## 采纳矩阵

| ID | 候选 | 分类 | 优先级 | 当前状态 | 风险 / 工作量 | 验证重点 |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | Channel/worker 安全名称 + discovery skip | 改造后采纳 | P0 | 缺失 | 中；CLI/core 双实现需同步，名称约束有兼容影响 | `../`、绝对路径、空格/CJK/合法 slug、旧非法目录扫描 |
| A2 | TS/Python 原子写 | 改造后采纳 | P0 | 缺失 | 中；跨平台 rename、临时文件清理 | 中断/写失败保留原文件，临时文件清理，权限/可执行位 |
| A3 | uninstall AGENTS block + dirty guard | 改造后采纳 | P0 | 部分保护但核心缺失 | 中；混合所有权与 `process.exit` 测试 | block 外内容保留；`--yes` 脏数据 fail-closed；Suncode bypass |
| A4 | task archive 根边界 | 直接语义采纳 | P0 | 缺失 | 低 | `archive src` 拒绝；合法 task/parent-child 不回归 |
| A5 | template overwrite temp-first + cleanup | 直接语义采纳 | P0 | 缺失 | 中；Windows 文件锁 | 下载超时保留旧目录；cleanup 异常不遮蔽结果 |
| A6 | rename-dir 所有权 + traces/journal 防覆盖 | 改造后采纳 | P0 | 缺失 | 中 | manifest owned/unowned；目标 journal 已存在时双文件保留 |
| A7 | Channel stdout 串行与背压 | 直接语义采纳 | P0 | 缺失 | 中；高频异步顺序 | 800+ 行顺序、最大并发 1、错误处理顺序 |
| A8 | Windows node-script npm shim | 直接语义采纳 | P1 | 只支持 `.exe` | 中；Windows path/本地 bin 优先级 | `.exe`、`.js/.cjs/.mjs`、fallback、`shell:false` |
| A9 | Pi hidden runtime message + stable prompt | 改造后采纳 | P1 | 缺失 | 高；当前 Suncode Pi extension 已有大量自定义 | 用户输入不改写、prompt 字节稳定、task 更新持久化且不重复 |
| A10 | ZCode `.zcode/agents/` + 旧路径过渡 | 改造后采纳 | P1 | pull prelude 已有，路径仍旧 | 中 | init/update/uninstall、research/implement/check 三 agent、旧目录管理 |
| A11 | Codex inline JSONL skip + task create hygiene | 改造后采纳 | P1 | workflow 路由已有，create 细节缺失 | 低到中 | inline/sub-agent 两模式、日期 slug、`--no-start`、空描述提示 |
| A12 | journal stale branch fallback | 直接语义采纳 | P2 | 缺失 | 低 | local/origin branch 存在性、detached/no-git |
| A13 | Pi project-local sessionDir | 直接语义采纳 | P2 | 只支持全局 settings | 低 | 绝对/相对全局路径、项目本地相对路径、去重 |
| A14 | 完整 OMP 平台 | 改造后采纳（用户已确认） | P1 | 未集成 | 高；extension 连续修复、`.omp` 共享目录所有权 | init/update/uninstall、commands/skills/agents、session/context/compaction、Trellis-only `.omp` 隔离 |

## 不应采纳或不应直接复制的内容

- 官方 tag、版本号、release manifest：本仓版本线已经独立，不能用上游版本元数据覆盖 `@wjptz/suncode 0.6.10`。
- 上游 `.trellis`、`TRELLIS_*`、`@mindfoldhq/trellis*`、Trellis managed block：只能作为行为参考，落地必须改为 Suncode 契约。
- 上游 docs-site、marketplace submodule pointer、二维码、journal、task archive 记录：属于上游仓库维护，不是产品能力。
- 自动把 `.trellis` 迁移成 `.suncode` 的任何方案：与 fork 的产品隔离决策冲突。
- 整 tag merge/cherry-pick：会混入 Trellis 品牌、dogfood `.trellis` 文件、上游任务/文档、submodule pointer，并覆盖 fork 后 Hub/中文 workflow/platform 定制。

## 建议实施边界

推荐把后续实施拆成四个可独立验证的分组，而不是一个大 cherry-pick：

1. `upstream-filesystem-data-safety`
   - A2、A3、A4、A5、A6。
2. `upstream-channel-hardening`
   - A1、A7、A8。
3. `upstream-platform-workflow-parity`
   - A9、A10、A11、A12、A13。
4. `upstream-omp-platform-support`
   - A14；依赖平台注册、模板生成和所有权检测，必须覆盖上游 OMP commit 链的最终状态。

每个子任务都应先对即将修改的符号运行 GitNexus `impact(direction="upstream")`；任何 HIGH/CRITICAL 结果先向用户报告。实施后运行定向测试、CLI/core typecheck/build，并在提交前运行 GitNexus `detect_changes(scope="compare", base_ref="main")`。

## 当前未执行

- 未运行代码测试、typecheck 或 build：当前仍是规划/调研阶段，没有修改产品代码。
- 未运行 `trellis update` / `trellis upgrade` / `suncode update`。
- 未修改全局 CLI、npm 包、远端分支、tag、submodule pointer 或用户草稿。
