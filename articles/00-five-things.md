---
title: Five things I wanted from a coding agent, so I built one
published: false
description: Kiwipow Agent is a VS Code coding agent that plans from intent, keeps approved rules approved, and calls nothing done without a test.
tags: ai, vscode, productivity, testing
cover_image: https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/cover.png
series: A coding agent that plans blind
---

Coding agents are good at writing code. What they are bad at is everything around it: knowing what the code should do, remembering what you decided last month, proving a change works, and not tripping over each other.

Kiwipow Agent is a VS Code extension built around those gaps. It runs Claude, or any OpenAI-compatible model, and it is opinionated about how a feature gets from an idea to green tests. These are the five things it does that I could not get anywhere else.

## 1. It plans from your intent, not from your code

Every codebase carries workarounds. Say yours has a refund service that quietly pays nothing over 500, added years ago against a payment-provider limit that no longer exists. An agent that reads the code before planning finds the limit, and the limit becomes a requirement. The spec looks reasonable, and it has absorbed a bug as a rule.

So the feature planner is not allowed to read the code. It reads your docs, the README and the specs of features planned before, and nothing else. That is enforced where the tool call is made, not requested in a prompt. It writes a spec of named rules in the product's language:

```markdown
## Cancelling an order
- **Cancel command**: an open order can be cancelled by the person who placed it
  - **Shipped order**: a shipped order cannot be cancelled; the customer is offered a return
- **Refund on cancel**: cancelling a paid order refunds it in full
```

The code gets its say afterwards. Once you approve the spec, a separate check reads the code and reports only where the two disagree. Each disagreement becomes a decision with proposed rewordings and a recommendation. You rule: change the rule, or keep it and let the code change.

![The Decisions tab: a disagreement between spec and code, with the ways to settle it](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/decisions.png)

The 500 limit still surfaces. It surfaces as a question with your name on it, not as a line in a spec.

## 2. Approved rules stay approved, so the codebase settles instead of drifting

A spec you approved in March is worth little if a chat in June quietly undoes it.

Every session that changes code (a chat, a code plan, an implementation run) is told where the approved specs are, checks the ones that cover what it is about to change, and asks you before it breaks a rule. If you agree to the change, the session amends the rule in its spec. If the decision reaches further than one feature, it is written to an unfiled-decisions file that the next planner reads.

This is the model's own reasoning, not a hard block, so it is as good as the model you run. I tried a mechanical version first, with file watchers and rule-to-test indexes, and threw it away: the session that changes the code is the one best placed to notice a rule, and a broken test is caught by the test run anyway.

The effect compounds, and this is the part I undersold for a long time. Every approved spec is a constraint on every feature planned after it: the planner reads the settled ones before it writes a rule, so the twentieth feature cannot quietly redefine what the third one promised. Most agents start each task from a blank slate, and the only memory of past decisions is the code itself, which is the one memory that carries every workaround as if it were a requirement. Here the memory is a set of named rules in your product's language, and it grows with the product instead of eroding with it. The practical difference is that the system gets more stable as it gets bigger, which is the opposite of what agent-written code usually does.

## 3. "Done" comes with evidence

An agent saying "done" is not evidence. A passing test is.

Every task on the board names the test that proves each rule it delivers. The spec view shows, per rule, the task that built it and the test that proves it, or the gap.

That the tests come from the rules rather than from the implementation matters more than the bookkeeping. A test written from code asserts what the code already does, which is why agent-written suites pass the moment they are written and break the moment anyone refactors. A test written from a rule asserts the promise: `Refund on cancel` fails when cancelling stops refunding, not when a service is split in two. So the suite is a regression net rather than a snapshot, it survives the restructuring you will do later, and a red test names the promise that broke instead of the line that changed.

![The spec view: each rule with the task that delivers it and the test that proves it](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/spec-coverage.png)

When every task is tested, the extension runs your test commands with no model involved, over just the projects the feature touched. A backend-only feature runs the backend tests, not the frontend bundle. A failure goes back to an implementer with the output, up to a budget you set, and only then to you.

A task marked tested without a named test is flagged on the board, not refused. You see it, but nothing stops it.

