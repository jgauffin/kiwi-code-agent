---
spec: 133e8a29
---

# Tasks for commenting a plan

- **T1**: Review authoring — attach, edit and remove comments per item id and for the plan as a whole; strike and unstrike; show the pending review as a whole; persist it across reloads; offer it only on a draft (B1, B2, B3, B11, B12, E2). [done]
  - The review lives in `plan/<slug>.review.md` next to the spec: markdown so it stays readable after approval and the agent can write resolutions into it with the tools it already has. Comment text is stored as one line.
- **T2**: Submission and handoff — route the artifact plus review to the owning or a fresh same-phase session, reading from disk rather than transcript, carrying orphaned comments with their original item text (B4, E5). [done]
- **T3**: Revision conduct — the agent marks struck items removed without renumbering, repairs dependents, resolves every comment as addressed or disagreed with reason, never resurrects a struck item, and reports an emptied plan (B5, B6, B9, E3). [done]
  - The conduct is stated in the handoff message and in both phase prompts; a strike the plan still presents as live, and a plan every item of which is struck, are computed from the file and named in the message rather than left to the model to notice. The planner gets the Edit tool so a resolution can be written into the review file without rewriting it.
- **T4**: Round closure — present the revised plan with changes and resolutions, return to `needs_human`, let the human accept a resolution or comment again, and block approval while a comment is open (B7, B8, B10, E1, E4). [done]
  - `needs_human` needs no new rule: a planning turn that ends already lands there. Approval is refused in the host and the Approve button is disabled with the count of open comments.
