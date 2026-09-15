---
feature: Chosing models
status: draft
---

# Chosing models

## Goal
Someone running a feature through the agent decides which model does which work: one profile per phase of that feature's plan — blind plan, map against code, implement — and one profile per chat session, switchable while the session is in play. Today the model comes from settings alone, so whatever plans also implements, and the choice is invisible where the work happens. Making it part of the plan lets the strongest reasoner plan and a cheaper, faster model carry out the tasks, and lets a chat move to another model without losing the conversation. The two choices are independent: what a plan's phases run on says nothing about what a chat runs on.

## Choosing a model for each phase of a plan
The user picks, per feature, which configured profile each phase runs on, before or while the feature is being worked.

- **B1**: each phase of a feature that runs a model — blind plan, map against code, implement — carries its own profile choice, picked from the configured profiles; verification runs no model and takes no choice. (docs/intent/agent.md#Per-phase model)
- **B2**: a phase with no choice runs on the settings default — the plan profile for the blind plan, the active profile otherwise — so a feature nobody chose for runs exactly as it does today.
- **B3**: a choice takes effect on the next turn of that phase; a turn already in flight finishes on the model it started on, and a phase that already ended is not re-run by the choice.
  - **E1**: the implement phase's profile is changed while the board is part-worked → the next implement turn runs on the new profile and the existing task markers stand.
- **B4**: a phase that would continue the conversation of the phase before it does so only when its chosen profile runs on the same engine; on a different engine it starts fresh, carrying the conversation it had. (docs/intent/agent.md#Shape)
- **B5**: a retrieval sub-session keeps its own profile and is unaffected by the choice made for the phase that called it. (docs/intent/agent.md#Retrieval)
- **B6**: a choice naming a profile that is no longer configured falls back to the settings default and says so, rather than refusing to run the phase.
- **B7**: the choices are held per feature and per user, outside the spec and the tasks file, so they never change the feature's derived stage and never make a mapped board stale.
- **B8**: the plan view shows, for each phase, the profile it will run on, including when that profile is the settings default.

## Switching model in a chat session
A chat session runs on one profile at a time and the user can change it mid-conversation.

- **B9**: a chat session has its own profile, independent of any feature's phase choices, switchable from the composer at any point while the session is in play. (docs/intent/agent.md#Engines)
  - **E2**: a plan session's composer shows the profile its current phase runs on and offers no switch there — a plan's model is chosen per phase.
- **B10**: a switch takes effect on the next prompt; a turn in flight finishes on the model it started on.
- **B11**: after a switch the session carries on with the conversation it already has rather than starting over; nothing that only the previous engine held is carried.
- **B12**: a new chat session starts on the active-profile setting, and switching changes that session only — not the setting and not other sessions.
- **B13**: the composer shows which profile the session is on, and the transcript records each switch where it happened, so a reader can tell which model produced which part of the conversation.
