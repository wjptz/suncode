# Suncode v0.6.11 发布设计

## 发布拓扑

```text
docs-site main ─────┐
                    ├─> 主仓准备提交 ──> 干净临时 clone ──> v0.6.11 tag
marketplace main ───┘                                      │
                                                           v
                                              GitHub Actions publish
                                                           │
                                  @wjptz/suncode-core + @wjptz/suncode
```

两个子仓提交必须先推送，主仓随后推送包含对应 gitlink 的准备提交。tag 只能在可复现的主仓状态上创建。

## 状态与批准边界

1. **Planning**：只形成需求、设计和实施计划，不编辑发布产物、不推送。
2. **Preparing**：用户批准实施后，创建 manifest/changelog，提交精确路径并完成本地质量门；不推送、不打 tag。
3. **Go/No-Go**：汇总 staged/committed diff、测试、远端 ahead 状态、目标版本与将执行的外部动作。
4. **Publishing**：用户再次明确批准后，执行子仓 push、主仓 push、干净 clone release、tag push 和 CI 监控。
5. **Verifying**：验证 GitHub tag/workflow、npm 两包版本与 dist-tag，记录并归档。

实施批准和最终发布批准是两个不同边界。前者只允许本地发布准备；后者才允许改变远端仓库和 npm 发布状态。

## 发布产物设计

### Migration manifest

- 路径：`packages/cli/src/migrations/manifests/0.6.11.json`
- 版本：`0.6.11`
- `breaking: false`
- `recommendMigrate: false`
- `migrations: []`
- 描述和 changelog 只归纳两个产品提交中的用户可观察变化。
- 继续保留空 manifest，以维持 npm 已发布版本与本地 manifest 的连续性。

### 双语 changelog

- 英文：`docs-site/changelog/v0.6.11.mdx`
- 中文：`docs-site/zh/changelog/v0.6.11.mdx`
- 章节：`Enhancements` / `Bug Fixes` / `Upgrade`；仅在确有用户可见价值时保留 `Internal`。
- 两种语言的标题层级与条目顺序 1:1。
- `docs-site/docs.json` 新增双语 Changelog 组，将 v0.6.11 放在当前入口，并在 navbar 中链接 `/changelog/v0.6.11`。
- 不顺带恢复完整历史 changelog，避免把一次 patch 发布扩成文档迁移。

## 工作树隔离

当前工作树不能直接运行 `release.js`：它会执行宽范围 `git add -A`，且只排除 docs-site、marketplace、`.trellis`。设计采用以下隔离：

1. 在当前仓库中用路径限定的 `git add` 提交 task、manifest 和子模块 gitlink；每次提交前审查 `git diff --cached`。
2. 不修改、不 stash 8 个用户脏路径。
3. 发布准备提交通过最终批准后推送到 `origin/main`。
4. 从远端重新递归 clone 到新的临时目录，核对 HEAD、子模块 SHA 与 clean status。
5. 在该干净 clone 安装依赖并执行官方 release 脚本；其宽范围暂存不会接触原工作区。
6. 发布后只在原工作区 fetch/核对远端，不强制切换或清理用户文件。

## 质量门

按由窄到宽的顺序执行：

1. JSON/schema、双语结构和 docs navigation 静态检查。
2. manifest continuity、docs changelog guard、版本一致性检查。
3. 受影响包的定向测试。
4. root lint、typecheck、完整 test/build。
5. npm pack 内容校验、从 tarball 安装与 CLI 烟测。
6. `git diff --check`、GitNexus `detect_changes`、三个仓库的 staged/commit/remote reachability 审查。

后端测试使用 60 秒硬超时。任何必须检查因环境原因未执行，都构成发布阻塞而不是默认放行。

## 失败处理

- **tag 前失败**：停止发布，保留本地准备提交，修复后重新运行完整相关门禁。
- **子仓 push 后、主仓 push 前失败**：子仓提交可保留；不创建 tag，修复主仓准备状态后继续。
- **主仓 push 后、tag 前失败**：不回滚主仓历史；修复并追加提交后重新形成 go/no-go。
- **tag push 后 CI 失败**：不移动或覆盖 tag，不本地 `npm publish`。诊断 CI/secret/pack 问题；可安全重跑同一 workflow 时重跑，否则提交修复并评估新 patch 版本。
- **仅一个 npm 包发布成功**：停止进一步变更，记录部分发布事实，优先修复 CI 并补齐同版本未发布包；不得把 dist-tag 指向版本不一致的组合。
- **包已发布但内容错误**：npm 版本不可覆盖，使用后续 patch 修复；不删除或重写 `v0.6.11`。

## 发布后证据

- 主仓 `v0.6.11` tag SHA 与 `origin/main` 包含关系。
- GitHub Actions publish workflow URL、结论和关键 job 状态。
- npm 两个包的 `version`、`dist-tags`、发布时间与 tarball 可解析状态。
- 三个仓库的远端提交可达性。
- 原工作区 8 个既有脏路径的发布前后状态对比。
