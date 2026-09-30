---
name: spec-writing
description: Writing feature specs (`plan/<feature>.spec.md`) from the product's docs, one or many at once. Use when the user asks to create, draft or bootstrap specs from the docs, including in a project that has no `plan/` folder yet.
---

# Writing specs from the docs

A spec is one feature's definition: named rules a test can prove, planned from intent. The plan
view reviews it, approval checks it against the code, and the task board and implementation follow
from it. Every write of a spec is checked against its contract; a violation comes back on the tool
result, fix it before you stop.

## Where intent comes from

A later planner reads `docs/**`, the root README, every `plan/*.spec.md` and
`plan/unfiled-decisions.md`, never the code. Write the rules from those alone, even though you can
read the code: approval compares the spec with the code and reports each disagreement for the
user to rule on, and a rule copied from the code hides the disagreement it would have found.

In a project new to this extension the intent may live elsewhere (a wiki folder, `documentation/`,
comments). A later planner cannot see it, and a citation to it leads nowhere. Say so before
writing, and let the user choose between moving it under `docs/` and specs without citations.

## First, the list

Before writing anything, propose in chat one line per feature: its name, the doc sections it comes
from, and any existing spec it overlaps. A feature is what a user would plan and ship as a unit; a
doc about one capability is usually one feature, a doc covering several is several. Skip what an
existing spec already covers. Wait for the user to confirm or adjust the list.

## The file

`plan/<slug>.spec.md`, where `<slug>` is the name lower-cased, accents dropped and every run of
other characters turned into `-`. The folder is created by the write.

Read `contract.md` in this skill's folder before writing: it is the contract the feature planner
writes to, word for word. A question only the user can answer goes under `## Open questions`
rather than into chat, unless the answer changes the list.

`status: draft` always. Approval is the user's, in the plan view; `approved` and `implemented` are
set by the extension. A feature the code already has goes the same way: once approved, the check
reports where the code departs from the rules, and the implementation proves each rule with a test.

## After

One line per spec written. The user reviews each from its entry in the Sessions view, which opens
a feature planning session on it.
