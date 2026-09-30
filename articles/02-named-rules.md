---
title: Named rules, and the test that proves each one
published: false
tags: ai, testing, softwareengineering, architecture
series: A coding agent that plans blind
---

Acceptance criteria are a promise. Somebody writes them, somebody else writes the code, and the connection between the two lives in a review comment and then nowhere.

Kiwipow Agent replaces the promise with a chain of names. A rule has a name. A task names the rules it delivers. A test is named after the rule it proves. Nothing in the chain is a synthetic id, and nothing is allowed to say "done" while a link is missing.

## The spec has a shape, and the shape is checked

A spec is a goal, one section per scenario, rules under the scenario, edge cases nested one level under the rule they qualify:

```markdown
## Cancelling an order
- **Cancel command**: an open order can be cancelled by the person who placed it
  (docs/intent/orders.md#Cancellation)
  - **Shipped order**: a shipped order cannot be cancelled; the customer is offered a return
- **Refund on cancel**: cancelling a paid order refunds it in full
```

The name of a rule is the bold lead-in of its line. It is unique in the spec, and it never changes: a rename carries `(was Old name)` after the new name, and the extension follows that through every other file so nothing is left pointing at a name that is gone.

`Goal` and `Open questions` are reserved. Every other `##` is a scenario. There are no invariants, no acceptance criteria and no task section, because an invariant is a rule, an acceptance criterion restates one, and the evidence that a rule holds is a test.

This is not a style guide in a prompt. The extension parses the spec on every write, and what does not fit the contract is handed straight back to the model on the same tool result. A spec that drifted out of shape before the contract existed gets a Repair button.

## Tasks deliver rules, by name

Mapping the spec against the code produces a board, one task per scenario by default:

```markdown
## Cancelling an order
- **Cancel command** (Cancel command, Shipped order): add the cancel command
  - files: src/orders/cancel.ts, src/orders/cancel.test.ts (new)
  - context: src/orders/order.ts, src/orders/ship.test.ts
  - how:
    - add `cancel()` on `Order` beside `ship()`, same guard shape
    - the handler follows src/orders/ship.ts; the test mirrors src/orders/ship.test.ts
```

The parenthesis is the link: this task delivers those rules. A rule no task delivers shows up as a gap, immediately, before anybody writes code. `files:` is kept true to what was touched. `context:` is what the mapping read to arrive at the task, and `how:` is the instruction it built from that reading, so an implementer that never had the mapping conversation starts from three lines instead of a search.

Task names are stable across re-runs too: a re-run keeps, updates, or marks `[removed]`. It never renames.

## A task is not done until it can name its test

The implementer marks each task `[in progress]`, `[done]`, `[tested]` or `[blocked: reason]` in the file, so task four of seven survives a session that ended and shows in the view. Only `[tested]` is a finish, and `[tested]` costs something:

```
proves: Cancel command → test/orders/cancel.test.ts an_open_order_can_be_cancelled,
        Shipped order → test/orders/cancel.test.ts a_shipped_order_cannot_be_cancelled
```

Per delivered rule: the test file, and the test whose name states the rule. The view then shows, on every rule and edge case, which task delivers it and which test proves it — or `no task`, or `no test`. A task marked tested that names no test for a rule it claims to deliver is flagged.

That is the whole trick. The traceability people buy tools to fake is a line in a markdown file that the state machine refuses to accept without.

## What it buys the organisation

"Show me the test that proves this rule" is one click, not an afternoon. Coverage is reported per requirement rather than per line, which is the unit anybody outside the team actually asks about.

The state cannot drift from the files, because it is derived from them. Add a task to a finished board and the feature is unfinished again, with nothing to reset.

## What it buys the developer

No ids to look up and no spreadsheet to keep. You read a rule and see whether it is built and whether it is proven. When a test fails a year later, its name tells you which product rule just broke, in the product's own words.

## The price

Naming is work, and a bad name is worse than an id. A rule earns its place by changing what gets built or how it is tested; everything else is prose that will be maintained by nobody.

Next: what happens when the spec and the code disagree — and why the code is the presumed-wrong party.
