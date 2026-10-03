---
title: How do you know the agent isn't quietly rotting your codebase?
published: false
description: Agent-written code passes review and still erodes a system. Four mechanisms in Kiwipow Agent that answer it with evidence rather than with trust.
tags: engineering leadership, software quality, ai, testing
cover_image: https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/cover-decay.png
---

The question is not whether coding agents write working code. They do. The question is what a year of it leaves behind.

The decay is quiet because every individual change looks fine. The feature works, the tests are green, the diff was reviewed by somebody who had four other things to do. What accumulates underneath is harder to see: rules nobody agreed to, tests that prove nothing, and files that grew past the point where anyone can hold them in their head.

Four things in Kiwipow Agent are aimed at exactly that, and each one produces evidence you can look at instead of a promise you have to trust.

## The intent exists outside the code

Decay starts when the code becomes the only record of what the product does. From then on, every change is planned against the current behaviour, including the parts of it nobody chose.

So the feature planner in the agent cannot read the code. It plans from your docs and from the specs of features planned before, and writes the feature as named rules in the product's language. The code gets its say in a separate pass afterwards, which reports only where it and the spec disagree, and each disagreement is ruled on by a person.

The artefact is a file per feature, in plain language, that a product manager can read and argue with. Not generated from the code, and therefore able to contradict it. That ability to contradict is the whole point.

So you get to plan next quarter from what the product is meant to do rather than from what it happens to do, and a new developer learns the promises in a morning of reading instead of a month of archaeology.

## Every later change is checked against those rules

A spec that is written once and then ignored is decoration. The specs here are read again by every session that changes code: a chat, a planned change, an implementation run. Each one checks the rules covering the area it is about to touch and asks before breaking one. When you agree, the rule is amended in its spec, so the written record moves with the product instead of falling behind it.

Which means a decision stays decided. You hear about a conflict while it is still a question in a chat window, not a year later when a customer finds behaviour nobody chose to change.

## The tests come from the rules, not from the code

This is the one I see underrated most often.

A test written from the implementation asserts what the code already does. That is why agent-written suites pass the moment they are written and break the moment anyone refactors. They are snapshots. They catch nothing, and they cost a fortune to maintain, so eventually somebody deletes or regenerates them, and the safety net is gone without a decision ever being made.

A test written from a rule asserts the promise. `Refund on cancel` fails when cancelling stops refunding, not when a service is split in two. The suite survives the restructuring you will do later, and a red test names the promise that broke rather than the line that changed.

The bookkeeping makes it checkable. The task board is derived from the approved spec rather than written by a model, so every rule is delivered by some task. A task is only finished by naming, per rule, the test that proves it. The spec view shows each rule with its task and its test, or shows the gap. Then the extension runs your test commands with no model involved, over the projects the feature touched, and failures go back for a bounded number of attempts before reaching a person.

![Each rule in a spec with the task that delivers it and the test that proves it, and the gaps marked](https://raw.githubusercontent.com/jgauffin/kiwi-code-agent/main/articles/images/spec-coverage.png)

That buys back the thing a suite is supposed to give you: freedom to restructure. Green means the promises still hold after the move, red names the promise that broke, and nobody has to rewrite a hundred tests because a class got split in two.

## Quality is improved continiously

Passing tests say nothing about whether the implementation left behind a function nobody can follow. So when a feature's tests pass, the files its implementation runs edited are measured: a function against a cognitive complexity limit and a line limit, a type and a file against line limits. Your numbers, in settings, and a limit of zero turns a measure off.

Anything over a limit is listed, and a person chooses: split all of it, split some, later, or skip. If you split, the run works from the size report alone, and afterwards the files are measured again and the tests run again. One pass per feature, never a second. What is still too big is reported and left alone.

The restraint is the point. It does not judge taste: no renaming, no opinions about your abstractions, no discovery that a file "could be cleaner". And it stops: one pass, against numbers you chose, on splits you approved. An agent told to improve code will improve it for as long as you pay, and the second pass over its own work is where it starts moving code sideways.

Which makes the worst outcome a file that is still too big and says so. Not a weekend of unrequested churn through code that already worked, and not a quality step whose cost depends on how much the model felt like rewriting.

## What to ask your own team

Whatever tooling you use, the questions are the same, and they are answerable this afternoon.

Where does the agent learn what the product is supposed to do? Point at a requirement from last quarter and ask for the test that proves it. Take a test that failed recently and ask which product promise it was defending. Ask what happens when a change contradicts something agreed six months ago, and who finds out.

If the honest answer to any of them is "the code", you are already paying for this. Just not on a line item.

---

Companion piece: [the expensive part of AI coding is not the tokens](https://github.com/jgauffin/kiwi-code-agent/blob/main/articles/cto-why-this-costs-less.md).

*Kiwipow Agent is a VS Code extension, on the [Marketplace](https://marketplace.visualstudio.com/items?itemName=CoderrAB.kiwipow-agent); source and issues on [GitHub](https://github.com/jgauffin/kiwi-code-agent).*
