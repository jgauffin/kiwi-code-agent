---
title: The expensive part of AI coding is not the tokens
published: false
description: Three questions to ask of any coding-agent setup before you scale it across a team, and how Kiwipow Agent answers them.
tags: engineering leadership, ai, software quality
cover_image: https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/cover-cost.png
---

Your team has coding agents now, whether you decided it or not. The demo is persuasive: a feature in a minute, tests included. The bill does not arrive with the feature. It arrives in the review that takes longer than the work, in the bug that turns out to be a rule nobody remembers agreeing, and in the quarter where nobody can say what the system promises any more.

That is the cost worth managing, and tokens are not it. Three questions decide whether an agent setup is cheap or expensive over a year.

## 1. Where does intent live?

Ask where the agent learns what the product is supposed to do. In almost every setup, the answer is the code. The agent reads the repository and plans from it.

That is the part worth pausing on. A codebase is not a statement of intent. It is a record of decisions, some of them deliberate, many of them workarounds nobody revisited. Say a refund service quietly pays nothing over 500, added years ago against a payment provider that no longer exists. An agent that reads the code before it plans will find that limit, and the limit will become a requirement. Nobody chose that. It arrives in a plan that reads perfectly reasonably.

Kiwipow Agent takes the other route. The planner is not allowed to read the code. It reads your docs, your README and the specs of features planned before, and writes the feature as named rules in the product's own language. Only afterwards does a separate pass read the code and report where the two disagree. Each disagreement comes to a person as a decision with proposed wordings and a recommendation.

![A disagreement between the spec and the code, arriving as a decision with proposed wordings and a recommendation](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/decisions.png)

So the 500 limit still surfaces. It surfaces as a question with somebody's name against the answer, instead of as a line in a spec. Over a year, that is the difference between a system that says what you meant and one that has quietly agreed with its own past mistakes.

## 2. What counts as done?

An agent reporting "done" is a claim. In most setups it is the only artefact that connects the request to the result.

Here the chain is made of names. A rule has a name. The task board is derived from the approved spec by the extension, not written by a model, so every rule is delivered by some task by construction. A task can only be finished by naming, per rule, the test that proves it. Then the extension runs your test commands with no model involved, over the projects the feature touched, and a failure goes back for a bounded number of attempts before it reaches a person.

The practical consequence is for the conversations you have outside the team. "Show me the test that proves this rule" is one click. When a test fails next year, its name says which promise broke, in your product's words rather than a file path.

## 3. What stops it drifting?

Most of the cost of agents shows up after the feature ships, when the next twenty changes erode it. A spec approved in March is worth nothing if a chat in June quietly undoes it.

Every session that changes code is pointed at the approved specs, checks the ones covering what it is about to change, and asks before it breaks a rule. Agreed changes are written back into the spec, so the record stays current rather than becoming archaeology. A decision that reaches further than one feature is recorded where the next planner will read it.

The effect compounds, and it is the part I undersell when I talk to developers. Every approved spec constrains every feature planned after it. The twentieth feature cannot quietly redefine what the third one promised, because the planner reads the third one's rules as settled before it writes a line. The usual pattern with agent-written code is that the system gets harder to reason about as it grows. This one gets more constrained.

## What it actually costs

More than asking a chat for the feature, and I would rather say so plainly. A planning session, a check that reads the code, decisions a person has to rule on, an implementation run per task, a mechanical test run, a cleanup pass. The tokens are real, and so is the attention: this workflow asks a developer to make decisions rather than to accept a diff.

What you are buying is not speed. It is that the intent exists outside the code, in a form a person reads and a test proves, and that it keeps being checked after the feature ships.

## What you need before you start

Less than you would think. The planner reads what you have written down, and most teams have more than they credit. A maintenance job reads your existing docs, proposes which of their feature descriptions become specs, checks each against the code and boards the tests that prove them, so you start from where you are.

If nothing is written down at all, there is a skill that reads the source and drafts specs from it. That is honest work with an honest caveat: what comes out is what the code does, workarounds included, and it says so, writing the constants it cannot justify as questions for you rather than as rules. Once the tests are green, ask a session to read those specs back and report what contradicts, what nobody would ask for and what is missing. I have yet to see that come back empty.

## Who should not buy this

Teams whose product is a prototype, where writing the intent down costs more than the code it would guard. Teams who want the agent to decide and the humans to approve. This workflow does the opposite: the machine does the drafting, the checking and the running, and the judgment calls arrive on screen, named, waiting for a person.

If that sounds like overhead, it is. It is the overhead you are already paying in reviews and incidents, moved somewhere you can see it.

---

Companion piece: [how you know the agent is not quietly rotting your codebase](https://github.com/jgauffin/kiwi-code-agent/blob/main/articles/cto-no-silent-decay.md).

*Kiwipow Agent is a VS Code extension, on the [Marketplace](https://marketplace.visualstudio.com/items?itemName=CoderrAB.kiwipow-agent); source and issues on [GitHub](https://github.com/jgauffin/kiwi-code-agent).*
