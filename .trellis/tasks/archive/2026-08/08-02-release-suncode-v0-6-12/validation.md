# Suncode v0.6.12 验证记录

## 2026-08-02 实施前快照

### 主仓

- branch：`main`
- `HEAD`：`135623b8e47daabc1650fe0737eb0d9183740514`
- `origin/main`：`4274fa5ef218a2084bcf5c94acfd05db4e6d120f`
- `v0.6.11`：`275618c62b5f9b93b0cca6babc9e4e2c0dbcdc68`
- merge base：`be52b89e3f723123a0ce8210a5014913a1260f44`
- divergence：local ahead 17 / behind 4
- 已有非任务 dirty paths：
  - `.claude/skills/gitnexus/gitnexus-cli/SKILL.md`
  - `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md`
  - `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`
  - `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`
  - `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md`
  - `AGENTS.md`
  - `CLAUDE.md`
  - `docs-site`（release docs 修改）
  - `drafts/kb-design-philosophy.md`
- 当前任务目录 `.trellis/tasks/08-02-release-suncode-v0-6-12/` 为本轮新增，任务状态已变为 `in_progress`。

### 子模块

- 主仓记录的 docs-site gitlink：`2e7e5dcb5649aa9d15e0d423cd384bfcb9798e96`
- docs-site `HEAD` / `origin/main`：`2e7e5dcb5649aa9d15e0d423cd384bfcb9798e96`
- docs-site 工作树：25 个 tracked 双语文档改动，2 个未跟踪 v0.6.12 changelog。
- 主仓记录的 marketplace gitlink：`3a78f3e092624d09748d6175d65c19e4867725c3`
- marketplace `HEAD`：`3a78f3e092624d09748d6175d65c19e4867725c3`
- marketplace `origin/main`：`62f7bf94df10557936b01708f431013c66538d22`
- marketplace 工作树 clean，local ahead 1。

### 公共发布基线

- `@wjptz/suncode`：version `0.6.11`，`latest=0.6.11`。
- `@wjptz/suncode-core`：version `0.6.11`，`latest=0.6.11`。
- 三个仓库 `git fetch --tags --prune` 均成功。

### GitNexus

- 修改前 `_write_text_atomic` upstream impact：`HIGH`。
- blast radius：1 个直接调用者、3 个上游符号、2 类受影响执行流。
- d=1：`build_node_context`。
- d=2：`claim_execution_node`。
- d=3：`task_execution._cmd_claim`。
- 已使用 `node .gitnexus/run.cjs analyze --index-only` 重建本地索引：11,757 nodes、21,057 edges、422 clusters、300 flows。
- MCP 资源仍缓存旧 staleness 文本，但重建后复跑 impact 得到相同精确结果。

## 2026-08-02 隔离分支与修复证据

### 历史整合

- 任务 artifacts 精确提交：`46e2ce58d966923a6685485c14b07888e308be86`。
- release worktree：`/home/kangmeng/.kmproject/suncode-release-v0.6.12`，branch `release/v0.6.12`。
- 双历史 merge：`bb11465add9505e21977922d26b2e305ce0f1172`。
- `origin/main` 与本地 `main` 均已通过 `git merge-base --is-ancestor <ref> HEAD`；CLI/Core merge 基线均为 `0.6.11`。
- merge 冲突仅为两份 Trellis workspace journal/index；解析后保留两边 session 记录。`git diff --cached --check` 通过。
- GitNexus 对整体 merge 报告 critical（169 files、约 1067 symbols、106 flows），原因是两条已知历史的整体汇合；未把原工作树无关 dirty paths 带入 release worktree。

### Windows context bytes 修复

- 修复提交：`8d4173fc6aa62c23f826fddea0098ccdae293dc1`。
- 生产改动：`_write_text_atomic` 显式 `newline="\n"`，不改变临时文件、flush/close、`os.replace` 和异常清理语义。
- 回归测试在未修复代码上先失败，实际 bytes 为 `b'alpha\r\nbeta\r\n'`，期望为 `b'alpha\nbeta\n'`。
- 修复后 manifest raw bytes SHA-256、`budget.usedBytes`、Linux 上的 Windows CRLF 模拟均通过。
- 新增 content bytes 与 manifest fields 两类篡改测试，均返回对应 hash mismatch，不读取失配内容。
- GitNexus 对修复 diff 报告 low：2 files、3 symbols、0 affected indexed processes。

### 修复提交前验证

- `execution-runtime.test.ts`：修复提交时 60/60 通过；新增两项 tamper case 的定向运行 2/2 通过。
- 相关 ESLint：通过。
- root `pnpm typecheck`：先构建 core 后通过；单独 CLI typecheck 在 core `dist` 不存在时失败，已确认属于隔离 worktree 的构建顺序，按 root script 重跑通过。
- BasedPyright：0 error、64 warning；warning 均为既有 `common/__init__.py` 与 `git_context.py` 未使用 re-export。

