---
feature: Changing an implemented spec
status: verified
id: 8af77f2d-13ff-42dc-aca0-f09a66fcf58f
---

# Changing an implemented spec

## Goal
A developer who wants a built feature to work differently has nowhere obvious to say so: the spec that defines it can be opened from the new-session screen but offers no way in, and asking for the change on the feature itself drops the request into whatever conversation its tab is showing — a cleanup run, a build — where nothing confirms that the rules will be replanned at all. *Update spec* is the one door: on the new-session screen the developer picks a spec, says in their own words what should change, and that description starts the ordinary blind change to that one spec, which answers every part of what was asked, proposes which rules it would amend, drop and add before writing a word, and leaves the rules the description never reached as they stand.

## Picking a spec to update
What the new-session screen offers and what has to be said before a session starts.
- **Update spec on the Code tab**: *Update spec* stands with the session types on the Code tab of the new-session screen, where a spec is picked and the change described before any session starts (specs/unfiled-decisions.md#The new-session screen splits work in the code from maintenance)
- **Every spec listed and routed by its state**: the picker lists every feature's spec whatever state it is in, and what the pick starts follows that state: a settled spec is changed, a draft is carried on as a draft pickup (specs/planning/spec-drafts.spec.md#Picking up a draft)
  - **Build still in flight**: a feature with an unfinished task, a run at work or a decision waiting to be ruled is listed as not changeable now and says what it waits for, rather than being started (specs/planning/change-feature.spec.md#Starting a change)
- **Pickable with nothing open**: a settled spec is picked whether or not anyone has that feature open, and a feature with nothing open is changed in a planning session started on its spec as it stands, carrying none of the earlier planning conversation.
- **Reading a spec offers the way in**: a spec opened from the new-session screen is shown with the act that changes it offered on it, so there is no spec the developer can read without seeing how to ask for a change
- **Nothing starts without a description**: a pick alone starts nothing; the session begins only once the change is described, and an empty description is refused on the screen (specs/planning/commenting-a-plan.spec.md#Edge cases)
- **Described change arrives as the person's words**: the description reaches the session as the developer's own first message rather than as a prompt written for them (specs/planning/spec-drafts.spec.md#Picking up a draft)
  - **Feature already open**: an update on a feature that already has a tab brings that tab up and says the description there as the next message, rather than starting a second session on the same spec (specs/planning/spec-drafts.spec.md#Picking up a draft)

## What the update session does with the description
- **An ordinary change to that one spec**: an update is the ordinary change to the feature's own spec — blind, revised in place with every rule's name kept, `status` back to `draft`, then review, approve, check and board as usual (specs/planning/change-feature.spec.md#Revising the settled rules)
- **Analysed before anything is written**: the session reads the described change against the spec, the docs and the other specs and proposes in chat which rules it would amend, which it would drop and what it would add, writing nothing until the developer says go (specs/planning/change-feature.spec.md#Starting a change)
- **Only what was described**: a rule the description does not reach stays exactly as it stands, and behaviour the planner thinks must change with it is named in the direction and taken in only when the developer says so
- **Every part of the description answered**: each thing the description asks for is answered in the direction, taken in or declined with a reason, so nothing the developer typed is left without an answer (specs/planning/commenting-a-plan.spec.md#Behaviour)
- **Behaviour another spec owns**: where what was described is behaviour another settled spec defines, the direction names which feature owns it, this feature's spec is the only one written, and the ownership is recorded as a decision for the other (specs/planning/spec-drafts.spec.md#Drafts that overlap)

## Asking for a change while the feature is at another phase
The feature's tab is showing a cleanup, a build or a check when the change is asked for.
- **Never answered by the phase at work**: asking for a change on a feature opens the same describe-the-change step and plans it in a feature-planning session, and is never handed to the cleanup, implement or check conversation the tab happens to show (docs/intent/agent.md#Shape)
  - **Cleanup not yet settled**: a feature whose only open step is a cleanup the developer has not settled is changeable, and that cleanup waits for the change's own build rather than running over code about to be rewritten (specs/building/cleanup-phase.spec.md#A feature's tests pass)
- **The plan says the change landed**: once the description is in, the feature's plan bar stands at planning and its spec is the revision under review, so the developer sees the request reach the plan rather than only a chat reply (docs/intent/agent.md#Stages)

## Open questions
- **Cleanup after an update**: a feature is cleaned at most once today, so should the build of an update offer cleanup again on the files it rewrites, or does the feature stay cleaned for good?
