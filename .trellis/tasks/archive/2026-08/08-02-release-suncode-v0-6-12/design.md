# Suncode v0.6.12 技术与发布设计

## 设计结论

采用“最小代码修复 + 受控发布合流”方案：

```text
content 字符串
      │ UTF-8 encode（计算 SHA-256）
      ├──────────────────────────────┐
      │                              │
      ▼                              ▼
manifest.content.sha256      _write_text_atomic
                                     │ newline="\n"
                                     ▼
                              content.md 原始 bytes
                                     │ read_bytes + SHA-256
                                     ▼
                                严格一致 / fail closed

origin/main（已发布 0.6.11） ───────┐
                                    ├─ release/v0.6.12 ─ 准备提交 ─ 干净 clone ─ v0.6.12
local main（DAG/Trellis 提交） ─────┘       ▲
                                            ├─ docs-site 已验证提交
                                            └─ marketplace 已验证提交
```

不修改 manifest 校验算法，不降低完整性门禁，也不在本补丁版新增 worktree/sandbox 制品传输协议。

## 1. Context 写盘修复

### 1.1 修改点

目标符号：

- `packages/cli/src/templates/suncode/scripts/common/execution_context.py::_write_text_atomic`

保留当前 `tempfile.mkstemp` → 写入 → `os.replace` 的原子流程，只把：

```python
os.fdopen(fd, "w", encoding="utf-8")
```

改为：

```python
os.fdopen(fd, "w", encoding="utf-8", newline="\n")
```

Python 文本流在 `newline=None` 时会把写入的 `\n` 转换为平台默认行分隔符；显式 `newline="\n"` 表示把 `\n` 写为 `\n`，因此：

| 平台 | 修改前 | 修改后 | 兼容结果 |
|---|---|---|---|
| Linux | `\n` → `\n` | `\n` → `\n` | 原始 bytes 不变 |
| 现代 macOS | `\n` → `\n` | `\n` → `\n` | 原始 bytes 不变 |
| Windows | `\n` → `\r\n` | `\n` → `\n` | 修复声明哈希与文件哈希失配 |

该参数不把字符串中已有的 `\r\n` 清洗为 `\n`；它只关闭平台默认转换。因此 writer 持久化的仍是 `value.encode("utf-8")` 所代表的原始内容。

### 1.2 不采用的方案

- **读取端把 CRLF 重新规范化为 LF 后再验 hash**：会让完整性校验不再针对真实 artifact bytes，篡改面扩大，拒绝。
- **生成 manifest 时按落盘后文件重新计算 hash**：能掩盖 writer 非确定性，但不能保证不同 adapter 收到同一 bytes，拒绝。
- **把 writer 重构为新的二进制 I/O 抽象**：可以工作，但超出本次最小补丁需要；现有文本 writer 只需显式 newline 契约。
- **全仓强制换行格式化**：运行时 artifact 不受 Git attributes 保护，且会触碰无关文件，拒绝。

## 2. 回归测试设计

### 2.1 Manifest/bytes 功能断言

在 `packages/cli/test/templates/execution-runtime.test.ts` 的 context manifest 测试附近增加断言：

1. 通过真实 `execution claim` 生成 `manifest.json` 与 `content.md`。
2. 使用 `readFileSync(..., null)` 获取原始 bytes，不通过 UTF-8 文本读取掩盖换行差异。
3. 断言 `sha256(contentBytes) == manifest.content.sha256`。
4. 断言 `contentBytes.byteLength == manifest.budget.usedBytes`。
5. 保留 `execution context` pull、hook push、secret redaction 和篡改拒绝测试。

### 2.2 在 Linux CI 模拟 Windows 翻译

普通 Ubuntu 测试无法让 `newline=None` 自然产生 CRLF。增加一个最小 Python probe：

1. 导入模板模块并保存真实 `os.fdopen`。
2. 用 wrapper 模拟 Windows 默认：仅当调用方没有传 `newline` 时，替它传 `newline="\r\n"`。
3. 调用 `_write_text_atomic()` 写入含 LF 的已知字符串。
4. 读取 raw bytes，并与 `value.encode("utf-8")` 比较。

旧实现因为没有显式参数，会被 probe 转成 CRLF 并失败；修复后显式 `newline="\n"`，probe 不介入且通过。这样测试能够在现有 Ubuntu CI 上锁定真正的跨平台契约，而不是只验证 Linux 的偶然行为。

### 2.3 Fail-closed

继续覆盖两类失败：

- 修改 `manifest.json` 中受哈希保护的字段；
- 修改 `content.md` 原始 bytes。

两类情况都必须拒绝 context 注入/拉取，不能把失配内容交给 worker。现有错误字符串保持兼容，除非测试证明需要更明确的前缀。

## 3. Bundled 隔离边界

### 3.1 本版本验证范围

v0.6.12 验证并发布现有 bundled `shared-worktree` 链路：

```text
claim → repo-relative manifestRef
      → SubagentStart hook push / execution context pull
      → read_node_context_manifest(repo_root, manifestRef)
      → raw-byte integrity validation
```

