# Suncode

Suncode 是面向 AI 编码 Agent 的工程化工作流层。它把项目规范、任务上下文、工作流状态和会话记忆保存在仓库里，让 Agent 不必每次都从零开始理解项目。

[English](./README.md) · [文档](https://github.com/wjptz/suncode-docs) · [Marketplace](https://github.com/wjptz/suncode-marketplace)

[![npm version](https://img.shields.io/npm/v/@wjptz/suncode.svg?style=flat-square&color=2563eb)](https://www.npmjs.com/package/@wjptz/suncode)
[![npm downloads](https://img.shields.io/npm/dw/@wjptz/suncode?style=flat-square&color=cb3837&label=downloads)](https://www.npmjs.com/package/@wjptz/suncode)
[![license](https://img.shields.io/badge/license-AGPL--3.0-16a34a.svg?style=flat-square)](https://github.com/wjptz/suncode/blob/main/LICENSE)

## Suncode 提供什么

- **项目规范**：把编码约定、架构规则和团队经验保存为可版本化的项目文件。
- **任务工作流**：围绕 PRD、实现上下文、检查上下文和任务状态组织 AI 开发。
- **会话记忆**：记录有价值的会话信息，让后续工作能复用真实项目上下文。
- **多平台初始化**：为常用 AI coding 工具生成对应集成文件。
- **可选 Hub 工作流**：将本地项目任务连接到 Suncode Hub，用于团队需求和任务协同。

## 前置要求

- Node.js 18+
- Python 3.9+
- git

## 安装

```bash
npm install -g @wjptz/suncode@latest
```

本仓库本地开发安装：

```bash
pnpm install
pnpm --dir packages/cli build
pnpm --dir packages/cli link --global
```

## 快速开始

在项目仓库中初始化：

```bash
suncode init -u your-name
```

只初始化你实际使用的平台：

```bash
suncode init --cursor --opencode --engineer --codex -u your-name
```

随后按目标仓库中生成的工作流文件和命令使用。

## 常用命令

```bash
suncode --help
suncode init --help
suncode update --help
suncode uninstall --help
```

Hub 命令：

```bash
suncode hub init
suncode hub login
suncode hub state
suncode hub logout
```

## 开发检查

```bash
pnpm --dir packages/cli typecheck
pnpm --dir packages/cli lint
pnpm --dir packages/cli test
pnpm --dir packages/cli build
```

## 资源

- [文档](https://github.com/wjptz/suncode-docs)
- [Marketplace](https://github.com/wjptz/suncode-marketplace)
- [npm 包](https://www.npmjs.com/package/@wjptz/suncode)
- [GitHub Issues](https://github.com/wjptz/suncode/issues)
- [License](https://github.com/wjptz/suncode/blob/main/LICENSE)
