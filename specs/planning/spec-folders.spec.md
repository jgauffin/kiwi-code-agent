---
feature: Spec folders
status: verified
authored: planned
---

# Spec folders

## Goal
A workspace that has planned a few dozen features ends up with one `specs/` folder holding every spec, where nothing says which specs belong together and finding the one you want means reading names. This feature lets specs sit in folders named after the domain they belong to, and has the agent pick that folder itself: when a planning session gives its direction it also says which domain folder the spec will land in, read from the feature's description and the domains the workspace already uses, for the person to keep or change before anything is written. The folder is grouping and nothing more — a feature is still identified by its name, every spec is still read and cited wherever it sits, and a workspace that wants its specs in one flat folder keeps them there.

## Where a new spec lands
The moment a feature's spec is first written.

- **Folder proposed with the direction**: the planning session names the folder the spec will land in as part of the direction it gives in chat, and writes nothing until the person says go (docs/intent/agent.md#Phase 1: Feature planning)
  - **Person's word wins**: a folder the person names in reply is the one the spec is written to, whether or not that folder already holds a spec
- **Domain read from the description**: the folder is inferred from the feature's description text and the domain language of the docs, not from the feature's name alone
- **Existing folders reused**: the session is told which spec folders the workspace already has and puts the feature in the one it belongs to rather than coining a synonym of it
- **One level deep**: a proposed folder may sit at any depth under `specs/`, nested where a domain is part of a wider one (`specs/orders/returns/<feature>.spec.md`), and every folder already holding a spec, nested ones by their path, is among those offered for reuse
- **Setting decides whether folders are used**: `kiwiAgent.specFolders` governs it — the default follows the workspace, so a workspace whose specs all sit at the root keeps getting specs at the root and one that already has a spec folder gets a folder for every new spec, while `by-domain` and `flat` always do that one thing (docs/settings.md#Settings)
  - **Flat skips the proposal**: where the setting resolves to flat, the direction says nothing about a folder and the spec is written at the root of `specs/` (docs/plan-sessions.md#Feature planning)
- **Drafts written from the docs land the same way**: a draft spec written by the docs cleanup job rather than by a planning session gets its folder the same way, proposed with the feature list it offers (specs/planning/doc-migration.spec.md#Migrating the remaining feature docs into specs)
- **Folder is not identity**: the folder groups specs and never qualifies a feature's name, so a name another spec already answers to is refused whatever folder the new spec would land in (specs/unfiled-decisions.md#No two features share a name)
- **Working files stay flat**: a feature's review, decisions, context and task board keep their place under `.kiwi/specs/` named by the feature, whatever folder its spec sits in (docs/intent/agent.md#Stages)

## Reading and citing a spec in a folder
What every session and every listing makes of a spec that is no longer at the root.

- **Every folder in scope**: a session that may read the specs may read, search and be answered from a spec in any folder under `specs/`, and one in a folder is never invisible to it (docs/intent/agent.md#Phase 1: Feature planning)
  - **Deeper folder still read**: a spec in a folder inside a folder is read, searched and cited like any other
  - **Decision files stay at the root**: `specs/unfiled-decisions.md` and `specs/future-work.md` are not specs and keep their place at the root of `specs/` (docs/plan-sessions.md#Unfiled decisions)
- **Citation carries the folder**: a rule derived from another feature's spec cites that spec's full path, folder included, so the citation resolves to the file as it now sits (docs/intent/agent.md#Phase 1: Feature planning)
- **Listed by feature and grouped by folder**: wherever specs are offered to be picked — drafts waiting to be carried on, a spec to update — they are named by their feature and grouped by the folder they sit in (specs/planning/changing-an-implemented-spec.spec.md#Picking a spec to update)
  - **Narrowing the specs to pick up**: the specs offered to be picked up on the new session screen can be narrowed by text found in their feature name or folder, and to the ones not yet verified, while the conversations listed beside them stay as they are

## Organising the specs that already exist
A workspace whose specs were all written before folders existed.

- **Nothing moves on its own**: a spec stays where it is until the person asks for it to be moved; adopting folders never rearranges a workspace behind their back
- **Offered by the docs cleanup job**: *Clean up docs* offers to sort the specs into folders, asked in its chat on its own rather than as one of its three stages, so taking it or declining it leaves the stages and their order untouched (specs/planning/doc-migration.spec.md#Starting the job)
- **Proposal before any move**: the offer is a proposal naming each spec and the folder it would go to, reusing the folders that exist, and only the moves the person picks are made (specs/planning/doc-migration.spec.md#Tidying what stays)
  - **Already in a folder**: a spec that already sits in a folder is shown as it is and proposed for a move only where its folder does not match the domain the others sorted into
  - **Feature with work in flight**: a feature with a review in flight, a decision to rule or an unfinished board is listed as not movable now, saying what it waits for, rather than being moved (specs/planning/changing-an-implemented-spec.spec.md#Picking a spec to update)
- **A move keeps the feature**: a moved spec keeps its name, its status, its rules and their names, and its review and board, so where the feature stands is unchanged by the move (docs/intent/agent.md#Shape)
- **Citations follow the move**: every citation in another spec that points at a moved spec is rewritten to its new path as part of the same change, so no rule is left citing a file that is gone (docs/intent/agent.md#Shape)