`fork_turns="none"` 只控制子会话不继承父对话，不改变 artifact bytes，也不是这次哈希失配根因。

### 3.2 延期能力

原始 DAG 设计已把 worktree/sandbox 写隔离、合并和清理列为未来适配器能力。本版本不新增：

- 父 checkout 到子 checkout 的 artifact copy；
- 跨 sandbox 共享挂载或远程 artifact store；
- 新 trust root、签名或 capability schema；
- worktree 写分支合并/冲突/清理协议。

发布检查会审阅 workflow、manifest 和 changelog，确保没有把这些保留枚举描述成 bundled 端到端已支持能力。如果现有默认流程会选择它们或在显式 manifest 失配后静默继续，则只做最小 fail-fast 收紧，并补对应测试；不扩展为 transport 实现。

## 4. 发布历史合流

### 4.1 隔离工作区

当前主工作树含不属于本版本的用户改动，且 `packages/cli/scripts/release.js` 会做宽范围暂存。因此：

1. 在当前工作树记录主仓、docs-site、marketplace 的精确 dirty snapshot。
2. 只对本任务目录做精确 task 状态/规划提交，使任务可进入隔离 worktree。
3. fetch 后从最新 `origin/main` 创建 `release/v0.6.12` 隔离 worktree。
4. 在 release 分支使用普通 merge 合入本地 `main`，保留两侧祖先；不 rebase、不改写历史。
5. 解决冲突时以远端已发布 `0.6.11` 版本文件为基线，同时保留本地 DAG/Trellis 产品代码。
6. 修复、测试和主仓发布准备提交全部在隔离 worktree 完成。

### 4.2 三仓顺序

```text
docs-site：完成双语文档审查 → 精确提交（暂不 push）
marketplace：复核现有 3a78f3e（暂不 push）
主仓 release：记录两个目标 gitlink → 精确准备提交（暂不 push）
```

本地质量门完成后才形成 go/no-go。得到独立发布批准后：

1. push docs-site；验证提交可从其 origin 获取。
2. push marketplace；验证提交可从其 origin 获取。
3. push 主仓 release 准备提交到 `main`；验证 gitlink 指向均已远端可达。
4. 从 `origin/main` 全新递归 clone，强制 LF checkout，安装锁定依赖并先 root build。
5. 执行官方 `pnpm release`，由脚本产生 `0.6.12` 版本提交、`v0.6.12` tag 和 push。
6. 监控 tag 触发的 GitHub Actions，随后从公共 npm 验证两个包及 `latest`。

## 5. Manifest 与文档

- `packages/cli/src/migrations/manifests/0.6.12.json` 保持 `breaking=false`、`recommendMigrate=false`、`migrations=[]`。
- manifest 的短 changelog 增加 context artifact Windows 换行哈希修复，保留真实换行。
- `docs-site/changelog/v0.6.12.mdx` 与 `docs-site/zh/changelog/v0.6.12.mdx` 更新为实际发布日期，章节和条目 1:1。
- changelog 使用 `Enhancements` / `Bug Fixes` / `Upgrade` 的技术参考文风；不加入测试计数或营销性描述。
- `docs-site/docs.json` 的双语页面列表和 navbar 必须指向 v0.6.12。
- 横切文档中只描述已验证的 shared-worktree context 链路；保留枚举需要出现时，明确它们是 adapter capability，而非 bundled transport 保证。

## 6. 质量门

按失败成本从低到高执行：

1. Python probe 与 Execution DAG/context 定向测试（后端测试 60 秒硬超时）。
2. Python `basedpyright`、CLI lint/typecheck。
3. manifest JSON/schema/continuity、双语 changelog 结构、docs navigation 静态检查。
4. root lint、typecheck、完整 test、build。
5. release version check、publish plan、packed CLI/core 校验。
6. tarball 全新安装、`suncode --version`、init/update、DAG claim/context/hook smoke。
7. 三仓 `git diff --check`、精确 staged diff、远端可达性和原工作树保护对比。
8. GitNexus `detect_changes`，确认只影响预期符号和执行流。

未执行或失败的必需门禁一律阻止 go/no-go。

## 7. 失败与回滚

- **tag 前失败**：停止，保留隔离 release 分支和本地提交，修复后重跑相关门禁；不影响远端。
- **子仓 push 后、主仓 push 前失败**：保留子仓追加提交，不回滚历史；修复主仓后再继续。
- **主仓 push 后、tag 前失败**：通过追加提交修复，不强推或删除已推历史。
- **tag 后 CI 失败**：不移动 tag、不本地 npm publish；能安全重跑则重跑，否则修复后评估 v0.6.13。
- **部分 npm 发布**：停止其他变更，记录事实并修复 CI 补齐同版本未发布包；两个包的 `latest` 不得长期指向不一致组合。
- **原工作树保护**：发布后仅 fetch/核对，不 reset、checkout 或清理用户已有脏文件。
