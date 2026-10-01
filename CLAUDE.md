# Vocabulary

- **Session**: what the person works in: a chat, a plan, a feature plan, a docs evaluation. One tab, one `SessionRecord`, one mode. Outlives engine restarts.
- **Thread**: one conversation inside an engine, what the Claude Agent SDK and the own loop call a session. A session is on one thread at a time and resumes it by `engineSessionId`.
- **Engine**: what threads run on: the Claude Agent SDK or the own OpenAI-compatible loop (`profile.engine`).
- **Access**: what a session may do, `scoped` by its mode or `full`. Granted one way and in place; the session keeps its mode and thread.

Identifiers that say "session" for a thread (`engineSessionId`, `CodeSession`, `SdkSession`, `OpenAiSession`) are pending a rename.