## 2026-08-02 发布准备质量门

### 发布产物与文档

- `0.6.12.json` 已按 `v0.6.11..release/v0.6.12` 的用户可观察差异复核；`breaking=false`、`recommendMigrate=false`、`migrations=[]`，并补充 Windows context integrity、Snow、planning convergence 和自定义隔离 transport 边界。
- docs-site 精确提交：`1140966567911e4dd4476c34ae5ab43567946456`；共 31 个文件，包含 15 对中英文页面与双语 v0.6.12 changelog。
- marketplace 复用既有精确提交：`3a78f3e092624d09748d6175d65c19e4867725c3`；native/TDD/channel 三套 workflow 均包含 planning convergence gate，没有创建无必要的新提交。
- 双语结构检查通过：15/15 页面配对；changelog 的 `Enhancements`、`Bug Fixes`、`Upgrade` 标题一致，代码围栏均为 2，日期均为 `2026-08-02`，`docs.json` 中英文导航均存在。
- docs-site 目标文件 Prettier、44 份 Markdown lint、`lint:docs-json` 和脚本/config scoped ESLint 均通过；三仓 `git diff --check` 均通过。
- docs-site 全量 `pnpm lint` 仅被既有 `.gitnexus/run.cjs` 的 9 个 `process is not defined` 阻断，修改范围检查无错误。Mintlify CLI 未安装，因此未执行本地 renderer/broken-link 命令；使用 MDX、围栏、双语配对和导航静态门禁代替，未把它表述为渲染通过。

### 跨运行时与完整测试

- 隔离 worktree 初始受用户级 `core.autocrlf=true` 影响，模板 checkout 为 CRLF；索引始终为 LF。已为 release worktree 与其两个子模块设置隔离的 LF checkout，raw blob 与索引一致；没有产生仓库内容 diff，也没有改变原工作树的 `core.autocrlf=true`。
- tracked Python `py_compile`：通过；Core/CLI root build：通过。
- BasedPyright：0 error、64 个既有未使用 re-export warning。
- 定向回归：10 个文件、240/240 通过；其中 `execution-runtime.test.ts` 为 62/62，覆盖 raw bytes、budget、Windows newline probe、两类 tamper、恢复/重试/结果门禁等契约。
- root lint：通过；root typecheck 以 raw passthrough 单独重跑通过（首次并行 RTK 摘要曾错误返回 1，但没有 TypeScript 诊断）。
- 60 秒硬超时完整测试：Core 20/20 文件，332 passed、1 个既有 skipped；CLI 77/77 文件，1700/1700 passed。
- manifest continuity：140 local、6 published、21 个历史 gap 已白名单；双包版本一致性为 `0.6.11`。
- publish plan：当前未 bump 的 `0.6.11` 双包均正确显示 npm 已存在并 skip；正式 `0.6.12` bump 仍保留给 go/no-go 后干净 clone 中的官方 release script。
- packed CLI 校验通过，`@wjptz/suncode-core` 被精确固定为 `0.6.11`。

### Tarball 安装与 DAG context smoke

- 本地构建 `wjptz-suncode-core-0.6.11.tgz` 与 `wjptz-suncode-0.6.11.tgz`，在全新 `/tmp/suncode-v0612-pack-smoke-20260802/install` 安装成功。
- 安装后 CLI/Core 版本均为 `0.6.11`，CLI 的 Core 依赖为精确 `0.6.11`；Core 根导出以及 `channel`、`mem`、`task` 子路径均可导入，CLI `--version` 正确。
- 全新 Git 项目使用 packed CLI 执行 `init --codex --snow` 成功，Snow 出现在 help；随后 `update --force` 判定 154 个模板均已是最新。
- 真实 DAG smoke 完成 scaffold → validate → start → start-run → claim → context pull；单节点 plan hash 为 `94fc8e7920eead2a93fe00deb6b90e6fbcac83c007af3285a80d758e164f9cf8`。
- claimed context 的 raw SHA-256 为 `c04619f1f0c32c7136fc789eec4d0c95af58c5e15444aa68d93a48ee1349a723`，`rawBytes=usedBytes=1287`，没有 CRLF；manifest hash 为 `8cea63f516ee26c797c0b04b37b1699a14af0bb7ae2af75aad04deb2b318ab54`，`execution context` 验证通过。

### 原工作树保护

- 原主仓仍只有实施前记录的 5 个 GitNexus skill、`AGENTS.md`、`CLAUDE.md`、预期 docs-site gitlink 和 `drafts/kb-design-philosophy.md` 脏路径；原主仓 staging 为空。
- 原 docs-site `main` clean、仅相对 origin ahead 1；原 marketplace `main` clean、仅相对 origin ahead 1。
- 原主仓 `HEAD=46e2ce58d966923a6685485c14b07888e308be86`，只比实施前多任务激活提交；无关用户改动未被修改、暂存或提交。

### 提交前 GitNexus 审计

