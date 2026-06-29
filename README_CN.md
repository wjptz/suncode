<p align="center">
<picture>
<source srcset="assets/trellis.png" media="(prefers-color-scheme: dark)">
<source srcset="assets/trellis.png" media="(prefers-color-scheme: light)">
<img src="assets/trellis.png" alt="Suncode Logo" width="500" style="image-rendering: -webkit-optimize-contrast; image-rendering: crisp-edges;">
</picture>
</p>

<p align="center">
<strong>开箱即用的 AI 编码工程化框架</strong><br/>
<sub>AI 写代码很快，但它每次会话都从零开始理解项目，记不住你的规范，也记不住团队级别的需求。Suncode 会把规范、任务、记忆沉淀进仓库，让 Coding Agent 按你的工程标准来实践。</sub>
</p>

<p align="center">
<a href="./README.md">English</a> •
<a href="https://github.com/wjptz/suncode-docs">文档</a> •
<a href="https://github.com/wjptz/suncode-docs">快速开始</a> •
<a href="https://github.com/wjptz/suncode-docs">支持平台</a> •
<a href="https://github.com/wjptz/suncode-docs">使用场景</a>
</p>

<p align="center">
<a href="https://www.npmjs.com/package/@wjptz/suncode"><img src="https://img.shields.io/npm/v/@wjptz/suncode.svg?style=flat-square&color=2563eb" alt="npm version" /></a>
<a href="https://www.npmjs.com/package/@wjptz/suncode"><img src="https://img.shields.io/npm/dw/@wjptz/suncode?style=flat-square&color=cb3837&label=downloads" alt="npm downloads" /></a>
<a href="https://github.com/wjptz/suncode/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-16a34a.svg?style=flat-square" alt="license" /></a>
<a href="https://github.com/wjptz/suncode/stargazers"><img src="https://img.shields.io/github/stars/wjptz/suncode?style=flat-square&color=eab308" alt="stars" /></a>
<a href="https://github.com/wjptz/suncode-docs"><img src="https://img.shields.io/badge/docs-suncode-0f766e?style=flat-square" alt="docs" /></a>
<a href="https://github.com/wjptz/suncode/issues"><img src="https://img.shields.io/github/issues/wjptz/suncode?style=flat-square&color=e67e22" alt="open issues" /></a>
<a href="https://github.com/wjptz/suncode/pulls"><img src="https://img.shields.io/github/issues-pr/wjptz/suncode?style=flat-square&color=9b59b6" alt="open PRs" /></a>
<a href="https://chatgpt.com/?q=Explain+the+project+wjptz/suncode+on+GitHub"><img src="https://img.shields.io/badge/Ask-ChatGPT-74aa9c?style=flat-square&logo=openai&logoColor=white" alt="Ask ChatGPT" /></a>
</p>

<p align="center">
<img src="assets/trellis-demo-zh.gif" alt="Suncode 工作流演示" width="100%">
</p>

## 为什么用 Suncode？

| 能力 | 带来的改变 |
| --- | --- |
| **自动注入规范** | 将规范沉淀后，Suncode 会在每次会话中按当前任务自动按需注入相关上下文，无需反复说明。 |
| **任务驱动工作流** | PRD、实现上下文、审查上下文与任务状态统一存放于仓库中的项目文件，AI 开发过程保持结构化、可追溯。 |
| **项目记忆** | 工作日志（journal）会保留上一次会话的脉络，因此每次新会话都能基于真实上下文开始。 |
| **团队共享标准** | Spec 随仓库一同版本化，个人总结出的规则与流程可以直接成为整个团队的基础设施。 |
| **多平台复用** | 同一套 Suncode 结构覆盖 AI coding 平台，无需为每个工具单独搭建工作流。 |

## 前置要求

- **Node.js** >= 18
- **Python** >= 3.9

## 快速开始

```bash
# 1. 安装 Suncode
npm install -g @wjptz/suncode@latest

# 2. 在仓库中初始化
suncode init -u your-name

# 3. 或仅初始化你实际使用的平台
suncode init --cursor --opencode --codex -u your-name
```

