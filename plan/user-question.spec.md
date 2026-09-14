---
feature: User question
status: approved
---

# User question

## Goal
A session that cannot proceed without a decision from the person running it asks a structured question instead of guessing or stopping with prose. The model issues a question request through a tool; the transcript shows it as a card with the question, its choices and a free-text alternative; the person answers and the answer returns to the model as the tool's own result, so the session continues in the same turn. This exists so that plan sessions (which are blind and therefore hit genuine gaps in intent) and implement sessions (which hit forks the plan does not settle) can get a ruling on the record rather than inventing one, and so that the question and its answer survive in the run log as evidence.

## Being asked a question
The model hits a decision it cannot make and puts the question to the user mid-session.
- B1: A session's model can request answers from the user by calling a question tool. The tool exists under the same name and with the same request shape on every engine, so a model's behaviour does not change with the engine.
  - E9: A question request arrives in a session mode whose tool set excludes the tool → the call is refused with a message the model can act on, not silently ignored.
- B2: One request carries one or more questions. Each question has a short header for the card, the question text, and a set of offered options; each option has a label and may carry a one-line explanation.
  - E3: Model sends a question with no options → the card shows a free-text-only question; Submit requires non-empty text.
- B3: A question is either single-select (exactly one answer) or multi-select (one or more answers), declared per question by the model.
- B4: Every question also accepts a free-text answer ("Other") regardless of the offered options, so the user is never forced into a choice the model imagined.
  - E1: Multi-select question, user selects several options and also types free text → all selected options and the free text are returned together as that question's answer.
  - E2: Single-select question, user types free text instead of choosing → the free text is the answer and no option is reported as chosen.
- B5: The transcript shows one card per request, with one group per question in the order the model asked them, and a single Submit for the whole card.
  - E7: A second request arrives while one is pending (possible only if the engine allows it) → both cards are shown in arrival order and each is answered on its own; the older one is not silently dropped.
- B6: While a request is unanswered the session's status is "needs human" and the session is shown that way in the sessions list and on its tab.
  - E5: User switches tabs or closes and reopens the chat view while a card is pending → the card is still there, still pending, and the session is still "needs human".
- B14: A session with an unanswered request makes no further progress: it produces no further tool calls or output until the request is resolved.

## Answering the card
The user reads the card, picks or writes an answer and submits it.
- B16: Submit is only possible when every question in the request has at least one answer, either a selected option or non-empty free text.
- B13: The answers the model receives are exactly what the user submitted: no option is pre-selected on the user's behalf, no default is applied, no timeout answers for them.
- B7: Submitting the card resolves the request: the answers are delivered back to the model as the result of its own tool call, and the session resumes without the user having to send a new prompt.
  - E10: The model asks several questions in one request and the user answers them all → the model receives all answers at once as one result, not as several turns.
  - E6: The session's engine is no longer alive when the user submits → the answer cannot be delivered; the card is marked as expired-unanswered and the user is told the answer did not reach the session.
- B8: A submitted card becomes read-only and keeps showing what was asked and what was answered; a request is resolved at most once, and after resolution — by answer or by cancellation — the card accepts no further input.

## Leaving a question unanswered
The user does not want to answer, or stops the session while a card is pending.
- B12: The user may decline to answer by cancelling or interrupting; the model is told the question was not answered rather than being given a fabricated choice.
  - E4: User interrupts the session while a card is pending → the request is cancelled, the card is marked unanswered and read-only, and the session stops as an interrupt would normally stop it.
- B15: The model sees the outcome of a request in exactly one of two forms: answered (with the answers) or unanswered (cancelled); it is never left waiting with no result.

## Which sessions may ask
- B10: With this tool available, plan sessions no longer follow the rule "ask in prose and stop"; a plan session that needs a ruling asks through the tool.
- B11: A session that has no user to reach (a sub-session the agent runs on its own behalf) does not get the tool at all.

## Reviewing the session afterwards
The question and its answer are part of the record, not only of the live view.
- B9: The request and its answers are written to the run log the same way any other tool call and result are, in the order they happened, so a transcript replayed from the log shows the question card with its answers.
  - E8: The same question request is shown again from a replayed run log → it renders with its recorded answers, read-only, and cannot be re-submitted.

## Open questions
- Q1: May a question offer a free-text answer *and* selected options in a single-select question, or is free text mutually exclusive with any selection there? (E2 assumes exclusive.)
- Q2: Are there caps on the number of questions per request and options per question, and what happens when a model exceeds them — refuse the call or truncate?
- Q3: Does the model receive option labels only, or labels plus the fact that the answer came from "Other"? The model may need to distinguish an offered choice from an invented one.
- Q4: Should a pending question survive a window reload (sessions are said to survive; engines resume at the next prompt), or is E6 the accepted outcome in that case?
- Q5: Is there any notification outside the chat view (status bar, toast) when a background session needs an answer, or is the sessions list enough?
- Q6: May the user answer a question with "you decide" explicitly, and if so is that a distinct outcome from cancelling?
- Q7: Is the tool available in chat-mode sessions as well as plan and implement sessions?

