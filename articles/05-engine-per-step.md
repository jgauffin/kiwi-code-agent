---
title: One workflow, a different model per step
published: false
tags: ai, vscode, architecture, devops
series: A coding agent that plans blind
---

Planning a feature and grinding through eleven tasks are not the same job. One wants the strongest reasoner you can afford. The other wants throughput and a low bill.

Most agents make you pick once, for everything, and then live with it.

## One seam, two engines

Everything above the engine sees a single interface: send a prompt, stream events, answer permission requests, interrupt. That is `CodeSession`, and it is the whole contract. Below it there are two implementations:

- **Claude**, through the Agent SDK — Claude Code as a library, its JavaScript build, spawned under Node with the login Claude Code already has. In practice VS Code's own executable runs it, so there is nothing else to install.
- **Any OpenAI-compatible endpoint**, with its own loop and its own tools: Read, Write, Edit, Glob, Grep, Bash, the JSON tools, Skill, RunScript.

Note the wording: a generic OpenAI-compatible engine. A provider is a name, a base URL, a model list and a key in the editor's secret storage. I run mine against a European endpoint with GLM and Kimi; that is a provider entry, not a feature of the extension.

What matters is that the two engines are not two products. The tools carry the same names and fall under the same permission rules on either. Both read the workspace's `.mcp.json` servers. Both load the same instruction files and the same skills, in Claude Code's own layout, from your profile and from the workspace. A project configured once behaves the same whichever model is running.

## A profile is a way of working

```json
{
  "name": "Balanced",
  "default": { "provider": "Claude", "model": "claude-sonnet-5" },
  "steps": {
    "plan":      { "provider": "Claude", "model": "claude-opus-5" },
    "reconcile": { "provider": "Claude", "model": "claude-opus-5" }
  }
}
```

The steps are the ones the workflow actually has: `chat`, `plan`, `reconcile`, `implement`, `cleanup`, `docs`, `docs-map`. A step named in no profile still runs, on the default — so a step added in a later version needs nobody's configuration changed.

The blind planner wants the best reasoning you can buy, because it is deriving rules from prose and it is the step everything downstream inherits. Mapping the spec against the code wants the same. Implementing a task that already names its files, its context and its approach wants throughput. Building the docs map is bulk summarising, and a cheap model does it fine.

The model a step runs on is a preference, held beside the feature rather than in its plan files. It is a way of working, not part of what the feature is, and changing it never changes the stage a feature is at.

## What it buys the organisation

Cost lands where reasoning is worth paying for. The expensive model runs on two steps out of seven, and the long tail of task work runs on whatever is cheap this quarter.

You choose where the code goes. If your requirement is that source stays with a provider in a particular jurisdiction, that is a provider entry and a profile, not a migration. If a vendor changes its terms, you change a line of JSON; the workflow, the specs and the boards are untouched, because none of them know which engine ran.

And it works in locked-down environments. The Claude engine is JavaScript running under an executable your organisation already approved — there is no unknown native binary to get past whoever guards that. That constraint is why this extension exists at all.

## What it buys the developer

Nothing to relearn when the model changes. Same tools, same prompts, same permission dialog, same plan bar. You can run a whole feature on a cheap endpoint, decide the plan deserves better, and change one setting.

And the comparison becomes honest. Run the same board on two models and the difference shows up in the tasks file, not in your impression of how the chat felt.

## The price

Two engines means one of them is yours to maintain: the own loop is a loop, with tool schemas, streaming, resumption and compaction to look after. Models also differ in tool discipline, and a model that argues with its tool schema will cost you more than it saves. And not every endpoint can resume a conversation, so a step built to continue the previous one starts fresh instead — the workflow is written to survive that rather than depend on it.

Next: what happens when the model needs to touch four hundred files, and you would rather not read four hundred tool calls.
