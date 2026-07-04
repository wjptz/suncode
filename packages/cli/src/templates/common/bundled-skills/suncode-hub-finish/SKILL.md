---
name: suncode-hub-finish
description: "用于完成 Suncode Hub 任务、准备按需完成产物、提交 spec 变更、评估可复用知识，或向 Hub 上传最终产物。"
---

# Suncode Hub 完结

仅在当前任务是 Hub 任务时使用本技能：任务已经绑定到 Suncode Hub，或带有 `meta.hub.requirementId`、等待远端绑定。如果项目没有启用 Hub，使用普通 Suncode finish-work 流程。

## 规则

- 只处理当前任务，或用户明确指定的任务。
- 不上传兄弟任务的 PRD、design、implement、summary 或 retrospective 文档。
- 不提交空摘要，也不写未经验证的完成结论。
- 不打印或持久化 Hub token、密码或 auth header。
- 如果 `<hub-state>` 显示 `hub-task:local-only`，停止 Hub 专属流程；除非用户明确要求绑定 Hub requirement。
- 长文档由 `suncode hub` 通过 Hub 签发的 MinIO URL 上传；Hub API payload 只能包含 object reference 和 hash，不直接放文档正文。
- `hub finish` 不启动代码审查。Hub code review 属于最终验证后、工作提交前的流程；finish 只校验必需的已批准 review 仍匹配当前提交状态。
- `meta.hub.taskType == "quick"` 时，不运行 Hub code review 或 check-agent review。Quick 仍要按需生成有用的完成产物，并运行 `suncode hub finish --task current` 让 Hub 收到最终上传。

## 按需本地产物

完成产物按需生成，不要求四个文件齐全。`suncode hub finish` 会上传当前任务目录中已经存在的以下候选文件：

- `implementation-summary.md`
- `validation-summary.md`
- `retrospective.md`
- `reuse-assessment.md`

所有面向人的内容默认使用简体中文。命令名、API 字段、代码符号、文件路径、错误字符串和引用原文可以保留原文。

按需判断：

- `implementation-summary.md`：当任务有代码、配置、模板、文档或行为变更时写；说明改了什么、改在哪里。
- `validation-summary.md`：当执行过测试、类型检查、lint、构建、烟测、人工验证或明确未执行验证时写；记录具体命令、结果，或写明 `未执行` 和原因。
- `retrospective.md`：只有当任务产生值得复盘的经验、风险、问题或后续注意点时写。
- `reuse-assessment.md`：只有当任务产生可复用的 spec、模板、helper、流程约束或知识沉淀时写。
- quick 任务必须至少提供有证据的 `validation-summary.md`；内容必须包含已执行验证证据，或包含 `未执行` 及具体原因。

## 流程

1. 确认当前任务：

```bash
python3 ./.suncode/scripts/task.py current --source
```

2. 提交 Hub finish：

```bash
suncode hub finish --task current
```

`hub finish` 会确保远端 Hub 绑定存在（必要时自动绑定 pending task），对 standard/change 任务通过现有 completion submission 检查执行必需 review gate，提交项目级 spec artifacts，并上传当前任务目录中存在的按需完成产物及 commit metadata。Quick 任务绕过 review gate，但不绕过完成产物上传；quick 缺少有效 `validation-summary.md` 时会失败。

3. 根据结果处理：
   - quick 缺少有效验证摘要：补充中文 `validation-summary.md`，写清已执行验证，或写 `未执行` 及原因，然后重跑。
   - `No artifacts found.`：确认本任务是否确实没有需要上传的完成产物；如果有，补充对应中文产物后重跑。
   - 绑定失败：向用户报告精确错误；不要把任务视为已在 Hub 完成。
   - `skipped` 且提示 local-only：该任务不是 Hub 任务，继续普通 Suncode finish 流程。
   - 成功或有意跳过：继续普通 Suncode archive/finish 流程。

仅在用户提到需求变更或 Hub review comments 时，按需运行：

```bash
suncode hub sync --task <task-dir>
suncode hub pull-review --task <task-dir>
```

如果响应包含 document payload，使用 `suncode hub download-document --document-id "<documentId>" --task "<task-dir>"` 将该文档下载到当前任务。
