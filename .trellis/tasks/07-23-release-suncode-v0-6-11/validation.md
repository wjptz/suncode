# Suncode v0.6.11 发布前验证记录

## 发布产物

- Migration manifest：`packages/cli/src/migrations/manifests/0.6.11.json`
- 英文 changelog：`docs-site/changelog/v0.6.11.mdx`
- 中文 changelog：`docs-site/zh/changelog/v0.6.11.mdx`
- docs-site 导航：`docs-site/docs.json`
- docs-site 本地提交：`2e7e5dc`（`docs: add v0.6.11 changelog`）
- 主仓发布准备提交：`5c23605e`（`chore(release): prepare v0.6.11`）

## 定向检查

| 检查 | 结果 |
| --- | --- |
| Manifest/docs JSON parse | 通过 |
| `git diff --check` | 通过 |
| 三个发布文件 Prettier | 通过 |
| 双语 changelog Markdownlint | 通过，0 errors |
| docs-site 全量 lint | 通过，42 files，0 errors |
| `check-shared-groups.mjs` | 通过 |
| 稳定 patch 页面、双语 nav entry、navbar href 等价断言 | 通过 |
| Manifest continuity | 通过：139 local / 5 published / 21 historical gaps whitelisted |
| docs-site staged GitNexus `detect_changes` | `low`，3 files，24 sections，0 affected processes |

`check-docs-changelog.js` 仅支持 beta/rc/promote；稳定 patch 没有合法 `--type`。本次没有伪装成其他 track，而是直接断言两个 MDX 文件、两个 `docs.json` page entry 和 `/changelog/v0.6.11` navbar href。

## 主仓质量门

