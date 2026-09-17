---
feature: File edit diff
status: approved
---

# File edit diff

## Goal
A user following a session in the chat wants to see what the session did to each file without leaving the transcript. Today every edit is collapsed, so the change is invisible until it is opened. Each file edit — both the one being asked about in a permission card and the one already completed in a tool row — shows its change as a unified diff inline, kept small enough not to swallow the transcript, with a link to the whole edit for when the inline view is not enough.

## Behaviour
- **B1**: A completed file edit step in the transcript shows a unified diff of that edit, expanded, without the user opening anything.
- **B2**: A permission card for a file edit shows the same unified diff of the proposed change, in place of the raw tool arguments.
- **B3**: The diff shown in the chat is at most 15 lines. When the full diff is longer, the first 15 lines are shown and the remainder is omitted.
- **B4**: A truncated diff carries a link that states how many lines were omitted and opens the full edit.
- **B5**: Opening the full edit shows the pre-edit content of the file against the file as it currently stands on disk, in the editor's own diff view.
- **B6**: The diff is built from content captured by the extension when the edit tool call starts, not from anything the engine supplies, so it is identical on every engine and is present for edits that were auto-approved without a permission card.
- **B7**: A new file shows as an all-additions diff; an overwrite of an existing file shows as a diff against its prior content.
- **B8**: Each edit gets its own diff. Two edits to the same file in one turn are two diff blocks, each against the file as it stood before that edit.
- **B9**: The file path on the step is clickable and opens the file at the first changed line.
- **B10**: The diff shown in the chat is part of the session's transcript record, so it renders unchanged after a window reload without re-reading the file.
- **B11**: Context around a change is limited to three lines on each side, so the 15-line budget is spent on changed lines.

## Edge cases
- **E1**: The user rejects a permission card, or the edit fails → the step shows the outcome and no diff, because nothing changed.
- **E2**: The edit results in no change to the file → the step says so instead of showing an empty diff.
- **E3**: The file is opened in the full-edit view after later edits touched it → the comparison still starts from this edit's pre-edit content, so unrelated later changes appear; this is the intended reading of "the file as it is now".
- **E4**: The file's content cannot be read as text (binary or oversized) → the step reports the change in summary form (path and, where known, lines added and removed) with no diff and no link.
- **E5**: The full diff is 15 lines or fewer → it is shown whole, with no omission notice and no link.

## Open questions
- **Q1**: Should the expanded diff be collapsible again per step, and should that choice be remembered for the session?
