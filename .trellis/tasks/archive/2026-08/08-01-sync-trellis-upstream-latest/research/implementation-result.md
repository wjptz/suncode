# Trellis v0.6.9-v0.6.11 实施结果

## 状态

截至 2026-08-01，A1-A15 已按 Suncode identity 与 ownership contract 完成
语义采纳，质量门已通过，具备形成 implementation commit 的条件。

本文件记录 implementation commit 前的可复现证据。同步 ledger 与 checkpoint
仍停在官方 `v0.6.8`，必须等 implementation commit 产生后再单独推进。

## 采纳结果

| 行为包 | 结果摘要 |
|---|---|
| A1 | Python、OpenCode、Pi 统一 byte budget、UTF-8 边界、binary reference、artifact 顺序；详细 notice 也计预算，最终以单一固定终止提示阻止无界增长 |
| A2 | live `.trellis` 使用 `no-trellis`，发布模板使用 `no-suncode`；仅跳过当前 user turn breadcrumb |
| A3 | task generic meta/set-meta、孤儿 task tree、结构化 journal flags 已接入 live/template |
| A4 | Codex flat TOML model keys 在 init/update 中保留，静态模板只提供注释 hint |
| A5 | Snow 作为 class-1 平台接入 registry、init、update、uninstall、hash tracking 与模板 |
| A6 | channel explicit/auto trusted roots、realpath containment、agent/context/OMP 一致接入；读取前重新执行 lstat→realpath→stat/read |
| A7 | `.gitattributes` additive-only journal union；Suncode 与 Trellis 规则按精确 identity 区分 |
| A8 | Kimi research 改用可写 built-in coder，并限制 research 范围 |
| A9 | active task 精确清理、Codex saved hook fallback、Python 3.9 CI gate 已采纳 |
| A10 | Pi invoking model 继承与 `max` thinking 全链路接入 |
| A11 | Codex terminal failure、retry warning、去重、new-turn reset 与 done 抑制闭合 |
| A12 | terminal turn 后 idle timer 继续生效，仅由 cancel/shutdown/child exit 阻止 |
| A13 | 自动 polyrepo scan 限 8 个 repo，Git probe 限时且失败不能伪装 clean |
| A14 | 受影响 Python hook 在首次 stdin read 前 best-effort UTF-8 reconfigure |
| A15 | 配置平台以 template hash / ownership marker 识别，不认领裸共享目录 |

## 复审中追加的修复

- Snow 将 `.snow/SNOW.md` 作为受管文件时，update backup collector 现在同时接受
  文件根与目录根；对应 init/update/uninstall 生命周期测试通过。
- `.gitattributes` 判重只接受精确 `.suncode/workspace/*/journal-*.md` 规则，
  Trellis 同类规则不会误抑制 Suncode 规则。
- 上游逐条 binary/index notice 可绕过 total budget 的行为已收敛：详细 notice
  放不下时只输出一次固定终止提示，并停止后续物化；Python/OpenCode/Pi
  contract tests 同步覆盖。
- channel context read 在初始 jail 后再次执行真实路径 containment，并从验证后的
  realpath 做 `stat/read`；静态顺序断言防止后续回退。

## 验证证据

| 门禁 | 结果 |
|---|---|
| Python 3.9 syntax | uv-managed CPython 3.9.25；`git ls-files --recurse-submodules '*.py'` 全部 `py_compile` 通过，60 秒硬超时 |
| BasedPyright | 0 error、64 warning；warning 均为既有 `common/__init__.py` / `git_context.py` re-export 未使用 |
| ESLint | root core + CLI lint 通过 |
| TypeScript | root typecheck 通过；core build + CLI `tsc --noEmit` |
| Build | root core→CLI build 通过 |
| Full tests | core 332 passed、1 existing skipped；CLI 1695/1695 passed；60 秒硬超时内完成 |
| A1/A6 focused | Python/OpenCode/Pi parity 与 trusted-root 5 files、109/109 tests passed |
| Template output | 4 个必需 build outputs 存在；220 个非 TypeScript source template 与 dist byte-identical |
| Whitespace | `git diff --check` 通过 |
| GitNexus | `detect_changes(scope=compare, base_ref=main)`：CRITICAL，163 changed symbols、36 affected flows、81 indexed files；与本轮高 fan-out 范围一致 |

GitNexus CRITICAL 不是低风险证明。已逐项抽查 `run_git`、platform detection、
update/migration、Codex adapter、channel context/spawn、idle supervisor 等高扇出入口，
并由 full suite 与行为包定向测试覆盖。报告包含不会纳入提交的 AGENTS/CLAUDE
用户改动，且对未跟踪新模块并不完备，因此 staged 白名单仍是最终提交边界。

## 明确未执行 / 未改变

- 未运行或修改脏的 `docs-site`、`marketplace` 子模块；它们不属于本轮证据。
- 未运行全仓 Prettier 写盘；诊断性 `prettier --check src test` 会命中 284 个
  既有未格式化文件，CI 也不包含该门禁。新增/直接编辑的 TS/JS 测试已定向格式化，
  ESLint 和 `git diff --check` 均通过。
- 未修改 core 源码、package version、release manifest、tag 或 npm identity；
  `packages/core` 仍通过完整 build/test。
- 未修改 sync ledger/state；checkpoint 仍为官方 `v0.6.8`。

## 用户工作保护

implementation commit 必须排除：

- `.claude/skills/gitnexus/**`
- `AGENTS.md`
- `CLAUDE.md`
- `docs-site`
- `marketplace`
- `drafts/kb-design-philosophy.md`

其余同步相关主仓文件与本任务 artifacts 使用显式路径白名单暂存；提交前再次
核对 `git diff --cached --name-only` 与 `git diff --cached --stat`。
