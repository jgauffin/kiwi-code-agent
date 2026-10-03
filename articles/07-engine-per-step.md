---
title: One workflow, a different model per step
published: false
description: Kiwipow Agent runs the strongest model where it decides what gets built and a cheap one where it grinds, on Claude or any OpenAI-compatible endpoint.
tags: ai, vscode, architecture, devops
series: A coding agent that plans blind
---

Planning a feature and grinding through its tasks are not the same job, and they should not cost the same.

Planning decides what gets built. A wrong rule there is inherited by every task after it, so it wants the strongest reasoner you can afford. Implementing a task that already names its rules and where the code lives is throughput work, and a cheap fast model does it fine. Most agents make you pick one model for everything, and you pay the planning price for the grinding.

## What you see

A profile in settings, with a model and an effort level per step.

![Profiles: a model and effort chosen per step](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/profiles-list.png)

In JSON it is this:

```json
{
  "name": "Balanced",
  "default": { "provider": "Claude", "model": "claude-sonnet-5-5" },
  "steps": {
    "plan":      { "provider": "Claude", "model": "claude-opus-5-5", "effort": "high" },
    "reconcile": { "provider": "Claude", "model": "claude-opus-5-5" }
  }
}
```

The expensive model runs on feature planning and on the check against the code, the two steps that decide what gets built. Everything else runs on the default.

## How it works

The steps are the ones the workflow has: `chat`, `plan` (feature planning), `code-plan`, `reconcile` (the check against the code), `implement`, `fix`, `cleanup`, `docs`, `docs-map` and `file-decisions`. A step can set a model, an effort level, or both; what it leaves out comes from the default. A step named in no profile runs on the default, so a step added in a later version needs nobody's configuration changed.

The model is set in the active profile alone, never per feature: it is your way of working, not part of what the feature is. Change the profile and a feature's runs pick it up on their next turn.

Under the profile there are two engines:

- **Claude**, through the Agent SDK, on an Anthropic API key or the login Claude Code already has. VS Code's own executable runs it, so there is nothing else to install.
- **Any OpenAI-compatible endpoint**, on the extension's own loop and tools. A provider is a name, a base URL, a model list and a key in the editor's secret storage. I run GLM and Kimi on a European endpoint that way; it is a provider entry, not a feature.

The two are not two products. The tools carry the same names and fall under the same permission rules. Both use the MCP servers from `~/.mcp.json` and the workspace's `.mcp.json`, and both load the same `CLAUDE.md`, `AGENTS.md` and skills. A project configured once behaves the same whichever model runs.

## Why you'd want it

Cost lands where reasoning is worth paying for, and the long tail of task work runs on whatever is cheap this quarter.

Nothing to relearn when the model changes: same tools, same prompts, same permission dialog, same plan bar. A chat can switch model mid-conversation; a turn already running finishes on the model it started on.

You choose where your code goes. If it has to stay with a provider in a particular jurisdiction, that is a provider entry, not a migration. If a vendor changes its terms, you change a line of JSON, and the specs and boards are untouched because none of them know which engine ran.

And the comparison becomes honest. Run the same board on two models and the difference shows up on the board, not in your impression of how the chat felt.

## The price

Models differ in tool discipline, and a model that argues with its tool schema will cost you more than it saves. A conversation only carries over on the same engine: a run that would continue the previous one starts fresh on another engine, from the files on disk. The workflow is written to survive that rather than depend on it.

Which step of your work would you never trust to a cheap model?

Next, and last: the permission gate all of this leans on, and why you should have to read far fewer prompts than you do.

---

*Kiwipow Agent is on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=CoderrAB.kiwipow-agent); source and issues are on [GitHub](https://github.com/jgauffin/kiwi-code-agent).*
