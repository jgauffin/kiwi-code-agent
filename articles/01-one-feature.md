---
title: One feature, from a sentence to green tests
published: false
description: A walk through Kiwipow Agent on one feature, from a one-line description to a spec, a decision, a board, proven rules and a green test run.
tags: ai, vscode, testing, tutorial
cover_image: https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/cover.png
series: A coding agent that plans blind
---

The last article listed what Kiwipow Agent does differently. This one shows it, on one feature, from the sentence you type to the test run that says it works.

Picture a shop with an order system. The docs say, under `docs/intent/orders.md#Cancellation`, that a cancelled paid order is refunded in full. The code has a secret: `RefundService.refund()` quietly returns without refunding anything over 500. Somebody added that years ago, against a payment-provider limit that no longer exists, and nobody remembers why.

You want customers to be able to cancel their own orders.

## 1. Describe it

Press `+`, pick **Feature planning**, and write one sentence: *customers can cancel an order they placed*.

![The new-session screen with Feature planning picked](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/new-session.png)

The session that starts can read your docs, the README and earlier specs. It cannot read the code, and that is enforced on every tool call. [Why it works that way](https://github.com/jgauffin/kiwi-code-agent/blob/main/articles/03-plan-blind.md).

## 2. Agree on a direction

The planner does not write anything yet. It answers in chat with the few decisions that shape the feature and the questions only you can settle: can a shipped order be cancelled? Is an unpaid order refunded or just released?

![The planner's direction in chat, before any file is written](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/plan-direction.png)

You answer, and say go.

## 3. Read the spec

The planner writes `plan/order-cancellation.spec.md`: named rules in the product's language, each citing the doc section it came from.

```markdown
## Cancelling an order
- **Cancel command**: an open order can be cancelled by the person who placed it
  - **Shipped order**: a shipped order cannot be cancelled; the customer is offered a return
- **Refund on cancel**: cancelling a paid order refunds it in full
  (docs/intent/orders.md#Cancellation)
```

Notice what is not there: the 500 limit. The planner never saw it.

![The Spec tab: rules with their citations](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/spec-tab.png)

You can comment on any rule or strike it; the planner answers each comment and revises. When it reads right, press **Approve**.

## 4. The code gets its say

Approving starts a check that reads the code against the spec. It has no chat of its own, just one line of progress on the plan bar.

![The plan bar while the check reads the code](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/check-line.png)

It finds the limit. The plan bar now says **1 to rule on**, and the Decisions tab shows the finding: `RefundService.refund()` returns early for amounts over 500, while the spec says a paid order is refunded in full. The planner has proposed two rewordings and recommends one.

![The Decisions tab: the refund finding, the ways to settle it, and the recommendation](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/decisions.png)

The limit has no reason to exist any more, so you pick **Keep the spec**: the rule stands, the code changes. Then **Send rulings**. The check runs again and comes back clean. [More on the check](https://github.com/jgauffin/kiwi-code-agent/blob/main/articles/04-presumed-wrong.md).

## 5. The board builds itself

With nothing left to rule on, the extension derives the task board from the spec: one task per scenario, delivering every rule under it. The planner lists which doc sections the spec now covers, so you can trim them, and then the build starts on its own.

![The Tasks tab: one task per scenario, its state and its files](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/tasks-tab.png)

Each task gets an implementation run of its own, started on the task, its rules, where the check found the code, and the finding you ruled to keep. The run that delivers **Refund on cancel** removes the early return and names its proof: `a_cancelled_order_over_500_is_refunded_in_full`.

## 6. Every rule, its test

The Spec tab now shows, beside each rule, the task that built it and the test that proves it. A rule with no test would carry a `no test` badge. [How the proofs work](https://github.com/jgauffin/kiwi-code-agent/blob/main/articles/06-every-rule-tested.md).

![The Spec tab: each rule with the task that delivers it and the test that proves it](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/spec-coverage.png)

## 7. A test run nobody argues with

When every task is tested, the extension runs your test commands, with no model involved, over the projects the tasks touched. The feature touched orders and payments, so those suites run and nothing else does. A failure would go back to a fix run with the output.

![The plan bar after verification](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/verification-bar.png)

## 8. Tidy, if you want

Last, the files the feature touched are measured against your size limits. Say `OrderService` grew past them: the Cleanup tab offers to split it, once, or you press **Skip**. [Why only once](https://github.com/jgauffin/kiwi-code-agent/blob/main/articles/05-grade-own-work.md).

![The Cleanup tab: units over their limit, with the choices](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/cleanup-offer.png)

## What you did

You wrote one sentence, answered two questions, read a spec, made one decision, and pressed three buttons. The forgotten limit came up as a question with your name on it instead of becoming a requirement. Every rule has a test you can click.

## The price

- It needs docs worth reading. With nothing under `docs/`, the planner can only ask you.
- It is a workflow. For a one-line fix, a plain chat session is the better tool, and it is there.
- It costs more than a chat would. A planning session, a check against the code, a run per task, a test run and a cleanup pass spend more tokens and more of your attention than typing "add order cancellation" into a chat and reading the diff. What comes back is a feature that matches what you meant, a rule you can point at a test for, and a spec the next feature is planned against and later sessions check before they change it. Slower process, more accurate result.

What would the forgotten limit in your codebase be?

Next: the tool that lets the model change four hundred files in one step, and you review one diff.

---

*Kiwipow Agent is on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=CoderrAB.kiwipow-agent); source and issues are on [GitHub](https://github.com/jgauffin/kiwi-code-agent).*
