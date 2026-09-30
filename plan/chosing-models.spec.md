---
feature: Chosing models
status: approved
---

# Chosing models

## Goal
Someone running a feature through the agent decides which model does which work: the profile names a model per step, so the strongest reasoner plans and a cheaper, faster model carries out the tasks. A chat session has its own profile, switchable while the session is in play without losing the conversation. The two are independent: what a plan's phases run on says nothing about what a chat runs on.

## The model for each phase of a plan
Each phase runs on what the active profile names for its step; the plan view offers no model choice.

- **B1**: each phase of a feature that runs a model (blind plan, map against code, implement, cleanup) runs on the active profile's entry for its step; verification runs no model. (docs/intent/agent.md#Per-phase model)
- **B3**: a profile changed in settings takes effect on the next turn of a feature's run; a turn already in flight finishes on the model it started on, and a phase that already ended is not re-run by the change.
  - **E1**: the implement step's model is changed while the board is part-worked → the next implement turn runs on the new model and the existing task markers stand.
- **B4**: a phase that moves to a model on a different engine begins with the conversation it already had, and loses only what the previous engine alone held. (docs/intent/agent.md#Shape)
- **B5**: a retrieval sub-session keeps its own profile and is unaffected by the profile of the phase that called it. (docs/intent/agent.md#Retrieval)

## Switching model in a chat session
A chat session runs on one profile at a time and the user can change it mid-conversation.

- **B9**: a chat session has its own profile, independent of what a feature's phases run on, switchable from the composer at any point while the session is in play. (docs/intent/agent.md#Engines)
  - **E2**: a plan session's composer shows the profile its current phase runs on and offers no switch there: a plan's models are set in the profile.
- **B10**: a switch takes effect on the next prompt; a turn in flight finishes on the model it started on.
- **B11**: a chat session that switches profile carries on with the conversation it already has rather than starting over, and on a switch to a profile on a different engine it loses only what the previous engine alone held.
- **B12**: a new chat session starts on the active-profile setting, and switching changes that session only — not the setting and not other sessions.
- **B13**: the composer shows which profile the session is on, and the transcript records each switch where it happened, so a reader can tell which model produced which part of the conversation.
