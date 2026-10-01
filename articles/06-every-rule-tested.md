---
title: Every rule gets a test, or it shows
published: false
description: In Kiwipow Agent every rule in a spec is delivered by a task and proven by a named test, and a rule without one is flagged on screen.
tags: ai, testing, softwareengineering, architecture
series: A coding agent that plans blind
---

Acceptance criteria are a promise. Somebody writes them, somebody else writes the code, and the connection between the two lives in a review comment and then nowhere. A year later a test fails and nobody can say which promise just broke.

Kiwipow Agent replaces the promise with a chain of names. A rule has a name. A task names the rules it delivers. A test is named after the rule it proves. And a missing link is on screen, not in somebody's memory.

## What you see

Open a feature's Spec tab and every rule carries two marks: the task that built it, and the test that proves it. Click the test and its file opens.

![The Spec tab: each rule with the task that delivers it and the test that proves it](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/spec-coverage.png)

A rule with no test carries a `no test` badge instead. That is the whole interface, and it answers the question reviews never do: is this rule actually proven?

## Rules have names

A spec is a goal, one section per scenario, rules under the scenario, edge cases nested one level under the rule they qualify:

```markdown
## Cancelling an order
- **Cancel command**: an open order can be cancelled by the person who placed it
  - **Shipped order**: a shipped order cannot be cancelled; the customer is offered a return
- **Refund on cancel**: cancelling a paid order refunds it in full
  (docs/intent/orders.md#Cancellation)
```

The name is the bold lead-in. It is unique in the spec and it never changes: a rename carries `(was Old name)`, and the extension follows it through the review, the board and the decisions. There are no acceptance criteria and no invariants, because a criterion restates a rule and the evidence that a rule holds is a test.

This is checked, not hoped for. The extension parses the spec on every write and hands what does not fit straight back to the model on the same tool result.

## Tasks deliver rules by construction

The task board is not written by a model. The extension derives it from the approved spec: one task per scenario, delivering every rule and edge case under it. Every rule is delivered by some task because that is how the board is made, not because someone remembered. Change the spec and the board is derived again, keeping each task's progress.

![The Tasks tab: one task per scenario, its state and its files](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/tasks-tab.png)

## Tested costs something

Each task gets an implementation run of its own. The run cannot edit the board; it moves its task with a tool, and only `tested` is a finish. Marking a task tested means naming, per rule, the test that proves it:

```json
{
  "task": "Cancelling an order",
  "state": "tested",
  "files": ["src/payments/refund-service.ts", "test/payments/refund.test.ts"],
  "proves": [
    { "rule": "Refund on cancel", "file": "test/payments/refund.test.ts", "test": "a_cancelled_order_over_500_is_refunded_in_full" }
  ]
}
```

A task that names no files cannot be marked tested at all, because the test run that follows works over those files. A task marked tested without a test for every rule is answered with the gap on the same tool result, and the gap is flagged on the board and the spec.

## Why you'd want it

"Show me the test that proves this rule" is one click, not an afternoon. Coverage is per requirement, which is the unit anyone outside the team asks about.

No ids to look up and no spreadsheet to keep. And when a test fails a year later, its name tells you which product rule just broke, in the product's own words: `a_cancelled_order_over_500_is_refunded_in_full` needs no ticket to explain it.

## The price

Naming is work, and a bad name is worse than an id. A rule earns its place by changing what gets built or how it is tested.

And the proof is only as good as the test. The board checks that a test is named for every rule; it does not check that the test would fail without the code.

Which of your requirements could you point at a test for, right now?

Next: why the model that plans does not have to be the model that grinds.

---

*Kiwipow Agent is on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=CoderrAB.kiwipow-agent); source and issues are on [GitHub](https://github.com/jgauffin/kiwi-code-agent).*
