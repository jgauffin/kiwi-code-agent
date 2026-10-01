---
feature: User question
status: draft
---

# User question

## Goal
A session that cannot proceed without a decision from the person running it asks a structured question instead of guessing or stopping with prose. The model issues a question request through a tool; the transcript shows it as a card with the question, its choices and a free-text alternative; the person answers and the answer returns to the model as the tool's own result, so the session continues in the same turn. This exists so that plan sessions (which are blind and therefore hit genuine gaps in intent) and implement sessions (which hit forks the plan does not settle) can get a ruling on the record rather than inventing one, and so that the question and its answer survive in the run log as evidence.

## Behaviour
- B1: A session's model can request answers from the user by calling a question tool. The tool exists under the same name and with the same request shape on every engine, so a model's behaviour does not change with the engine.
- B2: One request carries one or more questions. Each question has a short header for the card, the question text, and a set of offered options; each option has a label and may carry a one-line explanation.
- B3: A question is either single-select (exactly one answer) or multi-select (one or more answers), declared per question by the model.
- B4: Every question also accepts a free-text answer ("Other") regardless of the offered options, so the user is never forced into a choice the model imagined.
- B5: The transcript shows one card per request, with one group per question in the order the model asked them, and a single Submit for the whole card.
- B6: While a request is unanswered the session's status is "needs human" and the session is shown that way in the sessions list and on its tab.
- B7: Submitting the card resolves the request: the answers are delivered back to the model as the result of its own tool call, and the session resumes without the user having to send a new prompt.
- B8: A submitted card becomes read-only and keeps showing what was asked and what was answered.
- B9: The request and its answers are written to the run log the same way any other tool call and result are, so a transcript replayed from the log shows the question card with its answers.
- B10: With this tool available, plan sessions no longer follow the rule "ask in prose and stop"; a plan session that needs a ruling asks through the tool.
- B11: A session that has no user to reach (a sub-session the agent runs on its own behalf) does not get the tool at all.
- B12: The user may decline to answer by cancelling or interrupting; the model is told the question was not answered rather than being given a fabricated choice.

## Invariants
- I1: The answers the model receives are exactly what the user submitted: no option is pre-selected on the user's behalf, no default is applied, no timeout answers for them.
- I2: A request is resolved at most once; after resolution (answer or cancellation) the card accepts no further input.
- I3: A session with an unanswered request makes no further progress: it produces no further tool calls or output until the request is resolved.
- I4: Every question the model asked and every answer given appear in the run log, in the order they happened.
- I5: The model sees the outcome of a request in exactly one of two forms: answered (with the answers) or unanswered (cancelled); it is never left waiting with no result.
- I6: Submit is only possible when every question in the request has at least one answer, either a selected option or non-empty free text.

## Edge cases
- E1: Multi-select question, user selects several options and also types free text → all selected options and the free text are returned together as that question's answer.
- E2: Single-select question, user types free text instead of choosing → the free text is the answer and no option is reported as chosen.
- E3: Model sends a question with no options → the card shows a free-text-only question; Submit requires non-empty text.
- E4: User interrupts the session while a card is pending → the request is cancelled, the card is marked unanswered and read-only, and the session stops as an interrupt would normally stop it.
- E5: User switches tabs or closes and reopens the chat view while a card is pending → the card is still there, still pending, and the session is still "needs human".
- E6: The session's engine is no longer alive when the user submits → the answer cannot be delivered; the card is marked as expired-unanswered and the user is told the answer did not reach the session.
- E7: A second request arrives while one is pending (possible only if the engine allows it) → both cards are shown in arrival order and each is answered on its own; the older one is not silently dropped.
- E8: The same question request is shown again from a replayed run log → it renders with its recorded answers, read-only, and cannot be re-submitted.
- E9: A question request arrives in a session mode whose tool set excludes the tool → the call is refused with a message the model can act on, not silently ignored.
- E10: The model asks several questions in one request and the user answers them all → the model receives all answers at once as one result, not as several turns.

