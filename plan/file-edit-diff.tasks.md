---
spec: ea6aa092
---

# Tasks for File edit diff

- **T1**: Capture pre-edit content at the start of every file edit tool call and carry it on the step's transcript record, surviving reload (B6, B10). [done]
  - Per F2: a `FileEditRecorder` captures in the PreToolUse hook (so it also covers auto-approved edits), keeps the pre-edit content as a snapshot under `.agent/runs/<id>/edits/`, and the event carries only the capped diff plus the snapshot's path; the `SessionManager` applies it before the run log is written.
- **T2**: Produce a unified diff from captured content and result, covering new file, overwrite and in-place edit, with three lines of context (B7, B8, B11, E2, E4). [done]
  - Per F3: a step carrying several edits (MultiEdit) is one diff per edit, all sharing the step's 15-line budget; a notebook edit takes E4's summary form.
- **T3**: Render the diff inline on completed edit steps and on edit permission cards, with the 15-line cap, the omission notice and its link (B1, B2, B3, B4, E1, E5). [done]
  - `editDiffView` renders the change the event already carries, so the cap and the notice are decided host-side and covered by the `capDiffs`/`omittedNotice`/recorder tests; the repo has no DOM test environment, so the rendering itself is thin wiring over them. Per F1 the edit step opens expanded and shows the diff in place of its raw arguments; the product doc still describes it as collapsed and needs the amendment F1 calls for, which I cannot make (`docs/` is the user's).
- **T4**: Wire the link and the file path to the editor: full diff view of pre-edit content against the current file, and open-at-first-changed-line (B5, B9, E3). [done]
  - The right-hand side of the diff view is the file itself, not a second snapshot, so later edits show there as E3 intends; a snapshot path arriving from the webview is opened only when it lies under `.agent/runs`.
