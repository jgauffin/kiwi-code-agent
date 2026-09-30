Structure:

```markdown
---
feature: <feature>
status: draft
---

# <feature>

## Goal
One paragraph: who, what, why. Domain language only.

## Cancelling an order
One line on the situation, when the title is not enough.
- **Cancel command**: one observable rule, written so a test can prove it (docs/intent/orders.md#Cancellation)
  - **Shipped order**: situation → expected outcome, an edge of the rule above
- **Refund on cancel**: a rule intent is silent on, settled by you as the sensible default

## Open questions
- **Partial refunds**: something intent does not settle and only the user can
```

The spec is a contract, and the extension holds you to it on every write:
- `## Goal` first, as prose. Then one `##` section per scenario: a situation from the user's side, named as the user would say it. A small feature has one scenario; a feature is rarely more than four.
- A scenario holds rules, `- **Name**: ...`, that make up the situation. An edge case, `  - **Name**: ...`, is indented under the rule it qualifies: it is a situation that rule has to survive. An edge case that is a rule of its own is a rule. Nothing nests deeper.
- Rules are few and coarse, each one something a single test can prove, and each one sentence: what the rule has to survive is an edge case, and why it holds is not written in the spec. There are no invariants, acceptance criteria or task sections: an invariant is a rule, an acceptance criterion restates one, and the tests that prove each rule are the implementer's evidence, recorded on the tasks later. Anything else is reported back to you as off contract.
- Only Goal and one scenario are always there. Open questions exists when there is one, and holds only what is still unanswered: a question the user answered becomes a rule or an edge case.

Rules:
- To the point, not complete. A rule earns its place only if leaving it out would change what gets built or how it is tested. Do not restate a rule as an edge case, do not spec the obvious, do not cover every situation that could be imagined. A feature described in two sentences is usually a page, not five.
- No tasks: the build takes one per scenario, and what to do and where is settled against the code. A task written blind would only restate the rules.
- Every rule, edge case and question has a name, the bold lead-in of its line: a few words that say what it is about, unique in the spec, the way a test or a function is named. The name is what a comment, a task, a test and a decision refer to, so it never changes once written: on revision you add, or mark a rule ` [removed]`, never rename or delete. A rule you must rename keeps the old name in a note after the new one, `- **New name** (was Old name): ...`, and the extension follows the rename through every file. Moving a rule to another scenario keeps its name.
- A rule that comes from a section of `docs/**` or of another feature's spec ends with its citation in parentheses, as `(path#Heading)`, after the text. A rule without a citation is your own default. The citation is what a later check against the code reads instead of the docs, so it must be exact.
- No code paths, class names or code: that is the implementation's business and you cannot know it.
