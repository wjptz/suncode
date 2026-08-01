# 发布 Suncode v0.6.11

## 目标

准备、验证并通过项目既有 Git tag → GitHub Actions → npm 链路发布稳定补丁版 Suncode v0.6.11，使 `@wjptz/suncode` 与 `@wjptz/suncode-core` 同步升级，并向用户说明 v0.6.10 之后已落地的平台、记忆检索、channel 与安全性改进。

## 已核实现状

- CLI 与 Core 本地版本均为 `0.6.10`；npm 的 `latest` 也均为 `0.6.10`。
- GitHub 最新 tag 为 `v0.6.10`，尚无 `v0.6.11`。
- `v0.6.10..HEAD` 共 11 个主仓提交，其中两个提交包含产品代码，其余为任务、日志、checkpoint 或工作流维护。
- 主仓 `main` 相对 `origin/main` ahead 11。
- `docs-site` 当前提交相对其 `origin/main` ahead 1；`marketplace` ahead 2，相关提交均尚未到达远端。
- 当前工作树有 8 个与发布无关的既有修改/未跟踪路径。既有 `release.js` 的 `git add -A` 会误收其中多数路径，因此不得直接在当前脏工作树执行发布命令。
- 仓库已有 `0.6.10` migration manifest，但尚无 `0.6.11` manifest；docs-site 当前也没有 changelog 目录或导航入口。

## 范围

### 包含

- 基于 `v0.6.10..HEAD` 的真实产品差异创建 `0.6.11` migration manifest。
- 创建 v0.6.11 中英文 changelog，并在 docs-site 导航中提供可达入口。
- 核验并提交发布所需的主仓、docs-site 与 marketplace 变更。
- 运行 manifest continuity、稳定 patch 的等价文档注册检查、版本一致性、lint、typecheck、测试、构建与 npm pack 烟测等最小完整质量门。
- 在最终 go/no-go 批准后，依次推送两个子仓提交、主仓准备提交，并从干净临时 clone 执行官方 patch release 命令。
- 监控 GitHub Actions 发布工作流，并验证 Git tag、两包 npm 版本及 `latest` dist-tag。
- 发布完成后记录结果并归档 Trellis 任务。

### 不包含

- 修改或提交 8 个与本次发布无关的用户工作区路径。
- 新功能、重构或与发布无关的文档整理。
- beta/rc 生命周期或迁移脚本；本次为稳定 patch，预计 `migrations: []`、`recommendMigrate: false`。
- 本地执行 `npm publish`、移动既有 tag、改写 Git 历史或强推。
- 补建历史 GitHub Release 页面；本次以项目既有 tag/CI/npm 发布链路为准。
- 为了本次发布恢复所有历史 changelog 页面；仅建立 v0.6.11 的双语页面和当前可达导航。

## 功能与内容要求

- manifest 版本必须为 `0.6.11`，语义与真实差异一致，不把 journal、task archive、checkpoint 或纯内部同步工作列为用户功能。
- changelog 重点覆盖：
  - Grok、Kimi、Oh My Pi 平台支持；
  - `suncode platforms --json`、任务状态与 Codex sandbox 控制；
  - ZCode SQLite 只读记忆检索与 session fan-out；
  - channel、update、uninstall、模板下载、hook/frontmatter/session context 的安全性与可靠性修复。
- 中英文 changelog 章节结构必须 1:1；技术名词、命令和标志保持一致。
- docs-site 的 `docs.json` 必须同时注册英文与中文页面，并提供实际可点击的 Changelog 导航；不能只满足字符串 guard。
- CLI/Core 的版本提交与 tag 必须由现有 `pnpm release` 脚本生成，不手工发布 npm 包。

## 约束与安全边界

- 发布前不得覆盖、暂存、提交或 stash 用户的 8 个既有脏路径。
- 发布准备阶段只按明确路径暂存本任务文件；提交前运行 GitNexus `detect_changes` 并检查 staged diff。
- 子仓提交必须先于主仓 tag 到达各自远端，避免 tag 指向不可获取的 gitlink。
- 所有本地准备与质量门完成后，必须再次向用户展示 go/no-go 证据并取得最终发布批准，才可 push/tag/触发 CI。
- 最终发布在全新、干净、递归检出子模块的临时 clone 中执行，避免当前工作树被 `git add -A` 污染。
- 任一发布前质量门失败即停止；不得绕过检查。

## 验收标准

- [ ] `packages/cli/src/migrations/manifests/0.6.11.json` 存在、schema 合法、内容基于 `v0.6.10..HEAD`，且无虚构 migration。
- [ ] docs-site 存在 `changelog/v0.6.11.mdx` 与 `zh/changelog/v0.6.11.mdx`，结构对齐且可从导航访问。
- [ ] docs-site、marketplace 与主仓的待发布提交均经过明确 diff 审查；8 个用户脏路径保持原样且未进入任何发布提交。
- [ ] manifest continuity、稳定 patch 的等价 changelog/navigation 检查、版本一致性、lint、typecheck、测试、构建、pack/安装烟测全部通过；未执行项必须有明确原因并在 go/no-go 中标为阻塞。
- [ ] 最终发布前获得用户对 push/tag/CI/npm 外部变更的单独明确批准。
- [ ] `v0.6.11` tag 指向包含全部发布准备内容的主仓提交链，GitHub Actions publish workflow 成功。
- [ ] npm 上 `@wjptz/suncode@0.6.11` 与 `@wjptz/suncode-core@0.6.11` 均可见，且两者 `latest` 均为 `0.6.11`。
- [ ] 发布后当前工作区的 8 个既有脏路径内容和脏状态未被发布流程改变。
- [ ] 发布结果、关键提交、tag、workflow 与 npm 验证证据写入任务记录，任务归档。

## 风险

- **工作树污染（高）**：直接运行 `release.js` 会把无关用户修改收入 pre-release commit。通过干净临时 clone 隔离。
- **子模块不可达（高）**：当前 docs-site 与 marketplace HEAD 不在远端。最终发布必须按子仓 → 主仓 → tag 的顺序推送。
- **文档导航缺失（中）**：现有 guard 只检查文件名字符串，可能在页面不可达时误通过。需人工检查 `docs.json` 导航结构。
- **patch guard 缺口（中）**：`check-docs-changelog.js` 只接受 beta/rc/promote，稳定 patch 无可用模式；本次用等价的文件存在性、双语 page entry 和 navbar href 断言补足，不伪装成其他 release track。
- **发布后 CI 失败（高）**：tag 已推送后不移动 tag、不本地补发；先诊断并修复工作流/凭据问题，必要时采用新的 patch 版本处理已发布内容问题。
- **npm/GitHub 权限（高）**：本地只读核验不能证明 CI secret 有效；以 workflow 实际结果为准。

## 决策

- 版本：稳定 patch `0.6.11`。
- 发布通道：现有 tag 触发的 GitHub Actions，禁止本地 `npm publish`。
- migration：当前差异不需要数据/模板迁移，manifest 采用 `breaking: false`、`recommendMigrate: false`、`migrations: []`；实施时以 schema 与 diff 复核为准。
- 工作区隔离：保留当前脏工作树，在最终批准后从已推送准备提交创建干净临时 clone 执行 `pnpm release`。
- GitHub Release 页面：不作为本次验收项；tag、CI 与 npm 是既有正式发布事实来源。
