---
feature: Parallell session support
status: draft
---

# Parallell session support

## Goal
A person working with KiwiAgent rarely works with KiwiAgent alone: a second plan or implement session runs beside the first, and an agent outside KiwiAgent, a branch switch or the person's own editor changes the same files. Today the agent cannot tell its own work from anyone else's, so it writes over a change it never saw and, worse, verification blames the feature for tests the other hand broke. This feature gives the agent that distinction: every change in the workspace is either this session's own or another hand's, a write onto a file another hand moved is refused instead of instructed against, a running session is told when the ground shifts under it, and a failing test in code the feature never touched is reported as someone else's rather than handed back to the implementer.

## Writing a file another hand changed
Every session that writes — plan, implement, cleanup, chat — is held to the same check, which the extension performs rather than the prompt asking for it.
- **Stale write refused**: a write to a file whose content changed since this session last saw it is refused, and the refusal says what changed the file (docs/intent/agent.md#Verification).
  - **Own writes are seeing**: a write the session itself made counts as seeing the file, so two edits in a row to the same file are never refused.
  - **Folded read is not seeing**: a read the conversation no longer holds after compaction is not seeing the file, so a write after it is refused until the file is read again (docs/features/own-loop-compaction.md#Reading again before writing).
- **Unread file refused**: a write to a file that exists and this session never read is refused for the same reason.
  - **A new file needs no read**: writing a file that does not exist is not refused.
- **No read-before-edit instruction**: the phase instructions carry no rule telling the model to read before editing, because the refusal enforces it (docs/intent/agent.md#Instructions).
- **Who changed it**: a refusal or notice names the other KiwiAgent session and the feature it works on where the change came from one, and otherwise says the change came from outside KiwiAgent, without naming which tool (docs/features/coordination.md#Claims).

## Being told while the work is in play
- **Notice of another hand**: a session whose turn is in play is told, as a one-line tail on its next tool result, that another hand changed a file this session has written or read (docs/features/coordination.md#Channels).
  - **One notice per file**: a file is reported once until this session sees it again, and a change sweeping many files at once is reported as a single line naming the count rather than one line per file.
- **The task's work is its own**: the files a task names as touched are the ones its own runs wrote, and a foreign change to one of them is recorded on the task instead of counted as the task's work (docs/intent/agent.md#Phase 3: Implement).

## A verification failure that is not ours
Verification is mechanical and runs over the files the tasks name; with a second hand in the workspace, some of what fails there was never this feature's doing.
- **Foreign failure**: a failing test whose file no session of this feature wrote, and which another hand changed since this feature's implementation began, is recorded as foreign and not handed to the implementer (docs/intent/agent.md#Verification).
  - **Narrowed to the function**: where a file's changes can be attributed function by function, a failing test whose own function another hand changed is foreign even though this feature wrote other parts of that file.
  - **No other hand no excuse**: when nothing changed outside this feature's own sessions since its implementation began, every failure is the feature's and is handed to the implementer as before.
- **Retry before asking**: a verification run whose failures are all foreign waits a configured number of seconds and runs the same suites again, and only a second all-foreign failure is reported (docs/settings.md#Settings).
  - **Ours on the second run**: a failure that is the feature's own on the retry is handed to the implementer like any other failure.
- **Held, not verified**: a feature whose verification ends in foreign failures stays in verification with the failures recorded on the board, naming the files and the hand, and the user is asked whether to run again, hand them to the implementer anyway, or accept them (docs/intent/agent.md#Stages).
- **Budget spared**: an all-foreign failure does not count against `kiwiAgent.verifyFailureBudget` (docs/intent/agent.md#Verification).

## Open questions
- **Verifying beside a live sibling**: should verification be postponed while another KiwiAgent session in the same workspace is mid-turn, rather than run and then be retried?
