# Trellis v0.6.6 / v0.6.7 变更实施计划

## 实施前置

- 进入 Phase 2 前运行 `trellis-before-dev`，读取目标包的 `.trellis/spec/` 指南。
- 确认工作树并保持 `drafts/kb-design-philosophy.md` 及其他无关改动不动。
- 每次修改函数、类或方法前，对目标符号运行 GitNexus upstream impact；HIGH/CRITICAL 结果先报告用户。
- 以 `research/upstream-v0.6.6-v0.6.7-adoption.md` 的 commit/file anchors 为行为规格，以当前 Suncode 代码为实现基线。
- 当前为 Codex inline 模式，不维护 `implement.jsonl` / `check.jsonl`；Phase 2 从本文件、PRD、设计和 spec 读取上下文。

## 实施清单

- [x] [P0] 建立安全路径与原子写基础能力: 统一 Channel/worker handle 校验和 discovery skip；为 TypeScript/Python 状态文件实现同目录临时写入、原子替换和 best-effort cleanup，并补失败路径测试。
- [x] [P0] 加固 uninstall、archive 与迁移所有权: 增加 Suncode AGENTS managed-block scrubber和 dirty guard；限制 task archive 根边界；使 rename-dir、traces/journal 改名仅处理 Suncode-owned 数据且不覆盖目标。
- [x] [P0] 改造模板覆盖事务: 下载到临时目录，成功后替换现有目标；覆盖失败保留旧模板，Windows cleanup 异常不得遮蔽主结果。
- [x] [P0] 串行化 Channel stdout: 将逐行异步处理改为有背压的严格顺序队列，验证高频输出、错误事件和 terminal/turn 状态顺序。
- [x] [P1] 支持 Windows Node-script shim: 在 provider 解析中保留本地 bin 优先级，使用 `process.execPath` 启动 `.js/.cjs/.mjs` shim，保持 `shell: false` 并覆盖 fallback 测试。
- [x] [P1] 注册 OMP 平台骨架: 增加 `omp` 类型、`AI_TOOLS` 配置、`--omp`、`configureOmp`、`collectOmpTemplates`、模板入口、平台注册和 CLI/task/workflow 识别；生成 Suncode 命名的 commands/skills/agents/extension。
- [x] [P1] 实现 OMP ownership-aware 生命周期: 在平台注册中提供 OMP 专用 configured 检测，确保 Trellis-only `.omp` 不触发 Suncode update；让 update/hash/uninstall 只管理 manifest 所属的 Suncode OMP 文件，并覆盖混合所有权测试。
- [x] [P1] 移植 OMP extension 最终行为: 以 `v0.6.6` 最终状态合并 session-start、main/sub-agent 精确上下文、input cache、before-agent、context continuation、compaction-aware reinjection、session-aware task 和 stale identity 修复；维护单一模板源并验证生成结果，不引入仓库根 OMP dogfood 镜像。
- [x] [P1] 完成 OMP command/agent 契约: 为 commands 生成正确 YAML frontmatter，为 implement/research agents 设置 `model: pi/task`，验证 OMP 原生 task 路径不重复启动 CLI 子代理，并记录 OMP session/mem 格式兼容性结论。
- [x] [P1] 移植 Pi 与平台工作流修复: 将 Pi runtime context 改为隐藏持久化消息并稳定 system prompt；迁移 ZCode 到 `.zcode/agents/`；按 Codex dispatch mode 控制 JSONL；补 task create hygiene、journal stale branch 和 Pi 项目级 sessionDir。
- [x] [P1] 执行跨组回归与隔离验证: 覆盖 Suncode/Trellis 共存、init/update/uninstall 幂等、OMP/Pi/ZCode/Codex 互不污染、用户修改冲突和所有失败回滚路径。
- [x] [P1] 运行完整质量门并核对影响面: 运行 CLI/core 定向测试、完整测试、typecheck、build；执行 GitNexus `detect_changes(scope="compare", base_ref="main")`，复核只影响设计列出的符号和流程。

