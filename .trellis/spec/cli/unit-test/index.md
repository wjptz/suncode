# Unit Test Guidelines

> Testing conventions and patterns for this project.

---

## Overview

This project uses **Vitest** with TypeScript ESM. Tests live in a centralized `test/` directory mirroring `src/` structure. The goal is fast, reproducible tests with minimal mocking.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Conventions](./conventions.md) | File naming, structure, assertion patterns, test isolation (env-leak guard), when to write tests | Done |
| [Mock Strategies](./mock-strategies.md) | What to mock, how, and the minimal mocking principle | Done |
| [Integration Patterns](./integration-patterns.md) | Function-level integration tests for commands | Done |

---

## Quick Reference

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# Run a specific test file
pnpm test test/commands/init.integration.test.ts

# Run with coverage report (terminal + HTML)
pnpm test:coverage
```

---

## Code Coverage

Coverage is generated automatically via `@vitest/coverage-v8`. Configuration is in `vitest.config.ts`.

- **Terminal**: `pnpm test:coverage` prints per-file coverage table
- **HTML report**: `./coverage/index.html` (gitignored, generated on demand)
- **Source scope**: `src/**/*.ts` (excludes `src/cli/index.ts`)

Do **not** maintain a manual coverage table — always run `pnpm test:coverage` for the real numbers.

---

## CI / Pipeline Strategy

| Stage | What Runs | Rationale |
|-------|-----------|-----------|
| **pre-commit** (husky) | `lint-staged` (eslint + prettier) | Keep fast; don't add tests here or developers will skip with `--no-verify` |
| **CI** (GitHub Actions, PR gate) | Python 3.9 syntax → TS/Python typecheck → lint → build → test → dist verification | CLI integration tests spawn built `dist`; Python templates must remain 3.9-compatible |

**When to reconsider**: If total test time exceeds 5 minutes, split into fast (unit) and slow (integration) stages. Currently unnecessary.

## 场景：跨运行时发布质量门

### 1. 范围 / 触发条件

新增/修改 `.py`、平台模板、live/template mirror、CLI integration 或 build
输出时适用。Suncode 发布物同时包含 TypeScript、Python 与生成模板，单独跑
Vitest 不能证明发布链完整。

### 2. 签名

```bash
python -m py_compile <tracked-python-files>
pnpm typecheck
pnpm --filter @wjptz/suncode lint:py
pnpm lint
pnpm build
pnpm test
```

CI 固定 `actions/setup-python` 的 `python-version: "3.9"`。Python bytecode
必须写到 runner 临时目录，不能污染 source/template 树。

### 3. 契约

- CI path filter 必须包含 `**/*.py`，否则只改 live `.trellis/scripts` 时不会
  触发 gate。
- Python 3.9 `py_compile` 覆盖 Git tracked Python 文件；本地提交前还要确认
  新增 Python 文件已经进入 staged/commit scope，否则 `git ls-files` 看不到。
- BasedPyright 通过 package script `lint:py` 运行；warning 与 error 分开报告，
  error 必须为 0。
- TypeScript 先 typecheck/lint；build 在 integration tests 前运行，因为
  `packages/cli/bin/suncode.js` 读取 `dist/`。
- build 后至少断言 core/cli 入口与 channel/task exports 存在。
- source/template mirror 行为必须由 parity tests 或显式 byte comparison
  证明；不能只依赖两份各自可编译。
- 平台新增必须覆盖 template/configurator、init、ownership/platforms、
  update 与 uninstall 生命周期；通用 registry iteration 不能替代平台特定
  runtime 测试。
- Python/backend 测试在 agent 执行环境必须设置 60 秒硬超时；超时应报告为
  未通过，不得无限等待。

### 4. 校验与错误矩阵

| 条件 | 预期行为 |
|---|---|
| Python 3.10+ 语法在 3.9 import/compile 失败 | CI 失败 |
| live/template 行为漂移 | parity/integration test 失败 |
| integration test 在 build 前运行 | 流程错误；必须先 build |
| 新平台只有 registry dynamic test | 验收不完整，补显式生命周期测试 |
| BasedPyright warning 但 0 error | 可报告已知 warning；不冒充 error |
| 任一必要 gate 未执行 | 最终报告写“未执行 + 原因”，不得推断通过 |

### 5. Good / Base / Bad Cases

- Good：新增 Snow 同时通过模板字节 parity、init hash、update 用户文件保留、
  uninstall ownership 与 built CLI platforms JSON。
- Base：纯文档改动只运行与范围相称的文档/差异检查，并明确未跑的构建项。
- Bad：1539 个旧测试全绿就宣称新 Python 3.9 hook 安全，却没有 compile
  新增模板或对应边界测试。

### 6. 必需测试

- 所有 bug fix 先有失败回归用例，再验证修复。
- context injection 的 Python/OpenCode/Pi 实现分别覆盖限制、UTF-8、binary、
  总预算，并有跨实现默认值/顺序 parity assertion。
- Git probe 覆盖 8/9 上限、timeout forwarding 与失败保守语义。
- gitattributes 覆盖 additive、identity distinction、dry-run。
- channel 覆盖 trusted roots、Codex terminal dedup 与 idle child truth。

### 7. Wrong vs Correct

```yaml
# Wrong: tests import stale dist.
- run: pnpm test
- run: pnpm build

# Correct
- run: pnpm build
- run: pnpm test
```

---

## Pre-Development Checklist

Before writing or improving tests:

1. Read [conventions.md](./conventions.md) — file naming, structure, assertion patterns, when to write tests
2. Read [mock-strategies.md](./mock-strategies.md) — what to mock, how, minimal mocking principle
3. For command-level tests, read [integration-patterns.md](./integration-patterns.md)

---

## Quality Check

After writing tests:

1. Ensure tests follow conventions (naming, structure, assertions)
2. Verify mocking is minimal — prefer real code paths
3. Run validation:
   ```bash
   pnpm lint && pnpm typecheck && pnpm test
   ```
4. Check coverage decisions — report any gaps with rationale

---

**Language**: 项目 code-spec 默认使用简体中文；代码标识、命令和原始错误字符串保留英文。
