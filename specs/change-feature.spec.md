---
feature: Change feature
status: approved
---

# Change feature

## Goal
A developer who has lived with a built feature learns more about it and wants to carry on developing it: more behaviours, a rule that turned out to be wrong, one that should go. Today the only way is to plan a second feature beside the first, which leaves the behaviour of one thing described in two specs and the first one going stale. Changing a feature is the way back in: a blind planning session on the feature itself, started from its settled spec and what the developer now wants, which revises that one spec in place under the same contract and sends it around the ordinary loop — review, approve, check against the code, rule, board, build — so the build does the change rather than the feature again.

## Starting a change
Where a change is offered and what the session begins with.
- **Change on a finished feature**: Change is offered on a feature whose spec is approved or past it and whose build has nothing in flight — no run at work, no decision waiting to be ruled, no unfinished task (docs/intent/agent.md#Stages)
  - **Feature still being built**: while a board holds an unfinished task, a run is at work or a decision waits, Change is not offered and the plan bar keeps offering the build's own next step
  - **Draft feature**: a spec still `draft` is carried on in its own planning session, so Change is not offered on it
- **Change starts from the files**: a change is a new feature-planning session on that feature's tab, started on the spec as it stands and the described change, carrying none of the earlier planning conversation (docs/intent/agent.md#Shape)
- **Blind as ever**: the change session sees the docs, the README, every spec, the recorded decisions and the feature's own spec, and never the code, the earlier check's findings or the board (docs/intent/agent.md#Phase 1: Feature planning)
- **Direction names the rules it touches**: before writing anything the session says in chat which existing rules the change would amend, which it would drop and what it would add, and writes nothing until the user says go (docs/intent/agent.md#Phase 1: Feature planning)
- **Unfiled decisions on the feature**: an entry in the unfiled decisions whose `affects` names this feature is worked into the revision and removed from that file once its words are in the rules (docs/intent/agent.md#Unfiled decisions)
  - **Future work on the feature**: a future-work entry naming the feature is named in the direction as something the change could take in, is taken in only when the user says so, and is removed once it stands as rules

## Revising the settled rules
- **One spec revised in place**: the change rewrites the feature's own spec file to the same contract, never a second spec and never a separate file of changes (docs/plan-sessions.md#Feature planning)
- **Names survive the change**: an amended rule keeps its name and a dropped rule stays in the file marked ` [removed]`, so a comment, a task, a proof or a decision that names a rule still finds it (docs/intent/agent.md#Shape)
- **New behaviour where it belongs**: behaviour that belongs to a situation the spec already has becomes rules in that scenario, and behaviour that is a situation of its own becomes a new scenario (docs/intent/agent.md#The spec contract)
- **Status back to draft**: writing the revision sets the spec's `status` back to `draft`, so the feature stands as a plan being made again until the user approves it (docs/intent/agent.md#Stages)
- **Reviewed like a draft**: the revised spec goes through the ordinary review, comments and strikes on its rules answered before Approve (docs/plan-sessions.md#The view)
  - **Striking a built rule**: a strike on a rule that was already built leaves the rule in the spec marked ` [removed]` rather than taking it out, since the behaviour exists and has to be undone

## Building only what changed
- **Re-check on approval**: approving the revision runs the ordinary check against the code over the whole spec, and every disagreement arrives as a decision to rule (docs/plan-sessions.md#The view)
  - **Removed rule the code still honours**: behaviour the code still has for a rule marked ` [removed]` is reported as a disagreement, which is how dropping a rule reaches the build
- **Board re-derived by name**: the board is derived again, one task per scenario by its name, keeping what the tasks that finished built and proved, and a new scenario gets a task of its own (docs/intent/agent.md#Phase 2: Check against code)
  - **Scenario whose rules changed**: a task whose scenario gained, lost or amended a rule is unfinished again and delivers that scenario's rules as they now stand
- **Task says what changed**: each task names which of the rules it delivers the change added or amended, so its run builds those instead of the scenario anew
- **Untouched rule proven by its test**: a rule the change left alone is proven by the test that already covers it, named as that rule's proof, and a rule no existing behaviour satisfies is built (specs/doc-migration.spec.md#Verifying a migrated feature against the code)
