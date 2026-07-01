# Suncode

Suncode is an engineering workflow layer for AI coding agents. It keeps project specs, task context, workflow state, and session memory in your repository so agents can work with durable project knowledge instead of starting from scratch every time.

[简体中文](./README_CN.md) · [Documentation](https://github.com/wjptz/suncode-docs) · [Marketplace](https://github.com/wjptz/suncode-marketplace)

[![npm version](https://img.shields.io/npm/v/@wjptz/suncode.svg?style=flat-square&color=2563eb)](https://www.npmjs.com/package/@wjptz/suncode)
[![npm downloads](https://img.shields.io/npm/dw/@wjptz/suncode?style=flat-square&color=cb3837&label=downloads)](https://www.npmjs.com/package/@wjptz/suncode)
[![license](https://img.shields.io/badge/license-AGPL--3.0-16a34a.svg?style=flat-square)](https://github.com/wjptz/suncode/blob/main/LICENSE)

## What Suncode Provides

- **Project specs**: keep coding conventions and architectural rules in versioned project files.
- **Task workflow**: structure AI work around PRDs, implementation context, checks, and task state.
- **Session memory**: preserve useful session notes so future work can reuse real project context.
- **Multi-platform setup**: generate integration files for the AI coding tools you use.
- **Optional Hub workflow**: connect local project tasks to Suncode Hub for team requirement and task coordination.

## Requirements

- Node.js 18+
- Python 3.9+
- git

## Install

```bash
npm install -g @wjptz/suncode@latest
```

For local development in this repository:

```bash
pnpm install
pnpm --dir packages/cli build
pnpm --dir packages/cli link --global
```

## Quick Start

Initialize Suncode in a repository:

```bash
suncode init -u your-name
```

Initialize only the platforms you use:

```bash
suncode init --cursor --opencode --codex -u your-name
```

Then follow the generated workflow files and commands in the target repository.

## Common Commands

```bash
suncode --help
suncode init --help
suncode update --help
suncode uninstall --help
```

Hub commands:

```bash
suncode hub init
suncode hub login
suncode hub state
suncode hub logout
```

## Development Checks

```bash
pnpm --dir packages/cli typecheck
pnpm --dir packages/cli lint
pnpm --dir packages/cli test
pnpm --dir packages/cli build
```

## Resources

- [Documentation](https://github.com/wjptz/suncode-docs)
- [Marketplace](https://github.com/wjptz/suncode-marketplace)
- [npm package](https://www.npmjs.com/package/@wjptz/suncode)
- [GitHub issues](https://github.com/wjptz/suncode/issues)
- [License](https://github.com/wjptz/suncode/blob/main/LICENSE)
