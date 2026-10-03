---
feature: Spec drafts
status: verified
---

# Spec drafts

## Goal
A developer comes back to a feature whose spec is still a draft: one they planned halfway last week, one the docs cleanup wrote out of a feature description, one they typed themselves between meetings. A draft is a proposal, not a decision, and how complete it is depends on who wrote it — a draft planned in conversation is usually whole, one drafted from the docs is a first pass that may describe behaviour another draft also claims, and one written by hand alone is the thinnest of the three. So a draft is pickable work in its own right, it says how it came to be and how far its review got, and picking it up buys a critique in chat before a word is written: what the draft settles, what it misses, which other drafts it collides with, and, where the whole shape is wrong, the direction the planner would take instead. The developer steers from that, and the draft is carried on rather than guessed at or quietly treated as settled.

## Picking up a draft
What the new-session screen offers and what the session begins with.
- **Drafts are pickable work**: wherever a draft is listed, including the Code tab of the new-session screen as work waiting to be picked up, picking it opens that feature's planning session on the draft (specs/unfiled-decisions.md#The new-session screen splits work in the code from maintenance)
  - **Feature already open**: picking a draft whose feature already has a tab brings that tab up instead of starting a second session on the same spec (specs/unfiled-decisions.md#Every session has its own tab, in the right sidebar)
- **How the draft came to be**: each draft records whether it was planned with the person, drafted from the docs, or hand-written, and its entry shows that beside how far its review got — never reviewed, a review in flight, or every comment answered (docs/intent/agent.md#Stages)
  - **Nothing recorded**: a draft whose authorship nothing records counts as hand-written, the least complete of the three
- **Started on the files**: the pickup starts on the draft as it stands, the docs, every other spec and the recorded decisions, and carries none of the conversation that wrote it (docs/intent/agent.md#Shape)
- **Still a draft afterwards**: a pickup never approves and leaves `status` at `draft`, and its critique is not a review round, so no comment of the user's is spent or closed by it (docs/intent/agent.md#Stages)

## Carrying the draft on
- **Critique before any write**: the first turn of a pickup says in chat what the draft settles, which of its rules the planner would amend, drop or add and which questions it leaves open, and writes nothing until the user says go (docs/intent/agent.md#Phase 1: Feature planning)
- **Depth follows how it was authored**: a draft planned with the person is taken as complete and critiqued only on what changed around it since; a draft drafted from the docs is critiqued for the gaps its source sections left and for overlap; a hand-written draft is critiqued whole — missing scenarios, rules no test could prove, and whether the direction holds
- **Review in flight answers first**: where a submitted review waits on the draft, the pickup answers its comments and strikes and raises nothing of its own until they are resolved (specs/commenting-a-plan.spec.md#Behaviour)
- **Recorded decisions on the draft**: an unfiled decision or future-work entry whose `affects` names the feature is named in the critique, worked into the rules only when the user says so, and removed from its file once its words stand as rules (docs/intent/agent.md#Unfiled decisions)
- **Names are not settled yet**: a rule of a draft may be renamed or dropped outright, since nothing has been approved, tasked or proved from it (docs/intent/agent.md#Shape)
  - **Renaming a commented rule**: a rule a review has already commented on keeps the `(was Old name)` note when it is renamed, so the comment still finds it (specs/commenting-a-plan.spec.md#Edge cases)

## Drafts that overlap
Two drafts, neither settled, describing the same behaviour.
- **Overlapping drafts named**: the critique names every other draft whose rules describe behaviour this draft also claims, and proposes which of the two features should own it
  - **Planned with the person**: for a draft planned in conversation the search is limited to the specs and drafts written or changed since it was last touched
- **Only its own spec written**: the session writes the draft it was picked up on and never another feature's spec, whatever the overlap (docs/plan-sessions.md#Feature planning)
  - **Ownership recorded for the other draft**: the user's ruling on which feature owns the behaviour is recorded as an unfiled decision naming both features, so the other draft's own pickup takes it in (docs/intent/agent.md#Unfiled decisions)
- **Approved spec is not an overlap**: behaviour an approved spec already defines is no question of ownership — the draft's own rule goes, or cites that spec (docs/intent/agent.md#Phase 1: Feature planning)

## A draft heading the wrong way
- **Another direction proposed**: where the planner judges the draft's whole shape wrong it says so in chat, with the direction it would take instead and why, and the draft stands untouched until the user chooses (docs/intent/agent.md#Phase 1: Feature planning)
  - **Draft's direction kept**: when the user keeps the draft's direction the planner carries it on as it stands and does not raise the same redirect again in that session
- **Rewritten in place**: a direction the user takes rewrites that same spec file to the contract, never a second spec for the same feature (docs/plan-sessions.md#Feature planning)
  - **Struck rule stays struck**: a rule the user struck in a review is not brought back by a redirect and stays marked ` [removed]` (specs/commenting-a-plan.spec.md#Behaviour)

## Open questions
- **Discarding a draft**: whether a draft the user abandons can be dropped from the pick-up list, and what happens to its file, or whether abandoning stays a matter of deleting the spec by hand