查看 [Suncode 文档](https://github.com/wjptz/suncode-docs) 了解详细配置步骤。

## 如何使用

使用流程非常简单：

1. **用自然语言描述你的需求。**
2. **与 AI 一起头脑风暴**，一次只回答一个问题，直到 PRD 足够清晰，然后开始实现。
3. **交由 AI 自主推进** —— AI 会调用 Suncode 的实现流程编写代码，并自动依据 Spec、lint、type-check 与测试进行校验。
4. **当工作完成或会话上下文接近上限时收尾任务**。Suncode 会归档任务并更新工作日志。

## 工作原理

Suncode 内部运行一个 4 阶段循环，skill 与子代理均由系统自动调用：

1. **Plan（规划）** —— 头脑风暴流程逐题梳理需求并写入 `prd.md`；涉及资料调研的部分派发给 research agent 处理。阶段产出为一组精选的 Spec 与研究文件，由 `implement.jsonl` / `check.jsonl` 编排。
2. **Implement（实现）** —— implementation agent 依据 PRD 编写代码，所需上下文自动注入，不会执行 git commit。
3. **Verify（验证）** —— check agent 基于 diff 对照 Spec 逐项核查，并运行 lint、type-check 与测试，在能力范围内自动修复。
4. **Finish（收尾）** —— 执行最终检查后，将本轮新增的认知沉淀回 Spec，为下一次会话积累上下文。

## 资源

| 需求 | 链接 |
| --- | --- |
| 在仓库中安装 Suncode | [Suncode 文档](https://github.com/wjptz/suncode-docs) |
| 了解各平台之间的差异 | [Suncode 文档](https://github.com/wjptz/suncode-docs) |
| 查看实际使用场景 | [Suncode 文档](https://github.com/wjptz/suncode-docs) |
| 从 Spec 模板起步 | [Suncode Marketplace](https://github.com/wjptz/suncode-marketplace) |
| 跟进版本更新 | [GitHub Releases](https://github.com/wjptz/suncode/releases) |

## 常见问题

<details>
<summary><strong>Suncode 与 <code>CLAUDE.md</code>、<code>AGENTS.md</code>、<code>.cursorrules</code> 有何区别？</strong></summary>

这些文件本身是有用的入口，但容易在长期使用中变得冗长臃肿。Suncode 在此之上补充了：作用域明确的 Spec、按任务划分的 PRD、工作流关卡、工作区记忆，以及按平台自动生成的适配文件。

</details>

<details>
<summary><strong>Suncode 是否仅支持 Claude Code？</strong></summary>

并非如此。Suncode 是项目层基础设施，可在多种 coding agent 与 IDE 中使用。

</details>

<details>
<summary><strong>Suncode 适合个人开发者还是团队？</strong></summary>

两者皆可。个人开发者主要受益于记忆机制与可复用的工作流；团队使用收益更大——标准统一、任务边界清晰、上下文可审查，且具备跨平台可移植性。

</details>

<details>
<summary><strong>是否需要手动编写每一个 Spec 文件？</strong></summary>

并不需要。多数团队的做法是先由 AI 基于现有代码生成初稿，再人工收紧关键规则。Suncode 的效果取决于是否将高价值规则显式化并纳入版本管理。

</details>

<details>
<summary><strong>团队协作时是否会频繁产生冲突？</strong></summary>

不会。个人工作区的 journal 按开发者独立维护，共享的 Spec 与任务则进入仓库，可以像其他项目产物一样进行评审与改进。

</details>

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=wjptz/suncode&type=Date)](https://star-history.com/#wjptz/suncode&Date)

## 社区与资源

- [文档](https://github.com/wjptz/suncode-docs)
- [GitHub Issues](https://github.com/wjptz/suncode/issues)
- [Marketplace](https://github.com/wjptz/suncode-marketplace)

### 联系我们

<p align="center">
<img src="assets/wx_link8.jpg" alt="微信群" width="260" />
&nbsp;&nbsp;&nbsp;&nbsp;
<img src="assets/feishu-group-qr.jpg" alt="飞书话题群" width="260" />
</p>

<p align="center">
<a href="https://github.com/wjptz/suncode">Suncode 仓库</a> •
<a href="https://github.com/wjptz/suncode/blob/main/LICENSE">AGPL-3.0 License</a> •
Fork 自 <a href="https://github.com/mindfold-ai/Trellis">Mindfold Trellis</a>
</p>
