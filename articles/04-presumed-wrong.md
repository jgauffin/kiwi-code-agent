---
title: The code is the presumed-wrong party
published: false
description: When the spec and the code disagree, Kiwipow Agent turns each disagreement into a decision you rule on, before any code is written.
tags: ai, softwareengineering, architecture, legacy
series: A coding agent that plans blind
---

The spec was written without looking at the code. Sooner or later the two have to meet, and when they do, one of them is wrong.

Most agents settle that quietly, in the code's favour. Kiwipow Agent asks you.

## What you see

Say the spec for order cancellation says a cancelled paid order is refunded in full, and the code has a forgotten rule that refunds nothing over 500. You approve the spec. A minute later the plan bar says **1 to rule on**, and the Decisions tab shows this:

![The Decisions tab: the refund finding, the ways to settle it, and the recommendation](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/decisions.png)

The finding, where it lives, two ways to reword the rule, the planner's pick with one sentence of why, and two more buttons: **Keep the spec** and your own words. You click one. That is the whole interaction.

## How it works

Approving a spec starts a check that reads the repository and looks for one thing: where the code and the spec disagree. Not whether the spec is good, not whether the code is nice. Only disagreements, and only in code the feature will change or build on:

- a business rule in the code that says otherwise;
- existing behaviour the feature would change or break that the spec never mentions;
- something the spec assumes that the code shows to be wrong.

A rule the code accommodates without incident is not reported. An empty list is a valid result, and a common one: the build then starts without asking you anything.

Each disagreement is written to a decisions file:

```markdown
### Refunds over 500 are never paid
- on: Refund on cancel
- finding: RefundService.refund() returns early for amounts over 500
  (src/payments/refund-service.ts); the spec says a paid order is refunded in full
- proposed: a cancelled paid order is refunded in full; refunds over 500 need a manager's approval
- proposed: refunds up to 500 are paid at once; larger ones are queued for a manual payout
- recommended: 1
- because: the limit protects against mistakes, and approval keeps that without leaving customers unpaid
- ruling: keep
```

The check writes the title, the rules it concerns and the finding: one or two sentences, at the one path and symbol that shows it. Then the blind planner, which still cannot read the code, adds the proposals and its recommendation. Keeping the rule is never proposed, because it is always offered.

You rule one decision at a time, and nothing is sent until every one is ruled. With several options there is no default, and no default is the point. Then **Send rulings**: the planner revises the rules (a proposal replaces the rule word for word; `keep` changes nothing), and the check runs again, continuing its own conversation so it does not re-read what it already read.

## Keeping the rule is work, and it becomes work

"Keep the spec" is not a shrug. It is a decision that the code is wrong.

A `keep` ruling is settled: the next check stops reporting the finding, and the finding reaches the implementer in the hand-off of the task that delivers the rule. The spec stands, the code changes. The forgotten limit is now either a rule you confirmed out loud, or work on the board. It cannot stay a mystery a third time.

## The check has no voice

The check has no conversation of its own: one line of progress on the plan bar, and a Stop. What it cannot settle, it writes down for you to rule on. It never asks.

That is a boundary, not a UI detail. A run that cannot ask cannot negotiate with you about its own findings, and ruling on eight written findings is a different job from answering eight chat questions while trying to remember the first.

Findings are temporary by design. The spec never holds one, so the next feature's planner reads rules, not paths. The order of authority is written into the check's prompt: the docs and the approved specs, then the code.

## Why you'd want it

You rule on findings in a wizard, in minutes, before any code exists. The alternative is finding out in review, in a diff, with someone's work already done.

You are told where: one path, one symbol, the rule it concerns. And you get a decision log for free, as a by-product of working: what the code did, what was meant, and what you decided.

## The price

It produces decisions you have to make, and the build does not start around them. Teams used to shipping on assumptions will feel that as friction. It is the same friction, moved to where it is cheap.

What is the oldest rule in your codebase that nobody can explain?

Next: why the agent is not allowed to decide when it is finished.

---

*Kiwipow Agent is on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=CoderrAB.kiwipow-agent); source and issues are on [GitHub](https://github.com/jgauffin/kiwi-code-agent).*