## Findings
| Finding | Proposed solution |
|---|---|
| F1 (contradiction, E6): for the same situation — the engine that asked is gone when the user answers — `SessionManager.respondToPermission` (src/agent/session/session-manager.ts) does not expire the request: it logs the resolution, turns the answer into the next user prompt (`decisionPrompt`) and resumes the session, even re-honouring an allow through `preapproved`. E6 says the answer cannot be delivered, the card is expired-unanswered and the user is told so. If E6 stands, the same session that resumes a permission would refuse to resume a question; the task would be to mark the card expired on delivery failure instead. | Change E6: an answer given after the asking turn is gone is delivered to the session as its next prompt (as a resolved permission already is) rather than thrown away, and only a session that cannot be resumed at all marks the card expired. Losing a decision the user already made is worse than the answer arriving one turn late. |
| F2 (breakage, B10): the Goal counts implement sessions among the askers, but only the plan-phase instructions are updated (T11). `implementPrompt` (src/agent/phases/implement.ts) tells the implementer to mark a task ` [blocked: reason]` and move on, and to "stop and say what is needed" — so an implement session would keep blocking rather than ask. The task would be to rewrite those two rules the way T11 rewrites the plan prompt. | Agreed, the spec is too narrow: widen B10 to every session that has a user, and add that an implement session facing a decision only the user can make asks through the tool instead of blocking the task; ` [blocked: reason]` stays for blockers that are not questions (a failing build, a missing dependency). |
| F3 (breakage, B10): "ask in prose and stop" is not one rule in `blindPlanPrompt` (src/agent/phases/blind-plan.ts): the direction checkpoint ("A short message, then stop and wait. Write nothing until the user says go") is a deliberate steering gate, and the spec's own `## Open questions` section is where what only the user can answer is recorded. Dropping the prose rule wholesale removes the gate and leaves it unsaid whether an answered question still belongs in Open questions. The spec should say which of the three it replaces. | Narrow B10: it replaces only "when intent does not settle something, ask in prose and stop"; the direction checkpoint stays, because that is the user steering the plan, not the plan asking a question, and `## Open questions` keeps only what is still unanswered — a question the user answered becomes a behaviour or edge case. |
| F4 (naive, B11): the code has one sub-session, the mapping run (`ChatViewProvider.startMapping`, mode `reconcile`), and it is started by the user, not by the agent on its own behalf — but it has no transcript: `ChatViewProvider.onSessionEvent` diverts every event of a session with a `parentId` into the plan bar's one-line `followMapping`, while `statusOf` shows the child's status on the parent's tab. So a card from it could never be shown though the tab would read "needs human". The spec should name the mapping run and say it asks through its findings, not through the tool. | Reword B11 to the rule behind it — a session whose output the user never sees as a transcript of its own does not get the tool — and name the mapping run and retrieval sub-sessions as the cases: they report what they could not settle in their result, and the parent session asks. |
| F5 (naive, B6): "needs human" does not distinguish a pending question. `nextStatus` (src/agent/session/session-status.ts) already returns `needs_human` on every `turn_done` of a plan, map or implement session, and once set only `user_message` or `permission_resolved` leaves it. So A1's "the status becomes needs human" is usually a no-op, and the sessions list cannot tell a waiting question from a finished turn; resolution also has to restore the working status explicitly. The spec should say how a waiting question is told apart (see Q5). | Change B6 and A1: a pending question is its own session state, distinct in the sessions list and on the tab from a turn that simply ended, and resolving it puts the session back to working; that settles Q5 for the in-product signal and leaves only the out-of-window notification open. A status that means both "done" and "blocked on me" cannot be acted on. |
| F6 (naive, B1/B7): the extension's own tools reach Claude through an in-process MCP server (`toolServer`/`toMcpTool`, src/agent/sdk-session/tool-server.ts), and an MCP tool request carries the client's request timeout; the only open-ended human wait this code proves out is `canUseTool`/`SdkSession.requestPermission`, which never times out. A question left on screen for minutes may be abandoned by the engine while the card is still pending. The spec should say what the model is told and what becomes of the card when the engine stops waiting, or require the wait to be kept alive. | Add an invariant: a pending question has no deadline — the wait is held open for as long as the card is unanswered — and if the engine abandons the wait anyway the card stays answerable and falls back to the F1 path. B13 forbids a default, so an expiry would have to mean "unanswered", which throws away a question the user is still looking at. |
| F7 (naive, E4/B15): interrupt does not reach a blocked tool on the Claude engine. `SdkSession.interrupt()` only calls `query.interrupt()`; the tool context is built in `buildOptions` with `this.abort.signal`, which fires on `dispose()` alone, and the abort listener that releases a pending request lives in `requestPermission`, on a path the tool does not use. After an interrupt the turn is torn down, so the "not answered" result cannot reach the model as that call's result. The spec should say the model learns of the cancellation on its next turn, not as the tool's own result. | Change E4 and B15: the guarantee is that the model never proceeds on an answer the user did not give, not that a cancelled request answers into the interrupted turn; say the model is told the question went unanswered when it next runs. After an interrupt there is no turn left to answer into. |
| F8 (naive, E9): a mode's tool set is not a refusal list. `extension.ts` filters the own tools by name (`allowed(OWN_TOOLS)`) and passes `setup.toolNames` to the engine, so an excluded tool is never offered to the model and there is nothing to refuse on the Claude engine; only `OpenAiSession.runTool` has a fallback ("Unknown tool"). The spec should say that excluding the tool means not offering it. | Agreed: rewrite E9 as "a mode that excludes the tool does not offer it, so no request can arrive", keeping an actionable refusal only for a model that names a tool it was never given. A refusal path for a tool the model cannot see is untestable. |
