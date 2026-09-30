---
title: The planner is not allowed to read your code
published: false
tags: ai, vscode, architecture, softwareengineering
series: A coding agent that plans blind
---

Every codebase carries workarounds. A cap that is there because of an overflow nobody fixed. A status that is never set because the job that sets it was switched off two years ago. A validation that runs twice because it was cheaper than finding out why once was not enough.

Now ask an agent to plan a feature in that code. It reads the code first, because that is what agents do. It finds the cap, and the cap becomes a requirement. The feature is shaped to fit the defect, and nobody is told. The spec looks reasonable. It has absorbed a bug as a rule.

That is the problem Kiwipow Agent is built around. It is a VS Code extension that runs coding sessions, and its planning session cannot read the code.

## What the planner sees

A plan session reads `docs/**`, the workspace README, and every approved spec of every feature planned before it. Later it will read the work item too. That is the whole list.

It does not read source, pull requests, build output, or generated context such as the repo map. This is enforced where the tool call is made, not by asking the model nicely in a system prompt. `Bash` is denied by bare name, so the tool is not even in the model's context: there is nothing to propose and nothing for you to turn down.

The output is a spec of named rules in the product's language, with no path and no symbol in it:

```markdown
## Cancelling an order
- **Cancel command**: an open order can be cancelled by the person who placed it
  (docs/intent/orders.md#Cancellation)
  - **Shipped order**: a shipped order cannot be cancelled; the customer is offered a return
- **Refund on cancel**: cancelling an unpaid order releases the reservation, not a refund

## Open questions
- **Partial refunds**: what only you can settle
```

A rule that comes from a document cites the section it comes from. A rule without a citation is the planner's own default, which makes it easy to see what you are being asked to accept. If neither the docs nor the earlier specs say anything about the feature, the planner asks and stops. That is the honest answer, and it is better than a confident invention.

## The code gets its say afterwards

Blindness is not ignorance of the code. It is a matter of order.

Once the spec exists, a second run maps it against the repository. It reports only disagreements: a business rule in the code that says otherwise, existing behaviour the feature would break that the spec does not mention, something the spec assumes that the code shows to be wrong. Each one becomes a decision for you, with one finding at one path and one symbol.

You rule on each: change the rule, or keep it and let the code change. The code is the presumed-wrong party until you say otherwise. Authority is fixed: the work item first, then the docs and approved specs, then the code.

So the cap of 50% still surfaces. It surfaces as a question with your name on it, not as a line in a spec.

## What it buys the organisation

Intent stays the authority. Drift between what you meant and what you shipped is produced as a list, per feature, instead of being quietly written into the next requirement.

The documentation is used, so it is worth maintaining. A doc that no agent and no person reads rots; a doc that decides how the next feature is specified does not.

And what one feature settles reaches the next. The next planner reads the approved specs as it reads the docs, so a decision you made in March is an input in June without anyone having to remember it.

## What it buys the developer

No archaeology before you can write down what a feature should do. You argue about intent while the spec is three paragraphs long, not in a code review of eleven files.

The spec stays readable a year later, because it names rules instead of functions. When the code moves, the spec does not go stale; the mapping run just finds something new to ask you about.

## The price

Your docs have to be worth reading. A blind planner on an empty `docs/` folder stops and says so. Some teams will find that insulting. It is the most useful thing it can tell you.

Next in the series: why every rule has a name, and why a task is not done until it can name the test that proves the rule.
