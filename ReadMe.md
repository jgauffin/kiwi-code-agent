# Kiwipow Agent

<!-- github-only -->
![Kiwipow Agent logo](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/docs/logos/kiwipow-agent-logo-128.png)
<!-- /github-only -->

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code%20Marketplace-install-007ACC)](https://marketplace.visualstudio.com/items?itemName=CoderrAB.kiwipow-agent)
[![GitHub](https://img.shields.io/badge/GitHub-repo-181717?logo=github)](https://github.com/jgauffin/kiwi-code-agent)
[![Homepage](https://img.shields.io/badge/homepage-coderr.io-blue)](https://coderr.io)

A VS Code coding agent that plans a feature before it reads your code, and calls nothing done until a test proves each rule.

> **Early days.** Kiwipow Agent is young and you will hit bugs. Things are changing frequently, use at own risk! [Report them](https://github.com/jgauffin/kiwi-code-agent/issues); they usually get fixed fast.

## Why it's different

| | What it does | Why you want it |
|---|---|---|
| **Plans from intent, not from code** | The planner reads your docs and approved specs, never the code (enforced at the tool call), and writes a spec of named rules. A separate check then reads the code and turns each disagreement into a decision you rule on. | A planner that reads the code inherits its bugs as requirements. Here a bug surfaces as a question with your name on it. |
| **Approved rules stay approved** | Every session that changes code (chat, code plan, implement) checks the approved specs that cover the change and asks before breaking a rule. Decisions made along the way are filed where the next planner reads them. | A rule you settled in March is not undone by a chat in June. |
| **Done comes with evidence** | Every task names the test that proves each rule it delivers, and the plan view shows each rule's test or the gap. When all tasks are tested, your test commands run over just the projects the feature touched; a failure goes back to the implementer. | No "done" without evidence you can click through, and only the suites that matter run. |
| **One script, one diff** | The model writes one JavaScript program that reads, searches, moves and edits across many files, in a sandbox that reaches nothing but gated functions. Edits are staged and shown as one diff to approve. | One turn instead of dozens: faster, cheaper, and you review a diff instead of a conversation. |
| **Safe with parallel agents** | A session cannot write a file it has not read, or one that changed since; the refusal names the session that changed it. A test failing only on another session's change is held for you, not handed to your implementer. | Run several agents in one workspace without them fixing, or overwriting, each other's work. |

## Any model, per step

- **Claude** through the Claude Agent SDK.
- **Any OpenAI-compatible endpoint** on Kiwipow Agent's own tool loop.
- A profile picks the model per step: the strongest reasoner for planning and mapping, a fast cheap one for implementation.
- Your `.mcp.json` servers (the workspace's and `~/.mcp.json`, with Claude Code's user-wide list moved there on first run), `CLAUDE.md`/`AGENTS.md`, skills and permission rules work the same on both.

## Also

- **Cleanup after green**: functions, types and files that grew past your limits are split once tests pass.
- **Docs evaluation**: reads your docs the way the planner does, says where their arrangement costs a plan, and fixes what you pick. Optionally, the planner cuts the doc sections an approved spec now covers, so intent lives in one place.
- **Chat sessions** for everyday work, with the full tool set.
- **Plan sessions** for work the code shapes, such as a UI on its framework: intent is agreed before the code is read, then the plan is made against the code and built in a chat.
- **Prompts that don't nag.** Read-only tools and commands, your `package.json` scripts and your test commands run without asking; other shell calls are prompted command by command.
- **Large JSON without reading it whole**: query a file by expression and get back only the rows you asked for.

## Get started

Install **Kiwipow Agent** from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=CoderrAB.kiwipow-agent). Windows only (x64, arm64).

Claude sessions need one of:

- an **Anthropic API key**, added to the Claude provider on the settings page (gear icon), or
- a **Claude Code login** already on this machine, used when no key is set.

Open Kiwipow Agent in the activity bar, press `+`, pick **Feature planning** and describe the feature. For a non-Claude model, add a provider on the settings page.

## More

- [docs/plan-sessions.md](docs/plan-sessions.md): the feature planning workflow step by step, and Plan sessions.
- [docs/settings.md](docs/settings.md): every setting, MCP servers, logs.
- [docs/developing.md](docs/developing.md): build from source.
- [docs/intent/agent.md](docs/intent/agent.md): why it works this way.
