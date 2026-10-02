---
title: Permissions as a workflow, not a dialog
published: false
description: How Kiwipow Agent asks fewer permission questions while every answer still means something, by parsing the shell and scoping each phase.
tags: ai, security, devtools, softwareengineering
series: A coding agent that plans blind
---

Every coding agent asks permission. After a day of it you stop reading, and after a week you turn it off. A gate you always say yes to is not a gate; it is a habit with a button.

So the question is not whether to ask. It is how few times you can be asked while every answer still means something.

## What you see

Say the implementer fixing the refund limit runs `npm run test -- refund && rm -rf coverage`. You do not get one yes-or-no for the whole line. You get the line split into its commands, each with what the rules make of it: the test run passes as one of your own `package.json` scripts, and only the `rm` is asked.

![A shell prompt line by line: what already passes, and what is asked](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/shell-prompt.png)

You can allow a rule for the session or for the project, and rules add up per command: one line can be two decisions.

## Read-only is decided, not declared

Tools that only look never prompt: Read, Glob, Grep, the JSON tools. Neither does a shell command that only inspects, and that list is a list, not a guess: `ls`, `cat`, `wc`, `grep`, `jq`, `git log`. Anything not on it is presumed to mutate.

The interesting part is the edges, because that is where a sloppy allow-list becomes a hole:

- `git config` is read-only with `--get` or `--list`, and not otherwise.
- `sed` is read-only until `-i`.
- `env` is not on the list at all, because it runs a command. It is unwrapped, and what is inside is judged.

## The command line is actually parsed

A gate that half-understands a command line is decoration. The shell splitter is written against the POSIX Shell Command Language plus bash's additions (`[[ ]]`, `(( ))`, `$'…'`, `|&`, `&>`, `<<<`, heredocs). It answers three questions: which commands actually run, whether any of them writes a file through a redirect, and whether an expansion hides a command we cannot see.

**A substitution is looked inside.** The commands in `$(...)`, backticks or `<(...)` are judged on their own, like any other. What is never auto-allowed is a substitution where the command name goes: `$(which rm) -rf x` runs whatever it prints, no rule can name that, so it is always asked.

**A redirect is a write**, even when the command in front of it only reads. `grep foo src > out.txt` is not a read.

## Your own commands are not asked about

A script in the workspace's root `package.json` runs without a prompt, and so does a command from your own `kiwiAgent.verify` rules. You wrote both, and the extension runs the verify commands itself when a board finishes. Sessions are told to prefer your scripts over calling `npx` or `tsc` directly, for exactly that reason.

The real forms count too: `npm --silent run build`, `yarn build`, `pnpm`, `bun`. A `--prefix`, `--filter` or `--workspace` that sends the command to another package drops the exemption, because those are not the scripts we read. A deny rule still wins; deny is answered first.

## Scope per phase, so most prompts never happen

The rest of the noise is removed by not offering the capability at all.

The blind planner may read `docs/**`, the README and the specs, and write its own spec. Writing that spec is its job, so it is not a question. It has no shell in its tool set, so a shell is never proposed and there is nothing to decline. The cleanup run may write the files it flagged and new files beside them, and has no shell either.

Every session has a scratch folder where it writes without asking. And when you want to get out of the way, one switch, "Allow writes", lets writes below the project root through without prompting, from a file tool or the shell. Tick it while a prompt is on screen and that prompt is answered too, if the switch covers the call: it replaces the click rather than being asked for twice. A move or copy with one end outside the project still asks, and a deny rule or a phase scope still blocks. The switch buys fewer clicks, never more reach.

If git is not the agent's business in your project, one setting denies every git command that changes the repository, whatever the allow rules say. Status, log and diff still run.

## Why you'd want it

The prompt you see is one worth reading. That is the whole benefit, and it is bigger than it sounds: consent stops being a reflex.

The gate does not depend on the model's goodwill, the rules live in the workspace so a team gets the same answers, and the log says what ran and what let it through.

## The price

This is unglamorous code with a lot of cases, and it will never be finished: a shell is an adversary with a specification. The fallback is the only safe one: when the gate cannot tell what a line does, it asks.

How many permission prompts did you actually read today?

That closes the series. Seven mechanisms, one idea: put the human judgement where it is cheap, and let machinery do the parts that machinery can be trusted with.

---

*Kiwipow Agent is on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=CoderrAB.kiwipow-agent); source and issues are on [GitHub](https://github.com/jgauffin/kiwi-code-agent).*
