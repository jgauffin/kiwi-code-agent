## docs/intent/agent.md#Per-phase model (append)
- from: ruled by the user while planning
- why: intent wants a model per phase but does not say where the choice is made or how it relates to a chat session's model; settings were the only source and the two were one and the same.

The model a phase runs on is chosen per feature, one profile per phase, and held as the user's own preference beside the feature rather than in its plan files: it is a way of working, not part of what the feature is, and it never changes the stage a feature is at.

A chat session's model is chosen on the session and can be changed while the conversation is in play; it is independent of any feature's phase choices. Where nothing is chosen, the settings default stands.
