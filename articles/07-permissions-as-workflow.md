---
title: Permissions as a workflow, not a dialog
published: false
tags: ai, security, devtools, softwareengineering
series: A coding agent that plans blind
---

Every coding agent asks permission. After a day of it you stop reading, and after a week you turn it off. A gate you always say yes to is not a gate; it is a habit with a button.

So the question is not whether to ask. It is how few times you can be asked while every answer still means something. In KiwiAgent that question got about eleven hundred lines of code, which makes the permission gate the largest single mechanism in the extension.

## Read-only is decided, not declared

Tools that only look never prompt: Read, Glob, Grep, the JSON tools. So does a shell command that only inspects — and that list is a list, not a guess. `ls`, `cat`, `wc`, `grep`, `jq`, `git log`, `dotnet --version`. Anything not on it is presumed to mutate.

The interesting part is the edges, because that is where a sloppy allow-list becomes a hole:

- `git config` is read-only with `--get` or `--list`, and not otherwise.
- `git remote` is read-only bare, with `-v`, `show` or `get-url`; anything else changes a remote.
- `sed` is read-only until `-i`, and `find` until `-delete` or `-exec`.
- `env` is not on the list at all, because it runs a command. It gets unwrapped instead, and what is inside is judged.
- `cd` is read-only if the path stays inside the project, and presumed to leave it otherwise.

None of that is exotic. It is just the work, and skipping it is how "read-only commands run freely" turns into a shell.

## The command line is actually parsed

A gate that half-understands a command line is decoration. So the shell splitter is written against the POSIX Shell Command Language — quoting, token recognition, expansions, redirection, the grammar — plus bash's additions: `[[ ]]`, `(( ))`, `$'…'`, `|&`, `&>`, `<<<`, `{fd}>`, heredocs. It answers three questions: which simple commands actually run, whether any of them writes a file through a redirect, and whether an expansion hides a command we cannot see.

Two consequences worth stating plainly.

**Substitution is never auto-allowed.** If the line contains `$(...)`, backticks or `<(...)`, a command runs that the tokens do not show, so no allow rule can cover it. It gets asked.

**A redirect is a write**, even when the command in front of it only reads. `grep foo src > out.txt` is not a read.

## Your own commands are not asked about

A script in the workspace's root `package.json` runs without a prompt. So does a command from your own `kiwiAgent.verify` rules. You wrote both, and the extension already runs the verify commands itself when a board finishes — asking whether a session may run the same command adds nothing but a click.

It resolves the real forms too: `npm --silent run build`, `yarn build`, `npm test`. A `--prefix` or `--filter` that sends the command to another package drops the exemption, because those scripts are not the ones we read. And a deny rule still wins, because deny is answered first.

A shell call is prompted line by line, each line carrying what the rules in force make of it — allowed by this rule, allowed as a package script, or asked. You can allow a rule for the session or for the project. Rules add up per segment: `npm run build && rm -rf dist` is two decisions, not one.

## Scope per phase, so most prompts never happen

The rest of the noise is removed by not offering the capability at all.

The blind planner may read `docs/**`, the README and the specs, and write one spec. Writing that spec is the job, so it is not a question. `Bash` is denied by bare name, which does more than refuse it: the tool leaves the model's context, so it is never proposed and there is nothing for you to decline. A write into `docs/**` is neither the deliverable nor forbidden, so that one does get the ordinary prompt.

The cleanup pass may write the files it flagged and new files beside them. Everything else is read-only, and it has no shell.

And for a session where you want to get out of the way, there is one switch — "Allow writes" — which lets file writes through without prompting. It still refuses to move or copy anything into or out of the project, and a deny rule or a phase scope still blocks. The switch buys you fewer clicks, never more reach.

## What it buys the organisation

A gate that does not depend on the model's goodwill, and rules that live in the workspace so a team gets the same answers. The log says what ran and what let it through.

## What it buys the developer

The prompt you see is one worth reading. That is the whole benefit, and it is bigger than it sounds: consent stops being a reflex.

## The price

This is unglamorous code with a lot of cases, and it will never be finished — a shell is an adversary with a specification. The fallback is the only safe one: when the gate cannot tell what a line does, it asks.

That closes the series. Seven mechanisms, one idea: put the human judgement where it is cheap, and let machinery do the parts that machinery can be trusted with.
