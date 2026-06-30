# Docs-site Suncode migration

## Goal

将 `docs-site` 从 Trellis 文档站迁移为精简的 Suncode 文档站，只保留“开始使用/Start Here”和“进阶/Advanced”两类文档，删除其他模块，并保证保留页面中的安装、入门、日常使用、资源链接和图片资产不再指向旧品牌或旧 npm 包。

## Background

- `docs-site` 是独立 Git 子仓，远端为 `https://github.com/wjptz/suncode-docs.git`。
- `docs-site` 是 Mintlify 文档站，`docs-site/package.json` 标记为 `private: true`，不参与 npm 发布。
- 当前 npm 已发布：
  - `@wjptz/suncode@0.6.6`
  - `@wjptz/suncode-core@0.6.6`
- `docs-site/docs.json` 已部分迁移为 `Suncode Docs`，但导航仍包含 Use Cases、Resource Marketplace、Community、Changelog 等非保留模块。
- 面向新用户的页面仍存在旧安装命令，例如：
  - `docs-site/quickstart.mdx`: `npm install -g @mindfoldhq/trellis`
  - `docs-site/start/install-and-first-task.mdx`: `npm install -g @mindfoldhq/trellis@latest`
  - `docs-site/advanced/resources.mdx`: npm 链接指向 `@mindfoldhq/trellis`
- 用户已确认只保留“开始使用/Start Here”和“进阶/Advanced”模块，其他模块直接删除。
- `docs-site/images/` 和 `docs-site/logo/` 存在图片资产，需检查是否含 Trellis 字样、旧 logo、旧命令截图或旧 GitHub 组织信息；被删除模块专用图片应一并删除。

## Requirements

### R1. 新用户路径 Suncode 化

- 更新首页、quickstart、安装与首个任务、日常使用、资源页等入口文档。
- 将当前推荐安装命令统一为：

```bash
npm install -g @wjptz/suncode@latest
```

- 将当前推荐命令统一为 `suncode ...`，例如 `suncode init`、`suncode update`、`suncode upgrade`。
- 不再在新用户路径中推荐 `@mindfoldhq/trellis`、`trellis init`、`trellis update`、`trellis upgrade`。

### R2. 导航精简

- `docs-site/docs.json` 英文导航只保留：
  - `Start Here`
  - `Advanced`
- `docs-site/docs.json` 中文导航只保留：
  - `开始使用`
  - `进阶`
- 删除 navbar 中指向 Changelog、Tech Blog 等非保留模块的链接。
- 不再新增或保留 changelog 模块；`v0.6.6` 发布信息可在保留页面中轻量说明，但不作为独立模块。

### R3. 删除非保留模块

- 删除英文非保留模块目录和页面，包括但不限于：
  - `ai-tools/`
  - `api-reference/`
  - `blog/`
  - `changelog/`
  - `concepts/`
  - `contribute/`
  - `essentials/`
  - `guides/`
  - `marketplace/`
  - `showcase/`
  - `skills-market/`
  - `snippets/`
  - `templates/`
  - `use-cases/`
- 删除中文 `zh/` 下对应的非保留模块，只保留 `zh/index.mdx`、`zh/start/`、`zh/advanced/`。
- 保留站点运行必需文件，例如 `docs.json`、`index.mdx`、`styles.css`、`terminal-demo.js`、`favicon.svg`、`logo/`、必要脚本和 package 配置。

### R4. 图片资产清理

- 盘点 `docs-site/images/`、`docs-site/logo/` 以及所有文档图片引用。
- 带 Trellis 字样、旧 npm 包名、旧 logo、旧 GitHub 组织或旧命令截图的图片，必须处理：
  - 能替换为 Suncode 图片的替换。
  - 暂无替代图的，从当前新用户页面移除或改成文字/代码块说明。
  - 被删除模块专用图片直接删除。

### R5. 历史内容边界

- 因非保留模块将删除，历史 changelog、blog、showcase、use-case 等不再作为当前文档站内容保留。
- 如某些历史页面因链接兼容不得不保留，也必须移出导航并避免出现在当前用户路径。
- 当前推荐安装、当前入门、当前资源必须以 Suncode 为准。

## Acceptance Criteria

- [x] `docs-site` 当前新用户路径不再出现 `@mindfoldhq/trellis` 安装命令。
- [x] `docs-site` 当前新用户路径不再推荐 `trellis init/update/upgrade`。
- [x] `docs-site/docs.json` 英文导航只保留 `Start Here` 和 `Advanced`。
- [x] `docs-site/docs.json` 中文导航只保留 `开始使用` 和 `进阶`。
- [x] navbar 不再链接 Changelog、Tech Blog、Marketplace、Showcase、Use Cases 等非保留模块。
- [x] 非保留模块目录和页面已删除，或有明确理由作为非导航兼容文件保留。
- [x] `docs-site/images/` 和 `docs-site/logo/` 已完成 Trellis 品牌图片盘点，误导性图片已替换或删除。
- [x] `docs-site` lint 通过，或明确记录无法运行的原因。
- [x] `docs-site` 子仓提交独立于主仓任务元数据提交。

## Out of Scope

- 不修改 npm 发布版本。
- 不修改主仓 CLI 运行时行为。
- 不重新设计整个文档信息架构，除非当前导航阻碍 Suncode 用户理解。

## Open Questions

- 无阻塞问题。
