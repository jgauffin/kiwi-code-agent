---
title: The planner is not allowed to read your code
published: false
description: Why Kiwipow Agent plans a feature from your docs and specs alone, and lets the code speak only afterwards.
tags: ai, vscode, architecture, softwareengineering
series: A coding agent that plans blind
---

Every codebase carries workarounds. Say yours has a refund service that quietly does nothing for amounts over 500. Someone added that years ago, against a payment-provider limit that no longer exists. Nobody remembers it.

Now ask an agent to plan "customers can cancel their orders". It reads the code first, because that is what agents do. It finds the limit, and the limit becomes a requirement.

## Two planners, one feature

Here is the rule a planner writes after reading the code:

```markdown
- **Refund on cancel**: cancelling a paid order refunds it; refunds above 500 are not issued
```

And here is the rule Kiwipow Agent's planner writes, from the docs alone:

```markdown
- **Refund on cancel**: cancelling a paid order refunds it in full
  (docs/intent/orders.md#Cancellation)
```

The first spec looks reasonable. It has absorbed a bug as a rule, and nobody was told. The second one says what you meant, and the bug is still in the code, waiting to be found. That is the whole idea: Kiwipow Agent is a VS Code extension whose feature planner cannot read the code.

## What you see

Planning starts with a direction in chat, not a file: the few decisions that shape the feature and the questions only you can settle. Nothing is written until you say go.

![The planner's direction in chat, before any file is written](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/plan-direction.png)

Then it writes the spec: named rules in the product's language, no paths and no symbols. A rule that comes from a document cites the section; a rule without a citation is the planner's own default, so you can see what you are being asked to accept.

## How it works

The planner reads `docs/**`, the workspace README, the specs of features planned before (an approved one counts as settled as a doc, a draft as a proposal), and the decisions you made while building or chatting that have not yet been filed. That is the whole list.

It does not read source, pull requests, build output, or generated context such as the repo map. This is enforced where the tool call is made, not by asking nicely in a prompt: a read outside that scope is refused with the reason. The planner has no shell in its tool set, so it never proposes one and there is nothing for you to turn down.

If neither the docs nor earlier specs say anything about the feature, the planner asks you and works from your answer. It does not invent one.

## The code gets its say afterwards

Blindness is not ignorance of the code. It is a matter of order.

Once you approve the spec, a separate check reads the code. It reports only where the two disagree, and each disagreement becomes a decision for you. So the 500 limit still surfaces, as a question with your name on it instead of a line in a spec. [The next article](https://github.com/jgauffin/kiwi-code-agent/blob/main/articles/04-presumed-wrong.md) is about that check.

## Why you'd want it

No archaeology before you can write down what a feature should do. You argue about intent while the spec is three paragraphs long, not in a code review of eleven files.

The spec stays readable a year later, because it names rules instead of functions. And what one feature settles reaches the next: the next planner reads the approved specs as it reads the docs, and every session that changes code checks them before it changes behaviour.

Your docs start to matter, too. A doc that decides how the next feature is specified gets maintained; a doc nobody reads does not.

## The price

Your docs have to be worth reading. A blind planner on an empty `docs/` folder can only ask you. Some teams will find that insulting. It is the most useful thing it can tell you.

Would you trust a planner that never looked at your code?

Next: what the check does when the spec and the code disagree, and why the code is the presumed-wrong party.

---

*Kiwipow Agent is on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=CoderrAB.kiwipow-agent); source and issues are on [GitHub](https://github.com/jgauffin/kiwi-code-agent).*
