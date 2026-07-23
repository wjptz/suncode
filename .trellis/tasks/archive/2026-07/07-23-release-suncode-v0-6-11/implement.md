# Suncode v0.6.11 实施计划

## Phase 1：发布产物准备（需实施批准）

- [x] 再次核对 `v0.6.10..HEAD` 产品差异与 manifest schema。
- [x] 新增 `0.6.11.json` migration manifest。
- [x] 新增中英文 v0.6.11 changelog。
- [x] 更新 docs-site `docs.json` 的双语 Changelog 组与 navbar 入口。
- [x] 运行 JSON、MDX、双语结构、manifest continuity 与稳定 patch 等价文档注册检查。
- [x] 审查 docs-site diff，并在子仓创建精确发布提交 `2e7e5dc`。
- [x] 审查主仓 manifest 与 gitlink diff，并创建精确发布准备提交 `5c23605e`。
- [x] 不触碰 marketplace 内容；复核其既有 ahead 2 提交是 v0.6.11 所需的可达前置。

## Phase 2：完整发布前验证（不改变远端）

- [x] 运行 CLI/Core 定向测试；后端测试设置 60 秒硬超时。
- [x] 运行 root lint、typecheck、test、build。
- [x] 运行 release preflight、版本一致性和 pack 计划检查。
- [x] 构建两包 tarball，核对内容并执行临时安装/CLI 烟测。
- [x] 在主仓运行 GitNexus `detect_changes`：`low`，9 files，0 symbols，0 affected processes。
- [x] 对主仓、docs-site、marketplace 分别运行 `git diff --check`、status、log 与远端可达性核验。
- [x] 对照发布前快照确认 8 个用户脏路径未改变、未暂存、未提交。
- [x] 汇总 go/no-go：本地质量门为 GO；三个仓库的待发提交均尚未从对应 `origin/main` 可达，须获最终批准后按子仓到主仓顺序推送。

## Phase 3：正式发布（需单独最终批准）

- [x] 推送 `docs-site/main`，确认目标 SHA `2e7e5dcb` 可从远端获取。
- [x] 推送 `marketplace/main`，确认目标 SHA `62f7bf94` 可从远端获取。
- [x] 推送主仓 `main` 的全部准备提交，确认远端包含两个 gitlink。
- [x] 从 `origin/main` 创建全新递归临时 clone，确认主仓和子模块 clean、SHA 一致；正式执行 clone 显式使用 LF checkout。
- [x] 在临时 clone 安装锁定依赖、运行 root build 并复核 release preflight。
- [x] 执行官方稳定 patch release 命令，由脚本生成版本提交 `275618c6`、`v0.6.11` tag 并 push。
- [x] 记录版本提交与 tag SHA，确认 tag 触发 publish workflow `29973603976`。

## Phase 4：监控与发布后验证

- [x] 监控 publish workflow 到最终成功；所有 publish 与公共 npm 回读步骤通过。
- [x] 验证 GitHub tag `v0.6.11`、`origin/main` 与版本提交均为 `275618c62b5f9b93b0cca6babc9e4e2c0dbcdc68`。
- [x] 验证 npm 两包均存在 `0.6.11`，且 `latest` 同步指向 `0.6.11`。
- [x] 从公共 npm 全新安装并核验 CLI/Core 版本、精确依赖、manifest 与 CLI 可执行性。
- [x] fetch 原工作区远端引用并确认用户脏路径状态未被改变；未强制更新当前工作树。
- [x] 将 workflow、tag、npm、提交与验证结果写入任务记录。
- [x] 完成 Trellis 质量门、journal 与任务归档。

## 计划验证命令族

具体命令在实施时以 `package.json` 和发布规范中的现行脚本为准，至少覆盖：

```bash
node packages/cli/scripts/check-manifest-continuity.js
# stable patch: assert both MDX files, both docs.json page entries, and navbar href
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
pnpm run release:preflight
pnpm run verify:pack
```

`check-docs-changelog.js` 当前只支持 beta/rc/promote，不能用于稳定 patch。v0.6.11 使用等价的 Node 断言检查双语 MDX、两个 page entry 和 navbar href，结果记录在 `validation.md`；不得伪装为 promote 或因脚本缺口跳过质量门。

## 提交边界

- docs-site 提交：仅双语 v0.6.11 changelog 与 `docs.json`。
- marketplace：不新增发布内容，只推送当前已核验的两个既有提交。
- 主仓发布准备提交：manifest、docs-site gitlink、必要的任务记录；不得包含用户脏路径。
- 版本提交：仅 CLI/Core `package.json` 版本变更，由 release 脚本在干净 clone 中创建。
- tag：仅 `v0.6.11`，禁止重打或移动。
