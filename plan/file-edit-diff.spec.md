---
feature: File edit diff
status: approved
---

# File edit diff

## Goal
A user following a session in the chat wants to see what the session did to each file without leaving the transcript. Today every edit is collapsed, so the change is invisible until it is opened. Each file edit — both the one being asked about in a permission card and the one already completed in a tool row — shows its change as a unified diff inline, kept small enough not to swallow the transcript, with a link to the whole edit for when the inline view is not enough.

## Behaviour
- B1: A completed file edit step in the transcript shows a unified diff of that edit, expanded, without the user opening anything.
- B2: A permission card for a file edit shows the same unified diff of the proposed change, in place of the raw tool arguments.
- B3: The diff shown in the chat is at most 15 lines. When the full diff is longer, the first 15 lines are shown and the remainder is omitted.
- B4: A truncated diff carries a link that states how many lines were omitted and opens the full edit.
- B5: Opening the full edit shows the pre-edit content of the file against the file as it currently stands on disk, in the editor's own diff view.
- B6: The diff is built from content captured by the extension when the edit tool call starts, not from anything the engine supplies, so it is identical on every engine and is present for edits that were auto-approved without a permission card.
- B7: A new file shows as an all-additions diff; an overwrite of an existing file shows as a diff against its prior content.
- B8: Each edit gets its own diff. Two edits to the same file in one turn are two diff blocks, each against the file as it stood before that edit.
- B9: The file path on the step is clickable and opens the file at the first changed line.
- B10: The diff shown in the chat is part of the session's transcript record, so it renders unchanged after a window reload without re-reading the file.
- B11: Context around a change is limited to three lines on each side, so the 15-line budget is spent on changed lines.

## Edge cases
- E1: The user rejects a permission card, or the edit fails → the step shows the outcome and no diff, because nothing changed.
- E2: The edit results in no change to the file → the step says so instead of showing an empty diff.
- E3: The file is opened in the full-edit view after later edits touched it → the comparison still starts from this edit's pre-edit content, so unrelated later changes appear; this is the intended reading of "the file as it is now".
- E4: The file's content cannot be read as text (binary or oversized) → the step reports the change in summary form (path and, where known, lines added and removed) with no diff and no link.
- E5: The full diff is 15 lines or fewer → it is shown whole, with no omission notice and no link.

## Tasks
- T1: Capture pre-edit content at the start of every file edit tool call and carry it on the step's transcript record, surviving reload (B6, B10). [done]
  - Per F2: a `FileEditRecorder` captures in the PreToolUse hook (so it also covers auto-approved edits), keeps the pre-edit content as a snapshot under `.agent/runs/<id>/edits/`, and the event carries only the capped diff plus the snapshot's path; the `SessionManager` applies it before the run log is written.
- T2: Produce a unified diff from captured content and result, covering new file, overwrite and in-place edit, with three lines of context (B7, B8, B11, E2, E4). [done]
  - Per F3: a step carrying several edits (MultiEdit) is one diff per edit, all sharing the step's 15-line budget; a notebook edit takes E4's summary form.
- T3: Render the diff inline on completed edit steps and on edit permission cards, with the 15-line cap, the omission notice and its link (B1, B2, B3, B4, E1, E5). [done]
  - `editDiffView` renders the change the event already carries, so the cap and the notice are decided host-side and covered by the `capDiffs`/`omittedNotice`/recorder tests; the repo has no DOM test environment, so the rendering itself is thin wiring over them. Per F1 the edit step opens expanded and shows the diff in place of its raw arguments; the product doc still describes it as collapsed and needs the amendment F1 calls for, which I cannot make (`docs/` is the user's).
- T4: Wire the link and the file path to the editor: full diff view of pre-edit content against the current file, and open-at-first-changed-line (B5, B9, E3). [done]
  - The right-hand side of the diff view is the file itself, not a second snapshot, so later edits show there as E3 intends; a snapshot path arriving from the webview is opened only when it lies under `.agent/runs`.

## Open questions
- Q1: Should the expanded diff be collapsible again per step, and should that choice be remembered for the session?

## Findings

| Finding | Proposed solution |
|---|---|
| F1 (contradiction, B1): every tool step in the transcript is a collapsed `<details>` (`src/chat/webview/chat-transcript.ts`, `ChatTranscript.toolCall`), and the product doc for this feature (`docs/features/edit-diff-view.md`) says a completed Edit/Write row shows the diff *collapsed*. B1 says expanded without the user opening anything. One of the two has to give; if B1 wins, edit rows stop behaving like every other tool row. | Rule for B1 and amend the doc: the feature exists because collapsed edits hide the one thing worth seeing, and the 15-line cap is what removes the doc's reason for collapsing. An edit row deliberately differs from a Read row because the edit is the session's output, not its plumbing. |
| F2 (naive, B10/T1): the "transcript record" is the append-only event log `.agent/runs/<id>/events.jsonl` (`src/agent/runs/run-log.ts`, `RunLog.append`), read whole and posted to the webview on every session switch (`SessionManager.transcript`, `ChatViewProvider.sendTranscript`). Carrying the captured pre-edit content on the event means whole file contents are written per edit and re-sent to the webview on each switch. The spec should say the event carries the rendered (capped) diff plus a reference to a pre-edit snapshot stored under the run directory, with the snapshot — not the event — serving B5. | Accept. Reword B10 so the step carries only the capped diff it renders, add a behaviour that the pre-edit content is kept as a snapshot in the session's own run storage that B5 reads, and split T1 into capture-and-store versus carry-the-diff. |
| F3 (naive, B8/T2): the spec assumes one edit per tool call. The code already names the editing tools as `Edit, Write, MultiEdit, NotebookEdit` (`src/agent/verify/turn-verifier.ts` `EDITING_TOOLS`, `src/agent/permissions/permission-policy.ts` `FILE_TOOLS`, `src/agent/phases/scope-guard.ts` `preToolUse`), and chat sessions run the Claude engine with no tool restriction (`src/extension.ts` `modeSetup`, only `IMPLEMENT_TOOLS`/plan phases restrict), so a single MultiEdit call carries several edits and NotebookEdit edits a cell inside JSON. The spec should say which tools count as a file edit, whether a MultiEdit step is one diff for the whole call, and that NotebookEdit falls back to the summary form of E4. | Accept. Reword B8 to define a file edit as any step that writes a file, and to say a step carrying several edits to one file shows one diff per edit within that step under a single shared 15-line budget for the whole step, so one step cannot flood the chat; add an edge case putting notebook edits in the summary form of E4 because a cell change is not readable as a text diff. |
| F4 (naive, E2): a no-change edit is already an error, not a successful no-op: `src/agent/openai-session/tools/edit.ts` `editTool` fails on `old_string === new_string` and on a missing match, so that path lands in E1. The only successful no-change case is a Write of identical content (`src/agent/openai-session/tools/write.ts` `writeTool`, which writes unconditionally). E2 should name Write-with-identical-content as the case it covers. | Accept. Narrow E2 to a write of content identical to what is already on disk; the unchanged-text and no-match edits are failures and are already covered by E1. |