| 命令/检查 | 结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm build` | 通过；`0.6.11.json` 已复制到 CLI dist |
| `pnpm typecheck` | 通过 |
| `timeout 60s pnpm test` | 通过；Core 332 passed / 1 skipped，CLI 1512 passed |
| `release-preflight check-versions` | 通过；当前 Core/CLI 均为 0.6.10 |
| `release-preflight verify-packed-cli` | 通过；packed CLI 精确依赖 Core 0.6.10 |
| `release-preflight publish-plan --json` | 通过；当前 0.6.10 两包均已在 npm，符合发布前基线 |
| CLI `npm pack --dry-run --json` | 通过；904 entries |
| 主仓 staged GitNexus `detect_changes` | `low`，9 files，0 symbols，0 affected processes |

目标版本 0.6.11 的 package version、精确 Core 依赖和 tag 一致性将在最终批准后的干净 clone 中，由现有 release 脚本 bump 后再次验证。

## Tarball 安装烟测

- 临时目录：`/tmp/suncode-v0.6.11-smoke-K4omjP`
- 实际安装：本地 Core/CLI tarball（版本基线 0.6.10，代码内容与待发提交一致；最终版本号由 release 脚本生成）。
- tarball 已确认包含：
  - `dist/migrations/manifests/0.6.11.json`
  - Grok/Kimi implement agent 模板
  - Oh My Pi extension
  - ZCode adapter 与 zero-dependency SQLite reader
- `suncode init -u smoke --yes --grok --kimi --omp --zcode`：通过。
- `suncode platforms --json`：返回 `omp`、`zcode`、`grok`、`kimi` 及其 `displayName`/`configDir`。
- `suncode update --dry-run`：通过，报告 `Already up to date!`。
- update 的可选 npm advisory 查询在烟测环境中未取到网络结果，但不影响 dry-run；独立 `publish-plan` 重试已成功。

## 烟测环境恢复记录

第一次临时应用初始化使用了 `npm init -y --prefix <tmp>`。npm 忽略该命令的 `--prefix`，向主仓根 `package.json` 追加了初始化字段。后续烟测立即停止，并通过精确 patch 删除仅由该命令增加的字段。

恢复后证据：

- `git diff --exit-code -- package.json`：通过。
- `package.json` 与 `pnpm-lock.yaml` 均不在 `git status --short` 中。
- 后续烟测直接从 tarball 安装到已有临时目录，不再执行 `npm init`。

## Go/no-go 快照

本地发布准备与验证结论：**GO**。正式发布仍须单独取得用户最终批准。

下表是写入本记录前的发布内容快照；提交本记录会在主仓再追加一个只含任务证据的本地提交，因此最终 ahead 数会增加 1，但发布内容提交、两个 gitlink 与所有外部基线不变。

| 仓库 | 本地目标 | 相对 `origin/main` | 工作树 | 远端可达性 |
| --- | --- | --- | --- | --- |
| 主仓发布内容 | `5c23605e` | ahead 12 | 仅保留 8 个用户原有脏路径；发布文件均已提交 | 否 |
| docs-site | `2e7e5dc` | ahead 2 | clean | 否 |
| marketplace | `62f7bf9` | ahead 2 | clean | 否 |

- 三个仓库均已在 fresh fetch 后运行 `git diff --check` 与 `git diff --cached --check`，通过。
- 主仓 `HEAD` 不在 `origin/main`；docs-site 与 marketplace 的 `HEAD` 也不在各自 `origin/main`。
- 主仓 gitlink 精确指向 docs-site `2e7e5dcb5649aa9d15e0d423cd384bfcb9798e96` 和 marketplace `62f7bf94df10557936b01708f431013c66538d22`。
- npm 当前基线未变化：`@wjptz/suncode` 和 `@wjptz/suncode-core` 的版本与 `latest` 均为 `0.6.10`。
- 本地不存在 `v0.6.11` tag；尚未执行任何 push、tag 或 npm publish。

正式批准后的外部动作顺序：先推送 docs-site，再推送 marketplace，随后推送主仓；从 `origin/main` 创建全新递归 clone，在其中运行官方稳定 patch release；最后监控 GitHub Actions，并验证两个 npm 包及 `latest` 均到达 `0.6.11`。如任一步失败，停止后续阶段，保留已成功事实并按 `design.md` 的恢复策略报告，不移动或重打 tag。

## 剩余批准门

- 用户已明确批准正式发布 v0.6.11；批准后的外部动作已按既定顺序完成。

## 正式发布结果

| 证据 | 结果 |
| --- | --- |
| docs-site 远端 | `origin/main=2e7e5dcb5649aa9d15e0d423cd384bfcb9798e96` |
| marketplace 远端 | `origin/main=62f7bf94df10557936b01708f431013c66538d22` |
| 主仓发布准备远端 | `origin/main=be52b89e3f723123a0ce8210a5014913a1260f44`，随后由官方 release 追加版本提交 |
| 版本提交 | `275618c62b5f9b93b0cca6babc9e4e2c0dbcdc68`（`0.6.11`） |
| Git tag | `v0.6.11`，精确指向 `275618c62b5f9b93b0cca6babc9e4e2c0dbcdc68` |
| 主仓远端 | 发布时 `origin/main=275618c62b5f9b93b0cca6babc9e4e2c0dbcdc68`，包含 tag 提交 |
| GitHub Actions | `Publish to npm` run `29973603976`，结论 `success` |
| npm Core | `@wjptz/suncode-core@0.6.11` 可见，`latest=0.6.11` |
| npm CLI | `@wjptz/suncode@0.6.11` 可见，`latest=0.6.11` |

Workflow URL：<https://github.com/wjptz/suncode/actions/runs/29973603976>

GitHub Actions 中以下关键步骤全部成功：版本/tag 对齐、typecheck、build、Core/CLI tests、packed CLI 精确依赖、publish plan、Core publish、CLI publish，以及公共 npm registry 回读。

## 干净 clone 发布恢复记录

第一次递归 clone 继承全局 `core.autocrlf=true`，将严格模板文件检出为 CRLF，导致 frontmatter 与字节级模板断言失败。失败发生在版本 bump/tag 前；clone 保持 clean，版本仍为 0.6.10，没有创建或推送 tag。

第二个 clone 显式使用 `core.autocrlf=false`，行尾相关失败全部消失。仅安装依赖后，CLI 测试仍因 Core `dist` 尚未构建而无法解析 `@wjptz/suncode-core/{channel,task,mem}`。运行 root `pnpm build` 后：

- CLI：63 files / 1512 tests 全部通过。
- 官方 release 内 Core：20 files / 332 passed / 1 skipped。
- 官方 release 内 CLI：63 files / 1512 passed。
- 官方 release 在 60 秒硬超时内完成版本 bump、commit、tag 与 push。

这两个可复现前置已写入 `.trellis/spec/cli/backend/release-process.md`：正式 clone 必须显式保持 LF，并在 CLI 测试/release 前先运行 root build。

## 发布包独立验证

- `release-preflight verify-npm --package all`：通过；两个包及 `latest` 均为 0.6.11。
- 从公共 registry 全新安装 `@wjptz/suncode@0.6.11`：通过，共安装 58 packages。
- 安装后的元数据：CLI `0.6.11`、Core `0.6.11`、CLI 对 Core 的依赖精确为 `0.6.11`。
- 发布包包含 `dist/migrations/manifests/0.6.11.json`。
- `suncode --version`：`0.6.11`。
- `suncode platforms --json`：在空项目中正常返回 `{ "platforms": [] }`。

## 原工作区发布后核验

- 已 fetch `origin/main` 与 tags；原工作区本地 `main` 仅落后版本提交 1 个 commit，未执行 merge/reset/checkout。
- 原工作区识别到 `v0.6.11`，且 tag SHA 为 `275618c62b5f9b93b0cca6babc9e4e2c0dbcdc68`。
- 5 个 `.claude/skills/gitnexus/**/SKILL.md`、`AGENTS.md`、`CLAUDE.md` 与未跟踪 `drafts/kb-design-philosophy.md` 的脏状态保持不变。
- 没有新增 staged 文件，也没有把用户改动收入任何发布提交。
