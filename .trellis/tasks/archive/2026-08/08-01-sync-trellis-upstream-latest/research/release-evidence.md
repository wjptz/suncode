# Trellis v0.6.9-v0.6.11 官方发布证据

## 审查范围

- 审查日期：2026-08-01。
- 官方仓库：`https://github.com/mindfold-ai/Trellis.git`。
- 本地远端：`upstream`；`git remote get-url upstream` 与 checkpoint 中记录的 URL 完全一致。
- 已验证 checkpoint：官方 `v0.6.8`，commit `dc68f5a92a68489b681c511f4a784e413d724e85`。
- 本轮起点为上述 commit 的 exclusive 后继，不从 fork baseline 重放。
- `sync_checkpoint.py validate` 成功；当前 ledger entry 为 `2026-07-22-v0.6.8`。

## 官方 tag 发现与目标选择

`git ls-remote --tags upstream` 在 checkpoint 之后返回：

| Tag | 官方 commit | 类型 | 本轮处理 |
| --- | --- | --- | --- |
| `v0.6.9` | `12e279a8af00456b1d0d4e3d0f7f59e7b702202e` | lightweight | 审查 |
| `v0.6.10` | `c94d6fc289b7a6fdd9480bdfae4d4639c9ac2d4c` | lightweight | 审查 |
| `v0.6.11` | `a82d4d4c75abf85c6200c4528f750798d531a70f` | lightweight | 最新稳定版，目标 |
| `v0.7.0-beta.0` | `ef91afee611e6c2f7a2555516815af0dc59d8bfd` | prerelease | 不纳入稳定版同步 |
| `v0.7.0-beta.1` | `1019808318a5573c5fc73c3e90bd19abefa7b6e4` | prerelease | 不纳入稳定版同步 |

三个稳定 tag 均没有 `^{}` peeled 行，因此 tag 自身指向的 commit 就是官方发布身份。默认“最新版本”按同步技能规则解释为最新非预发布稳定版，即 `v0.6.11`。

## 隔离抓取与身份核验

官方 tag 未写入或覆盖本地 tag，而是抓取到：

| Release ref | 本地解析 commit | 与官方一致 |
| --- | --- | --- |
| `refs/remotes/upstream/releases/v0.6.9` | `12e279a8af00456b1d0d4e3d0f7f59e7b702202e` | 是 |
| `refs/remotes/upstream/releases/v0.6.10` | `c94d6fc289b7a6fdd9480bdfae4d4639c9ac2d4c` | 是 |
| `refs/remotes/upstream/releases/v0.6.11` | `a82d4d4c75abf85c6200c4528f750798d531a70f` | 是 |

首次 fetch 因 Git 自动递归抓取上游 `docs-site` / `marketplace` 历史指针而退出 1；主仓三个 release ref 已写入，但两个上游子模块远端拒绝了不可达对象。随后使用 `--no-recurse-submodules --no-tags` 对同一组精确 refspec 重试并成功。此过程没有修改当前两个子模块的工作树；原始子模块指针按 fork boundary 明确排除，不作为发布身份。

## 祖先链和 commit 数量

以下 `git merge-base --is-ancestor` 均返回 0：

1. `v0.6.8` → `v0.6.9`；
2. `v0.6.9` → `v0.6.10`；
3. `v0.6.10` → `v0.6.11`。

| Exclusive..inclusive 区间 | Commit 数 |
| --- | ---: |
| `v0.6.8..v0.6.9` | 28 |
| `v0.6.9..v0.6.10` | 3 |
| `v0.6.10..v0.6.11` | 12 |
| `v0.6.8..v0.6.11` | 43 |

逐 commit 的父节点检查表明三个区间均没有多父 merge commit；43 个 commit 包含功能、修复、spec、task archive、journal、release manifest、版本号、资产和子模块指针。

## 官方 release 行为摘要

- `v0.6.9`：Snow CLI、子代理上下文限额与二进制跳过、per-turn skip keyword、Codex 模型配置持久化、channel trusted roots、任务/日志脚本 QoL、Kimi research 持久化、journal union merge。
- `v0.6.10`：Python 3.9-3.11 脚本兼容、Codex 截断 hook 输出恢复、fallback session 精确清理。
- `v0.6.11`：Pi 父模型继承和 `max` thinking、Codex turn failure、完成 turn 后 idle timeout、UTF-8 stdin、polyrepo 探测上限、所有权式平台识别、Python 3.9 CI 门禁。

官方 migration manifest 仅作为行为摘要证据；上游版本号、manifest 内容、npm identity 和 docs-site 指针不复制到 Suncode。

## 本地审查基线与脏工作边界

- 审查基线：Suncode `main`，HEAD `493c3076f7d9fe35882a54cbab496016c087fcac`。
- 同步任务状态：`planning`；尚未执行 `task.py start`。
- 当前 checkpoint 仍为 `v0.6.8`，本轮没有推进。
- 任务创建前已有主仓脏改：五个 `.claude/skills/gitnexus/*/SKILL.md`、`AGENTS.md`、`CLAUDE.md`、`drafts/kb-design-philosophy.md`，以及脏的 `docs-site`、`marketplace` 子模块。
- `docs-site` 内有 26 个已修改文档和两个未跟踪的 `v0.6.12` changelog；`marketplace` 内有三个已修改 workflow。它们均视为用户工作，不读取为同步目标、不回滚、不格式化、不提交。
- 本轮只允许新增或修改专用任务目录；实施获批后也必须以路径白名单暂存，排除上述工作。

## 阶段结论

官方来源、目标 tag、release ref、祖先链和完整 43-commit 范围均已验证，可以进入语义采纳规划。该结论不代表已经实施，也不允许推进 checkpoint；只有全部采纳项实现、验证并形成独立 implementation commit 后，才能记录 ledger 并在单独 commit 中推进 checkpoint。
