# Decisions for Chosing models

### Cleanup is a feature-scoped model phase B1 leaves out [applied]
- on: B1
- finding: `SessionMode`/`STEPS` in `src/agent/session/session-manager.ts` and `kiwiAgent.profiles.steps` (docs/settings.md#Settings) already give `cleanup` its own model choice alongside `plan`, `reconcile` and `implement`, and `ChatViewProvider.runCleanup` in `src/chat/chat-view-provider.ts` creates it under the feature like the other three; B1 names only blind plan, map and implement as the phases that carry their own profile choice, leaving cleanup's per-feature choosability unstated.
- proposed: each phase of a feature that runs a model — blind plan, map against code, implement, cleanup — carries its own profile choice, picked from the configured profiles; verification runs no model and takes no choice. (docs/intent/agent.md#Per-phase model)
- proposed: every phase of a feature that runs a model carries its own profile choice, picked from the configured profiles, and a phase that runs no model takes no choice. (docs/intent/agent.md#Per-phase model)
- proposed: each phase of a feature that runs a model — blind plan, map against code, implement — carries its own profile choice, picked from the configured profiles, and cleanup runs on the implement phase's choice rather than one of its own. (docs/intent/agent.md#Per-phase model)
- recommended: 1
- because: naming cleanup alongside the other three keeps the rule as provable as it is now and matches the phases the product actually offers, where the open-ended wording of 2 leaves a test nothing fixed to check and 3 takes a choice away that already exists.
- ruling: each phase of a feature that runs a model — blind plan, map against code, implement, cleanup — carries its own profile choice, picked from the configured profiles; verification runs no model and takes no choice. (docs/intent/agent.md#Per-phase model)

### Cross-engine handoff does not carry the conversation [applied]
- on: B4, B11
- finding: `SessionManager.setProfile` and `continuationOf` in `src/agent/session/session-manager.ts` clear `engineSessionId` on an engine change, and `activate` in `src/extension.ts` only rebuilds history (`sessions.conversation`) when `engineSessionId` is set, so a phase or chat session that moves to a different engine starts with no prior conversation at all; both rules call for it to start fresh only in the sense of losing what the previous engine held, while carrying the conversation itself.
- proposed: a phase or chat session that moves to a profile on a different engine begins with the conversation it already had, and loses only what the previous engine alone held.
- proposed: a phase or chat session that moves to a profile on a different engine begins with no earlier conversation and says so where the work happens, so the user knows the history did not travel.
- proposed: a chat session that switches to a profile on a different engine carries its conversation forward, while a phase whose chosen profile runs on a different engine starts with no earlier conversation.
- recommended: 1
- because: carrying the conversation across an engine change is the whole promise of switching mid-work, and dropping it silently — or only for plan phases — makes a switch cost the user the context they were relying on.
- ruling: a phase or chat session that moves to a profile on a different engine begins with the conversation it already had, and loses only what the previous engine alone held.

### Missing-provider is refused, not a settings-default fallback [applied]
- on: B6
- finding: `resolveStep` in `src/agent/session/model-profile.ts` throws when a profile names a provider settings no longer configures, by the stated rule that a session silently running on another model is worse than one that refuses to start; B6 asks a choice pointing at configuration that is gone to fall back to the settings default and say so rather than refuse the phase.
- proposed: a choice naming a profile that is no longer configured refuses to start the phase and names the configuration that is missing, rather than running the phase on another model.
- proposed: a choice naming a profile that is no longer configured refuses to start the phase, names the configuration that is missing and offers the settings default, which runs only once the user takes it.
- recommended: 2
- because: it keeps the product's line that no phase ever runs on a model the user did not pick, while leaving the user a way forward instead of a dead end.
- ruling: a choice naming a profile that is no longer configured refuses to start the phase, names the configuration that is missing and offers the settings default, which runs only once the user takes it.

### The transcript shows only the current model, not where it changed
- on: B13
- finding: `ChatTranscript.apply`'s `session_started` case in `src/chat/webview/chat-transcript.ts` calls `setStatus`, which overwrites one persistent status line (`this.statusLine.textContent = text`) rather than marking the point in the scrolling transcript, so a reader cannot tell after the fact which part of the conversation a given model produced.
- proposed: the composer shows which profile the session is on, and each answer in the transcript carries the profile that produced it.
- proposed: the composer shows which profile the session is on, and a switch changes what the composer shows without leaving a mark in the transcript.
- recommended: keep
- because: marking the switch where it happened is what lets a reader attribute the conversation at all, which 2 gives up and 1 buys at the price of labelling every answer.
- ruling: keep
