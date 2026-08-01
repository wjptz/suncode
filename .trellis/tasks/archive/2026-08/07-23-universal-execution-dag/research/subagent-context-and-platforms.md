# Subagent 上下文与平台表面调研

## 当前链路

- `packages/cli/src/templates/shared-hooks/inject-subagent-context.py:227-273`
  - implement/check JSONL 支持 `file`/`path`、目录类型、seed 跳过和缺失警告；目录扩展当前最多读取 20 个 Markdown 文件。
- `packages/cli/src/templates/shared-hooks/inject-subagent-context.py:292-328`
  - implement 上下文按 JSONL → PRD → design → implement 构造。
- `packages/cli/src/templates/shared-hooks/inject-subagent-context.py:331-364`
  - check 与 finish 使用 check JSONL，并追加任务规划文档。
- `packages/cli/src/templates/shared-hooks/inject-subagent-context.py:368-379`
  - hook 通过 marker 避免重复注入。
- `packages/cli/src/templates/shared-hooks/inject-subagent-context.py:472-530`
  - Codex SubagentStart 已处理父 session/当前任务隔离，是节点级 task/run/node 绑定的直接扩展点。
- `packages/cli/src/templates/claude/agents/suncode-implement.md:19-24`
  - agent 模板存在主动拉取上下文的回退说明；其他平台有对应模板。
- `packages/cli/src/templates/opencode/plugins/inject-subagent-context.js:33-100`
  - OpenCode 使用单独 JS plugin，需要与共享 Python hook 建立契约等价测试。
- `packages/cli/src/commands/channel/index.ts:49-80`
  - channel 已支持 `--context-file`、`--context-raw` 和 `--task`，适合传 manifest 引用，不适合在命令行复制大段正文。

## 设计要求

- 上下文从“任务 + 角色”细化为“任务 + run + 节点 + attempt + 角色”。
- 上下文包必须包含目标、完成定义、写边界、验证、直接依赖结果和来源 manifest。
- 来源排序、预算、目录展开和截断必须确定且可测试；缺失与截断不能静默。
- hook push 与 agent pull 共用 builder 和 manifest，平台层只传输。
- Codex 使用 `fork_turns = "none"` 保持干净子会话；不支持隔离的平台显式降级。
- 子代理回传结构化 NodeResult，主代理不接收完整 transcript 作为调度状态。

## 平台覆盖

现有模板表面包括 Claude、Cursor、CodeBuddy、Droid、Kiro、OpenCode、Codex、Gemini、Qoder、Reasonix、ZCode、Pi、OMP、Trae、Grok、Kimi。首版不要求每个平台都具备相同并发能力，但必须对以下行为作出明确声明：

- 是否支持原生 subagent；
- 最大并发与 wait-any；
- 是否支持干净上下文；
- 共享工作区、worktree 或 sandbox 隔离；
- hook push、agent pull 或 channel context-file；
- 结构化结果协议版本；
- 不支持时的 inline/channel 回退路径。