- `detect_changes({scope: "compare", base_ref: "main"})`：LOW。
- 变更范围为 10 个文件、4 个已索引符号、0 条受影响执行流；生产符号只有 `_write_text_atomic`，其余为 `execution-runtime.test.ts` 中的测试常量。

## 2026-08-02 正式发布与发布后验证

### 独立批准与远端顺序

- 本地 go/no-go 证据汇总完成后，用户明确回复“批准发布”，授权子仓、主仓、tag 与 CI/npm 发布。
- docs-site `origin/main`：`1140966567911e4dd4476c34ae5ab43567946456`。
- marketplace `origin/main`：`3a78f3e092624d09748d6175d65c19e4867725c3`。
- 主仓发布准备提交：`eeae67f97398fb67f362ecb0edcfb2a8a82dc648`；子模块 gitlink 分别指向上述两个已远端可达提交。
- 正式发布在全新递归 clone `/tmp/suncode-v0612-release-eeae67f-20260802-3` 中执行；root 与两个子模块均设置 `core.autocrlf=false`，工作树 clean，关键文件均为 LF checkout。

### 正式版本提交与 tag

- 官方 `pnpm release` 先复跑 manifest continuity、Core/CLI 完整测试，再生成版本提交并推送；没有执行本地 `npm publish`。
- 版本提交：`4032cc6a73a61484243d8156737dcf17ad57fff2`，只把 CLI/Core `package.json` 从 `0.6.11` 更新为 `0.6.12`。
- `origin/main`：`4032cc6a73a61484243d8156737dcf17ad57fff2`。
- `v0.6.12`：`4032cc6a73a61484243d8156737dcf17ad57fff2`；tag、正式提交与双包版本一致。
- 正式 clone 子模块保持 docs-site `1140966567911e4dd4476c34ae5ab43567946456`、marketplace `3a78f3e092624d09748d6175d65c19e4867725c3`，且 root/submodule 工作树 clean。

### GitHub Actions

- workflow：`publish.yml` run `30728839163`，URL：`https://github.com/wjptz/suncode/actions/runs/30728839163`。
- event/head：tag push，`v0.6.12` / `4032cc6a73a61484243d8156737dcf17ad57fff2`。
- 终态：`completed / success`；创建于 `2026-08-02T02:25:42Z`，结束于 `2026-08-02T02:28:25Z`。
- publish job `91445350191` 的 version alignment、typecheck、build、Core/CLI test、packed CLI 精确依赖、publish plan、两个 npm publish 和公共 npm verification 步骤全部成功。
- 项目发布 workflow 不创建独立 GitHub Release 对象；`gh release view v0.6.12` 返回 `release not found`，但 Git tag、Actions 与 npm 发布均正常，不属于本项目发布契约缺失。

### 公共 npm 证据

- `@wjptz/suncode@0.6.12` 已存在，`latest=0.6.12`；发布于 `2026-08-02T02:27:59.591Z`，shasum `e677568a6424246e53017992a0bc366ad4422f1b`。
- 公共 CLI 包精确依赖 `@wjptz/suncode-core: 0.6.12`。
- `@wjptz/suncode-core@0.6.12` 已存在，`latest=0.6.12`；发布于 `2026-08-02T02:27:08.513Z`，shasum `935e9bb83392187a3de2b78d0b1856033784b283`。

### 公共包全新安装烟测

- 全新目录：`/tmp/suncode-v0612-public-smoke-OXNN1SoZ`；从公共 registry 精确安装 CLI/Core `0.6.12` 成功，共安装 58 个包。
- 安装后 CLI/Core package version 均为 `0.6.12`，CLI Core 依赖为精确 `0.6.12`；`suncode --version` 输出 `0.6.12`。
- Core 根入口及 `channel`、`mem`、`task` 子路径均可成功导入。
- 已安装产物包含 `dist/migrations/manifests/0.6.12.json`，其 `version=0.6.12`、`migrations=[]`，描述与本次发布能力一致。
- 在全新 Git 项目执行 `suncode init --codex --yes --user public-smoke --no-monorepo` 成功，生成项目 `.suncode/.version=0.6.12`；`suncode update --dry-run` 判定 95 个模板均未变化且项目已是最新。
- 已安装模板的 `_write_text_atomic` 明确使用 `newline="\n"`。在 Linux 中把未声明 `newline` 的 `os.fdopen` 模拟成 Windows CRLF 默认行为后，writer 仍写出精确 `b'alpha\nbeta\n'`（11 bytes），探针通过。

### 最终状态

- 归档前 GitNexus `detect_changes(scope=all, worktree=release)`：LOW；3 个任务文档、0 个代码符号、0 条受影响执行流。
- 全部 10 项验收标准均满足；发布任务可归档。
- 原主工作树 staging 仍为空，既有 5 个 GitNexus skill、`AGENTS.md`、`CLAUDE.md`、docs-site gitlink 和知识库草稿均保留，未被发布收尾修改或清理。
