---
feature: Session transcript export
status: draft
---

# Session transcript export

## Goal

A user of the agent extension wants to produce a self-contained markdown file that faithfully captures what happened in a session — the prompts they sent, the agent's responses, every tool call made, permission requests and their outcomes, and any interruption — so that a colleague who does not have the extension installed can read and understand what the agent did and why.

## Behaviour

- **B1**: The user can trigger a transcript export from within the extension for any session that has at least one recorded event, whether the session is still running or has ended.
- **B2**: The export produces exactly one markdown file. The file is human-readable without the extension, without any special tooling, and without access to internal run artefacts.
- **B3**: The exported file opens with a header block identifying the run id, the phase label (Blind Plan / Reconcile / Implement), the engine used (Claude / GLM / Kimi), and the date and time the session started.
- **B4**: Each conversation turn appears in document order: the user's prompt, then the agent's full response.
- **B5**: Each tool call appears as its own block, recording the tool name, a representation of the inputs supplied, and the outcome (success, error, or truncated-large-output — see E3).
- **B6**: Each permission request appears in the transcript at the point where it occurred, together with the user's decision (approved or denied).
- **B7**: An interruption by the user is recorded at the point where it occurred, marked as an interruption.
- **B8**: Sessions run on the Berget engine (GLM / Kimi) and sessions run on the Claude engine produce transcripts with the same markdown structure. Engine-specific internal representations are normalised before rendering.
- **B9**: When the session is still running at export time, the exported file is labelled as a partial transcript and reflects all events recorded up to the moment the export was triggered. No events are omitted silently.
- **B10**: After the file is saved, the extension notifies the user of the location where the file was written.
- **B11**: The run id written into the exported file is identical to the run id under which the session's artefacts are stored in `.agent/runs/`, so a recipient can quote it back to the original user and have them locate the full run record.

## Invariants

- **I1**: The exported markdown is fully self-contained. It contains no internal file paths, no extension-internal identifiers beyond the run id defined in B11, and no references that would be meaningless outside the extension.
- **I2**: Every event recorded for the session appears in the export. Nothing is omitted silently; large content is truncated with an explicit notice (see E3), not dropped.
- **I3**: The order of events in the exported file matches the chronological order in which they occurred in the session.
- **I4**: Exporting a transcript does not modify, delete, or alter the session's run artefacts stored under `.agent/runs/`.

## Edge cases

- **E1**: Session is still running at export time → the file is produced as a snapshot labelled "partial transcript"; events that arrive after export are not in the file; the label is prominent (top of the header block).
- **E2**: The session had no tool calls → the tool-calls section is either omitted or rendered as an explicit "no tool calls" notice; the file is still valid markdown.
- **E3**: A tool call produced a very large output (e.g. a full file dump from Read) → the output is truncated at a defined character limit and followed by a notice stating how much was omitted; the truncation notice is part of the exported content, not a UI-only message.
- **E4**: The session contains no events at all (started but nothing was sent) → export is declined with a message to the user; no file is written.
- **E5**: The run id cannot be resolved to a session (artefacts missing or corrupted) → export reports the failure to the user; no partial file is written.
- **E6**: A multi-phase run has multiple phase sessions → each phase is a separate session with its own export; exporting one phase does not automatically include sibling phases (see Q1).

## Acceptance criteria

- **A1**: Given a completed session, when the user triggers export, then a markdown file is written to the designated location and the extension displays the path where it was saved.
- **A2**: Given an exported markdown file, when a colleague opens it in any standard markdown viewer (GitHub, VS Code preview, a browser), then it renders without broken references, raw internal identifiers, or unreadable content.
- **A3**: Given a session that included tool calls, when the transcript is exported, then each tool call appears in document order with its name, the inputs supplied to it, and whether it succeeded or failed.
- **A4**: Given a session that included permission requests, when the transcript is exported, then each request appears at the correct position in the transcript together with the user's decision (approved / denied).
- **A5**: Given a session that was interrupted by the user, when the transcript is exported, then the interruption is marked at the point in the transcript where it occurred.
- **A6**: Given a session that is still running, when the user triggers export, then the resulting file is labelled as a partial transcript, contains all events recorded up to that moment, and does not contain events from after the export was triggered.
- **A7**: Given a session run on the Berget engine, when the transcript is exported, then the markdown structure is indistinguishable from one produced by a Claude-engine session run through the same sequence of event types.
- **A8**: Given a completed session with multiple tool calls including one that returned a very large output, when the transcript is exported, then the large output is truncated and the truncation notice states how many characters were omitted.
- **A9**: Given a colleague who only has the exported markdown file, when they read it, then they can identify: the run id, the phase, the engine, when the session ran, what prompts were sent, what the agent responded, which tools were called, which permissions were requested and how they were resolved, and whether the session completed or was interrupted.

## Open questions

- **Q1**: Does the user story's "session" mean a single phase session or an entire multi-phase run? Should the export trigger be available at the run level (all phases concatenated) in addition to the individual phase level, or only per phase?
- **Q2**: Should tool-call inputs be rendered verbatim (which may expose file paths or internal detail) or summarised? If summarised, what is the summarisation rule and who applies it?
- **Q3**: Where is the exported file saved — to a user-chosen path via a save dialog, to a fixed well-known export folder, or copied to the clipboard? This determines B10 and T7.
- **Q4**: How is the export triggered — right-click on a session in the sidebar, a command palette entry, a button in the session detail view, or some combination?
- **Q5**: Should token spend (from the observability record) appear in the exported file, or is it internal telemetry not relevant to a colleague reading a sharing-oriented transcript?
- **Q6**: Is there a concept of "session author" (the identity of the user who ran the session) that should appear in the header block for attribution?
- **Q7**: What is the defined character limit for large tool-call output truncation (E3, A8)? Is it configurable or fixed?