## 4. One script, one diff

Ask an agent to rename something across two hundred files and you get two hundred reads, two hundred edits and a transcript nobody reviews.

Kiwipow Agent lets the model write one JavaScript program instead. It runs in a sandboxed interpreter with no file system, network or process access of its own. The only way out is a short list of functions (read, write, edit, move, glob, grep, search), and every call goes through the same permission gate as the model's own tool calls. There is deliberately no shell in it: a loop of commands would be a loop of permission prompts.

Nothing is written while the script runs. When it ends, you get every changed file as one diff and approve or decline the whole set.

Only what the script returns enters the conversation, so the cost of "look at every file and tell me X" scales with the answer, not with the number of files.

## 5. Safe to run several agents at once

I run several sessions in one workspace. Agents that share files overwrite each other, then fail each other's tests, then try to fix each other's code.

A session cannot write a file it has not read, or one that changed since it read it. The refusal says which session changed it, so the model knows to read again rather than retry blindly.

![A write refused because another session changed the file, naming the session that changed it](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/stale-write.png)

Verification knows who wrote what, too. When a test fails only in code another session changed, the run waits, retries once, and then holds the failure for you instead of handing it to your implementer to "fix".

## Also: a different model per step

Planning wants the strongest reasoner you can afford. Implementation wants throughput. A profile sets the model per step, and Claude and any OpenAI-compatible endpoint run the same workflow with the same MCP servers, instruction files (`CLAUDE.md`, `AGENTS.md`), skills and permission rules.

![Profiles: a model chosen per step](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/profiles-list.png)

## It costs more, on purpose

All of this spends more than asking a chat for the feature. A planning session, a check that reads the code, a decision you rule on, an implementation run per task, a test run, a cleanup pass: the tokens are real and so are the minutes.

What they buy is accuracy that lasts. The feature says what you meant rather than what the code happened to do. It does not contradict the feature you shipped last month, because the planner reads that one's approved spec as settled before it writes a rule. Every rule is proven by a test named after it, so a year later a failure tells you which promise broke. And the spec does not stop mattering once the board is green: every session that changes code checks the specs covering what it is about to touch, and asks you before it breaks a rule. Nothing erodes quietly between releases.

A fast agent hands you code in a minute and sends the bill later, in a review, a bug report, or a rule nobody remembers deciding. Slower process, more accurate result.

## Who it's for, and who it isn't

It is for teams whose intent lives somewhere other than the code: docs, specs, tickets, a README that says what the product is. The more that is written down, the better the planner plans, and the more a forgotten workaround stands out against it.

It is not for a weekend prototype, where writing the intent down costs more than the code it would guard. For that, use its plain chat session, or any other agent.

## What it asks of you

- **Something about the product has to be written down.** The planner can't read the code, so it reads what you wrote. You don't have to write the specs first: the *Clean up docs* job reads the docs you already have, proposes which of their feature descriptions become specs, checks each one against the code and builds a board that adds the tests proving its rules. You start from where you are.
- **If nothing is written down, start from the code and know what that costs.** A skill ships for exactly that: ask a chat session to read the source and draft specs from it. It is honest, because what comes out is what the code actually does, workarounds included, and it says so. A constant with no reason behind it is written as a question for you rather than as a rule. Then let the tests get written, and ask a session to read the specs back: rules that contradict each other, rules nobody would ask for, gaps nobody filled. I have yet to see that pass come back empty.
- **It is opinionated.** Plan, check, rule, implement, verify. For a one-line fix, use a plain chat session; it is there.
- **It is early.** Windows only for now (x64 and arm64), and you will hit bugs. They get fixed fast.

## Try it

Install **Kiwipow Agent** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=CoderrAB.kiwipow-agent). Claude sessions run on an Anthropic API key or an existing Claude Code login. Press `+`, pick **Feature planning** and describe a feature.

The source and issue tracker are on [GitHub](https://github.com/jgauffin/kiwi-code-agent).

Which of the five would you want first?

Next: [one feature, from a sentence to green tests](https://github.com/jgauffin/kiwi-code-agent/blob/main/articles/01-one-feature.md), following that refund limit all the way through.
