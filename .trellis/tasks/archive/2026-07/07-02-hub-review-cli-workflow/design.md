# Hub Review CLI workflow 设计

## 总体原则

Hub review 是以 task 为中心的 CLI 编排流程，不是 AI 临场对话流程。Suncode 负责 review 的上下文、状态、文件、上传和同步；AI 只负责触发 `suncode hub review`、读取结果、修改代码、再次触发 review，并在 approved 后继续 finish。

## 配置模型

新增 `hub.review` 配置块：

```yaml
hub:
  review:
    enabled: true
    provider: engineer
    required: false
    trigger: manual
    unavailablePolicy: bypass
    engineer:
      command: engineer
      args: ["run"]
      timeoutSeconds: 900
      saveRawOutput: true
```

字段语义：

- `enabled`: 是否启用 Hub review 能力。
- `provider`: 当前 review provider。第一版实现 `engineer`。
- `required`: completion 前是否必须有最新 approved review。
- `trigger`: 第一版支持 `manual`，可预留 `beforeCompletion`。
- `unavailablePolicy`: `bypass`、`warn`、`block`。
- provider 配置：命令、参数、超时等。
- `engineer.saveRawOutput`: 是否保存 Engineer 原始 stdout/stderr 到 `raw-output.md`，默认 `true`，关闭后只保留结构化 review report。

## Skill 分发

新增 common bundled skill：

```text
packages/cli/src/templates/common/bundled-skills/suncode-hub-review/SKILL.md
```

该 skill 作为通用 review 规则安装到所有平台。`suncode init --engineer` 会自然生成：

```text
.engineer/skills/suncode-hub-review/SKILL.md
```

skill 必须强调 report-only：

- 不修改文件。
- 不提交、不推送、不 merge。
- 只 review 当前 task 和指定 scope。
- 结果必须输出结构化 JSON block。
- 区分 must-fix、advisory、blocked。

## CLI 编排

新增命令：

```bash
suncode hub review [--task <task>] [--module <path> ...] [--provider <provider>] [--force]
```

默认流程：

1. 定位 task：
   - 优先 `--task`。
   - 否则读取当前 active task。
   - 要求 task 已绑定 Hub；未绑定则 skipped。
2. 读取 `hub.review` 配置。
3. 检查 provider 可用性。
4. 计算下一轮 round。
5. 收集输入：
   - `prd.md`、`design.md`、`implement.md`、`subtasks.json`。
   - 相关 `.suncode/spec/` / `.trellis/spec/` 指南，按现有 package/layer 逻辑尽量复用。
   - 当前 git diff、changed files、head commit、diff hash。
   - 上一轮 review 结果和 fix summary。
6. 写入 `reviews/round-NNN/prompt.md` 和 `diff.patch`。
7. 调用 provider。
8. 解析 provider 结构化输出，保存面向人的 `result.md` 总结报告。
9. 解析结构化结果，生成 `review.json`。
10. 同步 Hub status 和 review submission。
11. 输出简洁下一步。

## 本地 artifact 结构

每轮 review 固定写入：

```text
reviews/
  round-001/
    review.json
    result.md
    raw-output.md
    diff.patch
    prompt.md
    fix-summary.md
```

`result.md` 保存 provider 结构化结果渲染出的 review 摘要和逐条问题，不保存原始执行转录。`raw-output.md` 仅用于诊断 provider stdout/stderr，并受 `hub.review.engineer.saveRawOutput` 控制；关闭后不生成该文件，也不写入 `review.json.artifacts`。

`fix-summary.md` 第一轮可不存在，第二轮开始由 CLI 自动生成初稿或由 AI 补充。

`review.json` 是 Hub 主要消费的结构化文件：

```json
{
  "version": 1,
  "round": 1,
  "provider": "engineer",
  "status": "changes_requested",
  "scope": ["packages/cli/src/commands/hub"],
  "baseRef": "main",
  "headCommit": "abc123",
  "diffHash": "sha256...",
  "startedAt": "2026-07-02T00:00:00.000Z",
  "finishedAt": "2026-07-02T00:05:00.000Z",
  "summary": "发现 2 个必须修改问题。",
  "mustFixCount": 2,
  "advisoryCount": 1,
  "artifacts": {
    "prompt": "reviews/round-001/prompt.md",
    "result": "reviews/round-001/result.md",
    "diff": "reviews/round-001/diff.patch",
    "rawOutput": "reviews/round-001/raw-output.md"
  }
}
```

## Hub 同步

尽量复用现有接口：

- task status：复用现有 status patch。
- 文件上传：复用 artifact upload session + MinIO。
- completion：复用 `submit-completion`。

最小新增语义：

- `submissionKind: "review"`。
- review artifact type 第一版可只新增 `"review"`，通过路径区分 `review.json`、`result.md`、`diff.patch` 等文件。
- submission path 可采用 `review-submissions`，与现有 `plan-submissions`、`completion-submissions` 风格一致。

## 状态模型

review 仅在启用且 provider 可用时改变 task 状态：

```text
in_progress -> in_review -> changes_requested -> in_review -> approved
```

provider 不可用且 `unavailablePolicy=bypass` 时，命令返回 skipped，不写 `in_review`、`changes_requested` 或 `approved`。

`submit-completion` 在 `hub.review.required=true` 时执行 gate：

- 最近一轮 review status 必须为 `approved`。
- 当前 diff hash / head commit 必须匹配 approved review。
- review 结果必须可解析。

## Provider adapter

第一版实现 Engineer adapter：

- 使用 `hub.review.engineer.command` 和 `args`。
- 优先使用 stdin 或 prompt 文件，避免把大 prompt 拼进 shell 字符串。
- provider 执行前后检查工作树；如果 reviewer 修改文件，结果标记 blocked。

主流程按 provider interface 设计，后续可接入其他 CLI。

## 兼容性

- 未启用 Hub review 的项目保持现状。
- 未安装 Engineer 的项目按 `unavailablePolicy` 处理。
- 已执行 `suncode init --engineer` 的项目获得完整 Engineer 平台集成和 review skill。
- 不需要额外 `review-init` 命令。
