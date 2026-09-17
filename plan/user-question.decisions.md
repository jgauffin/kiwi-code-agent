# Decisions for User question

### F1
- on: E6
- finding: for the same situation — the engine that asked is gone when the user answers — `SessionManager.respondToPermission` (src/agent/session/session-manager.ts) does not expire the request: it logs the resolution, turns the answer into the next user prompt (`decisionPrompt`) and resumes the session, even re-honouring an allow through `preapproved`. E6 says the answer cannot be delivered, the card is expired-unanswered and the user is told so. If E6 stands, the same session that resumes a permission would refuse to resume a question; the task would be to mark the card expired on delivery failure instead.
- proposed: Change E6: an answer given after the asking turn is gone is delivered to the session as its next prompt (as a resolved permission already is) rather than thrown away, and only a session that cannot be resumed at all marks the card expired. Losing a decision the user already made is worse than the answer arriving one turn late.

### F2
- on: B10
- finding: the Goal counts implement sessions among the askers, but only the plan-phase instructions are updated (T11). `implementPrompt` (src/agent/phases/implement.ts) tells the implementer to mark a task ` [blocked: reason]` and move on, and to "stop and say what is needed" — so an implement session would keep blocking rather than ask. The task would be to rewrite those two rules the way T11 rewrites the plan prompt.
- proposed: Agreed, the spec is too narrow: widen B10 to every session that has a user, and add that an implement session facing a decision only the user can make asks through the tool instead of blocking the task; ` [blocked: reason]` stays for blockers that are not questions (a failing build, a missing dependency).

### F3
- on: B10
- finding: "ask in prose and stop" is not one rule in `blindPlanPrompt` (src/agent/phases/blind-plan.ts): the direction checkpoint ("A short message, then stop and wait. Write nothing until the user says go") is a deliberate steering gate, and the spec's own `## Open questions` section is where what only the user can answer is recorded. Dropping the prose rule wholesale removes the gate and leaves it unsaid whether an answered question still belongs in Open questions. The spec should say which of the three it replaces.
- proposed: Narrow B10: it replaces only "when intent does not settle something, ask in prose and stop"; the direction checkpoint stays, because that is the user steering the plan, not the plan asking a question, and `## Open questions` keeps only what is still unanswered — a question the user answered becomes a behaviour or edge case.

### F4
- on: B11
- finding: the code has one sub-session, the mapping run (`ChatViewProvider.startMapping`, mode `reconcile`), and it is started by the user, not by the agent on its own behalf — but it has no transcript: `ChatViewProvider.onSessionEvent` diverts every event of a session with a `parentId` into the plan bar's one-line `followMapping`, while `statusOf` shows the child's status on the parent's tab. So a card from it could never be shown though the tab would read "needs human". The spec should name the mapping run and say it asks through its findings, not through the tool.
- proposed: Reword B11 to the rule behind it — a session whose output the user never sees as a transcript of its own does not get the tool — and name the mapping run and retrieval sub-sessions as the cases: they report what they could not settle in their result, and the parent session asks.

### F5
- on: B6
- finding: "needs human" does not distinguish a pending question. `nextStatus` (src/agent/session/session-status.ts) already returns `needs_human` on every `turn_done` of a plan, map or implement session, and once set only `user_message` or `permission_resolved` leaves it. So A1's "the status becomes needs human" is usually a no-op, and the sessions list cannot tell a waiting question from a finished turn; resolution also has to restore the working status explicitly. The spec should say how a waiting question is told apart (see Q5).
- proposed: Change B6 and A1: a pending question is its own session state, distinct in the sessions list and on the tab from a turn that simply ended, and resolving it puts the session back to working; that settles Q5 for the in-product signal and leaves only the out-of-window notification open. A status that means both "done" and "blocked on me" cannot be acted on.

### F6
- on: B1, B7
- finding: the extension's own tools reach Claude through an in-process MCP server (`toolServer`/`toMcpTool`, src/agent/sdk-session/tool-server.ts), and an MCP tool request carries the client's request timeout; the only open-ended human wait this code proves out is `canUseTool`/`SdkSession.requestPermission`, which never times out. A question left on screen for minutes may be abandoned by the engine while the card is still pending. The spec should say what the model is told and what becomes of the card when the engine stops waiting, or require the wait to be kept alive.
- proposed: Add an invariant: a pending question has no deadline — the wait is held open for as long as the card is unanswered — and if the engine abandons the wait anyway the card stays answerable and falls back to the F1 path. B13 forbids a default, so an expiry would have to mean "unanswered", which throws away a question the user is still looking at.

### F7
- on: E4, B15
- finding: interrupt does not reach a blocked tool on the Claude engine. `SdkSession.interrupt()` only calls `query.interrupt()`; the tool context is built in `buildOptions` with `this.abort.signal`, which fires on `dispose()` alone, and the abort listener that releases a pending request lives in `requestPermission`, on a path the tool does not use. After an interrupt the turn is torn down, so the "not answered" result cannot reach the model as that call's result. The spec should say the model learns of the cancellation on its next turn, not as the tool's own result.
- proposed: Change E4 and B15: the guarantee is that the model never proceeds on an answer the user did not give, not that a cancelled request answers into the interrupted turn; say the model is told the question went unanswered when it next runs. After an interrupt there is no turn left to answer into.

### F8
- on: E9
- finding: a mode's tool set is not a refusal list. `extension.ts` filters the own tools by name (`allowed(OWN_TOOLS)`) and passes `setup.toolNames` to the engine, so an excluded tool is never offered to the model and there is nothing to refuse on the Claude engine; only `OpenAiSession.runTool` has a fallback ("Unknown tool"). The spec should say that excluding the tool means not offering it.
- proposed: Agreed: rewrite E9 as "a mode that excludes the tool does not offer it, so no request can arrive", keeping an actionable refusal only for a model that names a tool it was never given. A refusal path for a tool the model cannot see is untestable.
