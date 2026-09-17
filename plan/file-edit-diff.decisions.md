# Decisions for File edit diff

### F1
- on: B1
- finding: every tool step in the transcript is a collapsed `<details>` (`src/chat/webview/chat-transcript.ts`, `ChatTranscript.toolCall`), and the product doc for this feature (`docs/features/edit-diff-view.md`) says a completed Edit/Write row shows the diff *collapsed*. B1 says expanded without the user opening anything. One of the two has to give; if B1 wins, edit rows stop behaving like every other tool row.
- proposed: Rule for B1 and amend the doc: the feature exists because collapsed edits hide the one thing worth seeing, and the 15-line cap is what removes the doc's reason for collapsing. An edit row deliberately differs from a Read row because the edit is the session's output, not its plumbing.

### F2
- on: B10, T1
- finding: the "transcript record" is the append-only event log `.agent/runs/<id>/events.jsonl` (`src/agent/runs/run-log.ts`, `RunLog.append`), read whole and posted to the webview on every session switch (`SessionManager.transcript`, `ChatViewProvider.sendTranscript`). Carrying the captured pre-edit content on the event means whole file contents are written per edit and re-sent to the webview on each switch. The spec should say the event carries the rendered (capped) diff plus a reference to a pre-edit snapshot stored under the run directory, with the snapshot — not the event — serving B5.
- proposed: Accept. Reword B10 so the step carries only the capped diff it renders, add a behaviour that the pre-edit content is kept as a snapshot in the session's own run storage that B5 reads, and split T1 into capture-and-store versus carry-the-diff.

### F3
- on: B8, T2
- finding: the spec assumes one edit per tool call. The code already names the editing tools as `Edit, Write, MultiEdit, NotebookEdit` (`src/agent/verify/turn-verifier.ts` `EDITING_TOOLS`, `src/agent/permissions/permission-policy.ts` `FILE_TOOLS`, `src/agent/phases/scope-guard.ts` `preToolUse`), and chat sessions run the Claude engine with no tool restriction (`src/extension.ts` `modeSetup`, only `IMPLEMENT_TOOLS`/plan phases restrict), so a single MultiEdit call carries several edits and NotebookEdit edits a cell inside JSON. The spec should say which tools count as a file edit, whether a MultiEdit step is one diff for the whole call, and that NotebookEdit falls back to the summary form of E4.
- proposed: Accept. Reword B8 to define a file edit as any step that writes a file, and to say a step carrying several edits to one file shows one diff per edit within that step under a single shared 15-line budget for the whole step, so one step cannot flood the chat; add an edge case putting notebook edits in the summary form of E4 because a cell change is not readable as a text diff.

### F4
- on: E2
- finding: a no-change edit is already an error, not a successful no-op: `src/agent/openai-session/tools/edit.ts` `editTool` fails on `old_string === new_string` and on a missing match, so that path lands in E1. The only successful no-change case is a Write of identical content (`src/agent/openai-session/tools/write.ts` `writeTool`, which writes unconditionally). E2 should name Write-with-identical-content as the case it covers.
- proposed: Accept. Narrow E2 to a write of content identical to what is already on disk; the unchanged-text and no-match edits are failures and are already covered by E1.
