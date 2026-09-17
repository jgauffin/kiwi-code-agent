---
feature: commenting a plan
status: approved
---

# commenting a plan

## Goal
A human reviewing a draft plan artifact — a blind-plan spec or a reconcile plan — needs a way to say "this item is wrong" and "drop this one" without hand-editing the file and without approving something they disagree with. Today the only gestures are Open and Approve, so a plan that is nearly right has to be argued for in free chat and re-derived from memory. Commenting gives the review a shape: notes attached to the plan's own item ids, strikes on items that should not be built, one submission back to the agent, a revised plan shown to the human, and an answer to every comment. Approval stays blocked until the review is closed, so agreement is reached rather than assumed.

## Behaviour
- **B1**: While a plan artifact's status is draft, the human can attach a free-text comment to any item by its stable id, and one comment to the plan as a whole. Ids are the only anchor; there is no line- or word-level anchoring.
- **B2**: The human can strike a proposed item, and unstrike it, for as long as the review is unsubmitted.
- **B3**: Comments and strikes accumulate as a pending review, visible as a whole before it is sent, and submitted in one batch.
- **B4**: Submitting hands the artifact and the review to the session that owns the artifact if it is still alive, and otherwise to a fresh session of the same phase that reads both from disk. No part of the review depends on the transcript.
- **B5**: On revision, every struck item is marked removed in the artifact. Ids are never renumbered or reused, and items that referred to a removed item are repaired so the plan stays coherent.
- **B6**: Every comment in the review gets a resolution from the agent: addressed, or disagreed with a stated reason. A comment is never dropped without a resolution.
- **B7**: After revising, the agent presents the revised plan to the human — what changed since the review was submitted, and each comment with its resolution — and the session goes to `needs_human`. The human may open another review round on the revised plan.
- **B8**: The human closes a comment by accepting its resolution, or leaves it open by commenting again in the next round. Accepting a disagreement is an explicit act.
- **B9**: A struck item stays removed. The agent may not reintroduce it in this or a later round; only a new comment from the human can bring it back.
- **B10**: A plan artifact cannot be approved while any comment is open.
- **B11**: Comments, strikes and resolutions survive a reload and remain readable after approval, as part of the record of how the plan was reached.
- **B12**: Commenting is offered only on a draft artifact. An approved plan is not commentable; it is reopened or superseded.

## Edge cases
- **E1**: The human comments on an item already marked removed → allowed, and it is the way to ask for a struck item back; the reversal is the human's decision, not the agent's (B9).
- **E2**: A review is submitted with no comments and no strikes → rejected as empty; no turn is spent.
- **E3**: Every item in the plan is struck → the agent reports that nothing remains rather than inventing a replacement plan; the human restates the feature or abandons it.
- **E4**: The agent disagrees with all comments and changes nothing → the plan is still presented to the human with its resolutions (B7), and approval stays blocked until each comment is closed (B8, B10).
- **E5**: A comment's id is no longer present in the artifact, because the file was edited by hand → the comment is kept and given to the agent together with the item text it was written against, never silently discarded.

## Open questions
- **Q1**: May a comment carry replacement wording for an item, or only describe what is wrong? The spec assumes describe-only, so the agent owns every word in the artifact.
- **Q2**: Should review rounds be part of what is written back to a work item once ADO is connected, or stay local to the workspace? Assumed local for now.
