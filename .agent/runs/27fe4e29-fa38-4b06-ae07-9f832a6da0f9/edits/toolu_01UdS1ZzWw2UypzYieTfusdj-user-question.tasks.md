---
spec: 8fa73528
---

# Tasks for User question

- T1 (B2, B3, B4, B13, B16, E1, E2, E3): the question contract in domain terms — request (questions with header, text, options of label plus explanation, single/multi flag), answer per question (chosen labels and free text), plus the pure helpers both the card and the engines use: "is this request answerable", "is every question answered", and the answer text the model receives. [in progress]
  - files: src/agent/session/user-question.ts (new), test/user-question.test.ts (new)
- T2 (B6, I2, B15): carry the request and its outcome on the session event stream — a `question_request` and a `question_resolved` event beside the permission pair, a `respondToQuestion` on the session interface, and the status derivation that goes to "needs human" on a request and back to working on its resolution.
  - files: src/agent/session/code-session.ts, src/agent/session/session-status.ts, test/session-status.test.ts
- T3 (B1, B2, B3, B4): the tool itself, once, engine-agnostic: a zod schema over the T1 request, and an `ask` channel on `ToolContext` (today `cwd`, `signal`, `files`) that the tool awaits; the tool returns the answers as its own output text, or the not-answered text.
  - files: src/agent/openai-session/tools/ask-user.ts (new), src/agent/openai-session/tools/tool.ts, test/tools.test.ts
- T4 (B1, B7, B12, B14, B15, E10): own-loop engine — `OpenAiSession` passes an asker into the tool context it builds in `runTool`, emits `question_request`, holds the tool result until `respondToQuestion`, and releases every pending request as unanswered on `interrupt`/`dispose` the way `askPermission` does.
  - files: src/agent/openai-session/openai-session.ts, test/openai-session.test.ts
- T5 (B1, B7, I2, B15, A10): Claude engine — `SdkSession` passes the same asker into the tool context built in `buildOptions`, emits `question_request`, resolves the waiting tool call from `respondToQuestion`, and releases pending requests as unanswered on dispose. Keep the wait alive past the MCP request timeout if F6 is ruled that way.
  - files: src/agent/sdk-session/sdk-session.ts, src/agent/sdk-session/tool-server.ts, test/sdk-session.test.ts
- T6 (B7, B9, I2, I4, E7): route an answer from the webview to the session it belongs to — the protocol message, the provider case beside `permission`, and the manager method that forwards to the live engine and logs the resolution; a request already resolved is answered no further.
  - files: src/chat/protocol.ts, src/chat/chat-view-provider.ts, src/agent/session/session-manager.ts, test/session-manager.test.ts
- T7 (B5, B8, B16, E1, E2, E3, A5, A6, A7): the card — one card per request with one group per question in order, single/multi controls, a free-text "Other" per question, one Submit that is only available when every question has an answer and says what is missing otherwise, read-only with the submitted answers once resolved; the raw tool-call row for the question tool gives way to the card, and a pending card switches the plan session's view to chat the way a permission request does.
  - files: src/chat/webview/question-card.ts (new), src/chat/webview/chat-transcript.ts, src/chat/webview/events.ts, src/chat/webview/chat-app.ts, src/chat/webview/style.css
- T8 (B9, I4, E5, E7, E8): replay and lifecycle — `ChatTranscript.reset` rebuilds each card from the logged request and its resolution, read-only and unsubmittable once answered, still pending (and answerable) when it was not, in arrival order, across a tab switch and a reopened view.
  - files: src/chat/webview/chat-transcript.ts, src/chat/webview/question-card.ts
- T9 (B11, A11, Q7): offer the tool where it belongs — add its name to the plan and implement tool sets, leave it out of the mapping run's, and let it through the permission policy unprompted, so the person answers the question instead of first allowing it. Chat sessions get every tool by default; that follows Q7.
  - files: src/agent/phases/blind-plan.ts, src/agent/phases/implement.ts, src/agent/permissions/permission-policy.ts, src/extension.ts, test/permission-policy.test.ts
