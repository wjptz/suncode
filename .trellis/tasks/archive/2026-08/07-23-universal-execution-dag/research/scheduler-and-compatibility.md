# 调度、迁移与测试调研

## 调度现状

- `marketplace/workflows/channel-driven-subagent-dispatch/workflow.md:131-143`
  - 当前主流程由主代理 spawn/send/wait，implement → check 仍主要串行。
- `marketplace/workflows/channel-driven-subagent-dispatch/workflow.md:258-316`
  - 已有跨 provider 派发示例，可作为 DAG adapter 的现有 transport 基础。
- `packages/cli/src/commands/channel/wait.ts:11-23,36-38,55-75`
  - 默认第一个匹配结果即返回，`--all` 才等待全部；这为 wait-any 循环提供基础。
- `packages/cli/src/templates/pi/extensions/suncode/index.ts.txt:1249-1357`
  - Pi extension 已区分 Promise.all 并行与 chain 串行，可映射到 ready-set 与真实依赖。
- channel/core 中没有内置 worktree 隔离；当前 worker 共享 cwd。

## 推荐调度循环

1. 解析平台能力。
2. 校验/归一化 DAG。
3. 计算全部 ready 节点。
4. 按资源和写范围选择最大安全集合。
5. 先全部派发，再 wait-any。
6. 每个结果到达即持久化、释放后继、处理重试或失败传播。
7. 最终 fan-in 到 integration/check barrier。

共享工作区的并行 reviewer 必须只回传报告；由单一 fixer 修改。直接并行写入只允许明确互斥的写范围，无法证明时串行化。

## 分发与迁移

- `packages/cli/scripts/copy-templates.js:4-22,67-73`
  - `packages/cli/src/templates` 是规范模板源，构建时复制到 dist，同时复制 migration manifests。
- `packages/cli/src/migrations/index.ts:157-183`
  - 迁移按 manifest 执行；历史 manifest 不可修改，只能新增后继版本。
- `packages/cli/test/commands/update.integration.test.ts`
  - 新增模板、hook 和平台文件需要更新升级集成测试。
- marketplace 和 docs-site 是独立子仓库/发布面，需分别验证和提交，不能假设主仓库发布扫描会包含它们。

## 必要测试面

- CLI：Hub、workflow、init、update、uninstall-overdelete、registry invariants、migration。
- DAG 核心：schema、cycle、normalization、ready-set、conflict、wait-any、recovery。
- 上下文：JSONL、目录、排序、预算、截断、marker、session 隔离、push/pull 等价。
- 平台：重点 native adapter、OpenCode plugin、shared hook、channel 与 Pi 契约。
- Core SDK：只有当 DAG 类型成为公共 API 时才扩展 exports 与 task tests。
- 文档：英文/中文 architecture、multi-platform、custom workflow、Hub、迁移与 changelog。
