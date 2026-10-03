---
feature: Doc migration
status: verified
---

# Doc migration

## Goal
A maintenance job that makes the specs the single source of truth for behaviour. Today a feature's behaviour can be described twice — in the doc it was planned from and in the spec that now defines it — and the doc goes stale without anyone noticing. This job, offered as *Clean up docs*, goes over the docs against the settled specs, offers to cut what a spec already says, then offers to turn the feature descriptions that no spec holds yet into specs, each verified against the code on the way through the usual approval check, and last tidies how what stays in the docs is arranged so a blind planner finds and cites it. It never reads code and never rewrites a doc for style: it removes what is said twice, moves what is said nowhere else into a spec, and makes the rest findable.

## Starting the job
A maintenance job the person picks when they want the docs and the specs brought back into line, not an errand of the day.

- **Maintenance job**: offered on the Maintenance tab of the new-session screen as *Clean up docs*, the one job that works from the docs, beside *File decisions*, as a session with the planner's read scope that never reads code (docs/plan-sessions.md#Plan sessions)
  - **Nothing counted on the tab**: the tab shows no number for this job, unlike the waiting unfiled decisions (docs/intent/agent.md#Unfiled decisions)
- **Stages in order**: pruning, drafting specs and tidying what stays come in that order, each proposed in chat before anything is written, and the person may skip a stage or stop after any of them (docs/intent/agent.md#Finding the way in)
- **Settled specs only**: only a spec the person has approved is treated as what the product says, whatever stage its build has reached; a draft spec never costs a doc section
- **Outline before judgment**: the job's first pass is the outline of each doc it may read, section by section, and every later judgment is made per section
- **Feature content decides scope**: a section is in scope only when its content describes product behaviour; architecture, rationale, guidelines, settings reference and how-to-build sections are out of scope whatever file or folder they sit in
- **Confirmed doc writes**: every write into `docs/**` or the root README is put to the person first and made only when they say so, one at a time (docs/intent/agent.md#Docs split)
- **Setting not consulted**: the job offers its cuts whether or not `kiwiAgent.cutCoveredDocs` is on, since cutting is what it is for (docs/settings.md#Settings)

## Pruning what a spec already says
The first stage: the doc sections in scope, sorted against the settled specs.

- **Covered section**: a section whose behaviour a settled spec now defines is reported with the spec and the rules that cover it, and offered for removal (docs/intent/agent.md#Docs split)
  - **Partly covered section**: when only part of a section is covered, what is offered for removal is that part, and the rest is left standing
  - **Doc left empty**: a doc with nothing left but its title is offered for deletion together with the index entries and links that point at it
- **Contradicting section**: a section that says otherwise than a settled spec is reported and never offered for removal; which side is current is the person's to say (docs/intent/agent.md#Docs split)
  - **Contradiction the person rules on**: when they say the doc is current, the ruling is recorded as an unfiled decision naming the feature whose spec it reaches, and the spec is not edited here (docs/intent/agent.md#Unfiled decisions)
- **Cited section kept whole**: a section an approved spec's rule cites is not offered for removal without naming the citations that would have to change with it (docs/plan-sessions.md#Finding the way around the docs)
- **Nothing covered**: with no covered section found the job says so and goes on to the migration offer

## Migrating the remaining feature docs into specs
The second stage: the feature descriptions that no spec holds.

- **Offered when pruning is settled**: the migration is offered only once no reported covered section is still waiting for an answer
- **Feature list first**: the job proposes the features it reads out of the remaining in-scope sections, naming the sections each one comes from, and the person picks which become specs (docs/plan-sessions.md#From a chat)
  - **Built or planned**: each proposed feature is marked as behaviour already built or behaviour not yet built, which the person corrects, since it decides what a clean code check means for it
- **One draft per pick**: each pick is written as `plan/<feature>.spec.md` with status draft, held to the spec contract, derived from the doc sections alone (docs/plan-sessions.md#Feature planning)
- **Source sections left standing**: the sections a draft was written from are not cut by this job; they become covered sections for a later run once that spec is settled
- **Reviewed as any draft**: a migrated draft is reviewed and approved in the plan view like any other, and the job never approves one itself (docs/plan-sessions.md#The view)

## Tidying what stays
The third stage: the docs left once behaviour has moved to the specs, judged as a blind planner's way in.

- **Discovery only**: the job judges how much a planner has to read before it finds an answer and whether it can cite what it found, never the prose or whether the docs are right (docs/intent/agent.md#Finding the way in)
  - **Drafted sections wait**: sections a draft was written from in this run are not judged; a later run prunes them once their spec is settled
- **Findings in chat**: each finding is one line naming the section as `path#Heading`, what it costs a planner and the change, strongest first, and a list with nothing on it is a good result
- **Picked changes only**: only the findings the person picks are changed, each change one confirmed write
- **Cited heading kept**: a heading an approved spec cites is not proposed for a rename or move without naming every citation that would follow, and a doc that is split keeps its headings in its parts (docs/plan-sessions.md#Finding the way around the docs)

## Verifying a migrated feature against the code
What the check against the code means for a spec written from a doc about code that already exists.

- **Check on approval**: approving a migrated spec runs the ordinary check against the code, and every disagreement arrives as a decision to rule (docs/plan-sessions.md#The view)
- **Clean check on built behaviour**: A spec marked as behaviour already built whose check reports nothing is approved with a task board whose tasks only add the tests that prove its rules, and reaches verified the usual way once those tests pass.
  - **No proofs expected** [removed]
  - **Tests without new behaviour**: the tasks of such a board add tests only, and a rule none of the existing behaviour satisfies is reported as a disagreement rather than built here (docs/intent/agent.md#Phase 3: Implement)
- **Drift becomes the build**: when the check reports disagreements on built behaviour, rulings, tasks and implementation follow as usual, so only what disagrees gets built (docs/plan-sessions.md#The view)
