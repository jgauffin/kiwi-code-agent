---
title: The code is the presumed-wrong party
published: false
tags: ai, softwareengineering, architecture, legacy
series: A coding agent that plans blind
---

The spec was written without looking at the code. Sooner or later the two have to meet.

In Kiwipow Agent that meeting is its own step. A run takes the draft spec and the repository and looks for one thing: where they disagree. Not whether the spec is good, not whether the code is nice. Only the disagreements, and only the ones that stand in this feature's way.

## Three things it looks for

- A business rule in the code that says otherwise.
- Existing behaviour the feature would change or break that the spec never mentions.
- Something the spec assumes that the code shows to be wrong.

A rule the code accommodates without incident is not reported. An empty list is a valid result, and a common one.

## Each disagreement becomes a decision with your name on it

```markdown
### Shipped orders cannot be cancelled
- on: Cancel command
- finding: OrderService.Cancel() throws for any order past Shipped
  (src/orders/order-service.ts); the spec says an open order can be cancelled
  and says nothing about shipped ones
- proposed: an order can be cancelled until it ships; a shipped order is returned
- proposed: an order can be cancelled at any time; after shipping it becomes a return
- ruling: keep
```

The run writes the title, the `on` line naming the rules it concerns, and the `finding`: one or two sentences, at the one path and symbol that shows it. Not how it was found, not what the spec should say instead.

Then the plan session — the blind one, which still cannot read the code — is handed the titles and adds one to three `proposed` lines: each the rule's new text, as it would stand in the spec. Keeping the rule is never proposed, because it is always offered.

You rule in a wizard, one decision at a time: take one of the proposals, keep the rule and let the code change, or write your own words. Picking writes the `ruling` line and moves on. Nothing is sent until every decision is ruled — with several options there is no default, and no default is the point.

Then the planner revises the rules. A proposal's text replaces the rule verbatim, so the rule stays one sentence rather than growing a paragraph of history. `keep` moves nothing. Your own words are worked in.

## Keeping the rule is work, and it becomes work

This is the part that matters. "Keep the spec" is not a shrug — it is a decision that the code is wrong. The re-map writes the code change into the task that touches it, stops reporting the finding, and the implementer reads the decisions file for it.

So the fifty-percent cap that nobody remembers adding is either a rule you confirm out loud, or a task on the board. It cannot stay a mystery a third time.

Approval is refused while a decision is pending. You approve what the planner wrote, not what it proposed.

## The run has no voice

The mapping run has no conversation of its own. No tab, no transcript in your face, one line of progress on the plan bar and a Stop. What it cannot settle it writes down for you to rule on. It never asks.

That sounds like a UI detail. It is a boundary: a run that cannot ask cannot negotiate with you about its own findings, and a person ruling on eight written findings is doing something quite different from a person answering eight chat questions while trying to remember the first one.

Findings are also temporary by design. The spec never holds one, so the planner of the next feature reads rules, not paths. A decision the mapping no longer finds is marked `[withdrawn]` rather than deleted.

## Authority is fixed, and written down

Work item first. Then the docs and the approved specs. Then the code. The order is in the prompt, not in the model's mood.

And the board knows when it is stale: the tasks file records a fingerprint of the spec it was mapped from. Change the spec under a mapped board and approval is refused until the board is re-mapped.

## What it buys the organisation

A decision log that is a by-product of working, not an artefact somebody was nagged into writing. Each entry says what the code did, where, what was meant, and what you decided — and what you decided reaches the next feature through the approved spec.

Drift stops being a vague worry and becomes a list per feature, mostly empty, occasionally alarming.

## What it buys the developer

You rule on eight findings in a wizard, in minutes, before code exists. The alternative is finding out in review, in a diff, with someone's work already done.

And you get told where: one path, one symbol, the rule it concerns.

## The price

It produces decisions you have to make, and it will not let you approve around them. Teams used to shipping on assumptions will feel that as friction. It is the same friction, moved to where it is cheap.

Next: how a feature is declared finished by something that has no opinion at all.
