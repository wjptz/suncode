# Suncode v0.6.11 发布前验证记录

## 发布产物

- Migration manifest：`packages/cli/src/migrations/manifests/0.6.11.json`
- 英文 changelog：`docs-site/changelog/v0.6.11.mdx`
- 中文 changelog：`docs-site/zh/changelog/v0.6.11.mdx`
- docs-site 导航：`docs-site/docs.json`
- docs-site 本地提交：`2e7e5dc`（`docs: add v0.6.11 changelog`）

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

## 尚待 go/no-go 前完成

- 主仓 staged GitNexus `detect_changes`。
- 主仓精确 release-prep 提交。
- 三个仓库最终 status/log/remote reachability 核验。
- 最终外部动作清单与用户发布批准。
