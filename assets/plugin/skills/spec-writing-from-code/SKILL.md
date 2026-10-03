---
name: spec-writing-from-code
description: Writing feature specs (`specs/<feature>.spec.md`) by reading the source, for a codebase whose intent was never written down. Use when the user asks to bootstrap or draft specs from the code itself. Where `docs/**` or a README describes the product, use `spec-writing` instead.
---

# Writing specs from the code

A spec is one feature's definition: named rules a test can prove. The sibling skill `spec-writing`
writes them from the docs, and where there are docs it is the better one: rules taken from intent
can disagree with the code, and the disagreement is the most valuable thing the workflow produces.
Use this skill only when the code is the only record of what the product does.

## Say the cost first

A rule read from the code states what the code does today, which includes every workaround, every
limit that outlived its reason and every bug nobody has noticed. The check that runs on approval
compares the spec against the code, so a spec written from the code agrees with itself and that
check finds nothing. Say this in one line before you write anything, so nobody mistakes an approved
spec for a reviewed one.

It is still worth doing: the behaviour ends up written down in the product's own language, approval
boards a task per scenario that adds the tests proving each rule, and from then on every feature is
planned against intent that exists. The review the check cannot do is the user's. Once the tests are
green, ask them to have a session read the specs back and report rules that contradict each other,
rules nobody would ask for and gaps nobody filled.

## Suspect what you read

The docs' version of a feature is intent. The code's version is only evidence, so:

- **A constant with no reason is a question, not a rule.** A cap, a threshold, a retry count, a
  hard-coded list: put it under `## Open questions`, saying what the code does, and let the user rule
  on whether it is wanted. Guessing here is how a bug becomes a requirement, which is the one thing
  this whole workflow exists to prevent.
- Where two paths do the same thing differently, ask which is right; do not write two rules.
- Dead code, a branch nothing reaches and a flag permanently off are not behaviour. Leave them out
  and say which you left out.
- Commented-out code is not behaviour. A TODO that names an intention is an open question.

## First, the list

Before writing anything, propose in chat one line per feature: its name, what it does for the user,
and where in the code you read it. A feature is what a user would plan and ship as a unit, never a
layer, a module or a class, and a feature an existing spec already covers is skipped. Wait for the
user to confirm the list; expect them to merge, split and drop entries, since they know which parts
of the code are one thing.

## The file

`specs/<slug>.spec.md`, where `<slug>` is the name lower-cased, accents dropped and every run of
other characters turned into `-`. Read `contract.md` in the `spec-writing` skill's folder before
writing: the same contract, enforced on every write. On top of it:

- Translate, never transcribe. A rule says what a person can observe from outside: what they do,
  what they get, what they are refused. A sentence that needs a class, a table, an endpoint or a
  queue to make sense is implementation, and it does not belong in a spec.
- A rule you cannot imagine a test proving from outside the unit is not a rule.
- No citations. A citation points at a doc section a later planner can read, and the code is not
  one, so rules written here carry none.
- `status: draft` always. Approval is the user's, in the plan view.

## After

One line per spec written, then the cost line again: these rules say what the code does rather than
what anyone decided, and the open questions are where it is most likely wrong.