## Acceptance criteria
- A1: Given a plan session, when the model calls the question tool with one single-select question and three options, then a card appears in the transcript with the question header, the question text, the three options and a free-text field, and the session status becomes "needs human". (B2, B3, B4, B5, B6)
- A2: Given a pending card, when the user selects one option and submits, then the session status leaves "needs human", the model's next output reflects the chosen answer, and no additional user prompt was sent. (B7)
- A3: Given a request with two questions, when the user answers both and submits once, then the model receives both answers in one result. (B2, E10)
- A4: Given a multi-select question, when the user selects two options and submits, then both are present in the answer; given a single-select question, selecting a second option replaces the first. (B3)
- A5: Given a pending card, when no answer is chosen for one of its questions, then Submit is not available and the card explains what is missing. (I6)
- A6: Given a pending card, when the user types free text under "Other" and submits, then the free text is the answer for that question. (B4, E1, E2)
- A7: Given a card that has been submitted, when the user tries to change it, then the card is read-only and shows the answers as submitted. (B8, I2)
- A8: Given a session run to completion, when its run log is replayed into a transcript, then the question card appears in the same position with the same questions and the recorded answers. (B9, I4, E8)
- A9: Given a pending card, when the user interrupts the session, then the model is told the question was not answered and the card is marked unanswered. (B12, E4, I5)
- A10: Given the same question request sent on the Claude engine and on the own-loop engine, then the card looks and behaves the same and the model receives answers in the same shape. (B1, I1)
- A11: Given a sub-session the agent runs on its own behalf, when its available tools are listed, then the question tool is not among them. (B11)
- A12: Given a plan session prompt, when the model lacks information, then it asks through the tool and continues after the answer instead of ending its turn with a question in prose. (B10)

## Tasks
- T1: Define the question request and answer shape in domain terms: questions with header, text, options with label and explanation, single/multi flag, free-text alternative, and the answer form returned per question. This is the contract both engines and the transcript card follow. (B2, B3, B4, I1)
- T2: Expose the tool on the Claude engine so that a question request reaches the extension and the user's answers return to the model as the result of that same call, with no extra user turn. (B1, B7)
- T3: Expose the identically named and shaped tool on the own-loop engine, with the same request and answer handling. (B1, B7, A10)
- T4: Render the question card in the transcript: one group per question, single or multi select controls, per-question free-text field, one Submit for the card, validation that every question is answered. (B5, I6, E3, A5)
- T5: Wire card submission to request resolution: deliver answers, make the card read-only, and guarantee a request resolves at most once. (B7, B8, I2, I5)
- T6: Drive session status from pending requests: "needs human" while any request is unanswered, and back to running on resolution, reflected in both the sessions list and the tab. (B6, I3)
- T7: Record requests and answers in the run log and render them from the log on replay, read-only. (B9, I4, E8)
- T8: Handle non-answers: interrupt or cancel while pending resolves the request as unanswered and tells the model so; a request that cannot be delivered because the session is gone is marked expired. (B12, I5, E4, E6)
- T9: Handle multiple pending requests and view lifecycle: cards survive tab switches and view reopen, several pending cards are shown and answered in arrival order. (E5, E7)
- T10: Remove the question tool from sessions that have no user, and refuse the call with an actionable message in modes whose tool set excludes it. (B11, E9, A11)
- T11: Update the plan-phase instructions to drop the "ask in prose and stop" rule and to ask through the tool instead. (B10, A12)

## Open questions
- Q1: May a question offer a free-text answer *and* selected options in a single-select question, or is free text mutually exclusive with any selection there? (E2 assumes exclusive.)
- Q2: Are there caps on the number of questions per request and options per question, and what happens when a model exceeds them — refuse the call or truncate?
- Q3: Does the model receive option labels only, or labels plus the fact that the answer came from "Other"? The model may need to distinguish an offered choice from an invented one.
- Q4: Should a pending question survive a window reload (sessions are said to survive; engines resume at the next prompt), or is E6 the accepted outcome in that case?
- Q5: Is there any notification outside the chat view (status bar, toast) when a background session needs an answer, or is the sessions list enough?
- Q6: May the user answer a question with "you decide" explicitly, and if so is that a distinct outcome from cancelling?
- Q7: Is the tool available in chat-mode sessions as well as plan and implement sessions?
