<p align="center">
<picture>
<source srcset="assets/trellis.png" media="(prefers-color-scheme: dark)">
<source srcset="assets/trellis.png" media="(prefers-color-scheme: light)">
<img src="assets/trellis.png" alt="Suncode Logo" width="500" style="image-rendering: -webkit-optimize-contrast; image-rendering: crisp-edges;">
</picture>
</p>

<p align="center">
<strong>An out-of-the-box engineering framework for AI coding.</strong><br/>
<sub>AI writes code fast, but every session it starts from scratch with no durable memory of your project, conventions, or team requirements. Suncode persists specs, tasks, and memory into your repo, so coding agents work to your engineering standards.</sub>
</p>

<p align="center">
<a href="./README_CN.md">简体中文</a> •
<a href="https://github.com/wjptz/suncode-docs">Docs</a> •
<a href="https://github.com/wjptz/suncode-docs">Quick Start</a> •
<a href="https://github.com/wjptz/suncode-docs">Supported Platforms</a> •
<a href="https://github.com/wjptz/suncode-docs">Use Cases</a>
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
<img src="assets/trellis-demo.gif" alt="Suncode workflow demo" width="100%">
</p>

## Why Suncode?

| Capability | What it changes |
| --- | --- |
| **Auto-injected specs** | Write conventions once, then let Suncode inject the relevant context into each session instead of repeating yourself. |
| **Task-centered workflow** | Keep PRDs, implementation context, review context, and task status in repo-managed project files so AI work stays structured. |
| **Project memory** | Workspace journals preserve what happened last time, so each new session starts with real context. |
| **Team-shared standards** | Specs live in the repo, so one person's hard-won workflow or rule can benefit the whole team. |
| **Multi-platform setup** | Bring the same Suncode structure to AI coding platforms instead of rebuilding your workflow per tool. |

## Prerequisites:

- **Node.js** >= 18
- **Python** >= 3.9

## Quick Start

```bash
# 1. Install Suncode
npm install -g @wjptz/suncode@latest

# 2. Initialize in your repo
suncode init -u your-name

# 3. Or initialize with the platforms you actually use
suncode init --cursor --opencode --codex -u your-name
```

See the [Suncode docs](https://github.com/wjptz/suncode-docs) for setup details.

## How to Use

The workflow is simple:

1. **Describe what you want** in natural language.
2. **Brainstorm** with the AI one question at a time until the PRD is clear, then implementation begins.
3. **Let it run** — the AI calls Suncode's implementation workflow and auto-checks the result against specs, lint, type-check, and tests.
4. **Finish the work** when the task is done or the session context fills up. Suncode archives the task and updates journals.

## How It Works

Suncode runs a 4-phase loop with auto-invoked skills and sub-agents:

1. **Plan** — the brainstorm workflow walks through requirements one question at a time and writes `prd.md`. Research-heavy items go to a research agent. The result is curated specs + research files referenced from `implement.jsonl` / `check.jsonl`.
2. **Implement** — an implementation agent writes code from the PRD with curated context injected, no git commit.
3. **Verify** — a check agent reviews the diff against specs and runs lint, type-check, and tests, self-fixing where it can.
4. **Finish** — a final check runs, then new learnings are promoted back into specs so the next session starts smarter.

## Resources

| Need                            | Link                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Install Suncode in a repo       | [Suncode docs](https://github.com/wjptz/suncode-docs)              |
| Understand platform differences | [Suncode docs](https://github.com/wjptz/suncode-docs)              |
| See the workflow in practice    | [Suncode docs](https://github.com/wjptz/suncode-docs)              |
| Start from spec templates       | [Suncode marketplace](https://github.com/wjptz/suncode-marketplace) |
| Track releases                  | [GitHub releases](https://github.com/wjptz/suncode/releases)       |

## FAQ

<details>
<summary><strong>How is Suncode different from <code>CLAUDE.md</code>, <code>AGENTS.md</code>, or <code>.cursorrules</code>?</strong></summary>

Those files are useful entry points, but they tend to become monolithic. Suncode adds scoped specs, task PRDs, workflow gates, workspace memory, and platform-aware generated files around them.

</details>

<details>
<summary><strong>Is Suncode only for Claude Code?</strong></summary>

No. Suncode is a project layer that works across multiple coding agents and IDEs.

</details>

<details>
<summary><strong>Is Suncode for solo developers or teams?</strong></summary>

Both. Solo developers use it for memory and repeatable workflow. Teams get the larger benefit: shared standards, task boundaries, reviewable context, and platform portability.

</details>

<details>
<summary><strong>Do I have to write every spec file manually?</strong></summary>

No. Many teams start by letting AI draft specs from existing code and then tighten the important parts by hand. Suncode works best when you keep the high-signal rules explicit and versioned.

</details>

<details>
<summary><strong>Can teams use this without constant conflicts?</strong></summary>

Yes. Personal workspace journals stay separate per developer, while shared specs and tasks stay in the repo where they can be reviewed and improved like any other project artifact.

</details>

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=wjptz/suncode&type=Date)](https://star-history.com/#wjptz/suncode&Date)

## Community & Resources

- [Documentation](https://github.com/wjptz/suncode-docs)
- [GitHub Issues](https://github.com/wjptz/suncode/issues)
- [Marketplace](https://github.com/wjptz/suncode-marketplace)

<p align="center">
<a href="https://github.com/wjptz/suncode">Suncode Repository</a> •
<a href="https://github.com/wjptz/suncode/blob/main/LICENSE">AGPL-3.0 License</a> •
Forked from <a href="https://github.com/mindfold-ai/Trellis">Mindfold Trellis</a>
</p>