## 依赖顺序

1. 原子写与安全路径是 uninstall、update、OMP 生命周期测试的安全基础，应最先完成。
2. OMP 平台骨架完成后，才能实现 ownership-aware 检测、extension 和 command/agent 契约。
3. OMP extension 必须一次覆盖 `a6f7fc2` 之后到 `1fbcd9b` 的最终修复状态，不能停在早期中间态。
4. Pi/ZCode/Codex 等相邻平台改动在 OMP 骨架稳定后进行，便于区分回归来源。
5. 完整质量门和 `detect_changes` 只能在所有定向测试通过后执行。

## 重点文件与回滚点

- 平台注册：`packages/cli/src/types/ai-tools.ts`、`packages/cli/src/configurators/index.ts`、`packages/cli/src/commands/init.ts`、`packages/cli/src/cli/index.ts`。
- OMP 新增面：`packages/cli/src/configurators/omp.ts`、`packages/cli/src/templates/omp/`。
- Channel：`packages/core/src/channel/internal/store/paths.ts`、`packages/cli/src/commands/channel/store/paths.ts`、`packages/cli/src/commands/channel/supervisor.ts`、`packages/cli/src/commands/channel/supervisor/stdout.ts`。
- 数据安全：`packages/cli/src/utils/file-writer.ts`、`packages/cli/src/utils/template-fetcher.ts`、`packages/cli/src/commands/update.ts`、`packages/cli/src/commands/uninstall.ts`、`packages/cli/src/templates/suncode/scripts/common/io.py`、`task_store.py`。
- 相邻平台：Pi extension/template、`packages/cli/src/configurators/zcode.ts`、`add_session.py`、`packages/core/src/mem/internal/paths.ts`、Pi mem adapter。
- 每组发生失败时只回滚当前组；禁止删除整个 `.omp`、`.pi`、`.zcode` 或用户目录。

## 验证命令

实施时根据改动先运行对应 Vitest 文件，再运行：

```bash
pnpm test
pnpm typecheck
pnpm build
```

后端/脚本定向测试必须设置 60 秒硬超时。若某项检查因环境限制未执行，交付时明确标为“未执行”并说明原因。

## 开始实施前检查

- [x] 用户已审阅 `prd.md`、`design.md`、`implement.md` 并明确批准实施。
- [x] `task.py start` 已在批准后执行，任务进入开发阶段。
- [x] 目标包 spec 已由 `trellis-before-dev` 加载。
- [x] 第一批目标符号的 GitNexus impact 已核验并向用户报告风险。

## 实施结果

- 完整纳入官方 `v0.6.6` / `v0.6.7` 采纳矩阵，并按 Suncode 命名、持久化和所有权契约完成语义移植。
- OMP 已接通 registry、CLI、init/update/uninstall、commands、skills、agents、extension、workflow、task store 与 adapter；Trellis-only `.omp` 不会触发 Suncode 自动检测，混合目录卸载会保留 Trellis/用户资产。
- `marketplace/workflows/native/workflow.md` 与 canonical workflow 保持字节一致；只修改 submodule 工作树内镜像文件，未更新 submodule pointer。
- `pnpm lint`、`pnpm typecheck`、`pnpm build`、`git diff --check` 均通过。
- 全量测试：core `302/302`，CLI `1468/1468`，合计 `1770/1770`。
- `basedpyright`：`0 errors`；保留仓库原有 `64 warnings`（均为 `common/__init__.py` / `git_context.py` re-export 的 unused import）。
- GitNexus `detect_changes(scope="compare", base_ref="main")`：`131` 个 changed symbols、`67` 条 affected processes、风险 `CRITICAL`；高风险来自共享原子写、平台 configure/update/uninstall 和 Channel 路径扇出，已由上述全量测试覆盖。
- 未创建 commit、未 push、未发布 npm；无关文件 `drafts/kb-design-philosophy.md` 保持未修改。
