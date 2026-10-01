---
feature: Project and User wide memories
status: approved
---

# Project and User wide memories

## Goal
A person working with the agent repeats themselves: the same correction, the same standing constraint, the same environment quirk, in every new session, because nothing a session learns outlives it. Memories give those notes a home — a short note on one thing, kept either for this project or for the person across every project, written when the person settles something and in hand at the start of the next session. They are working notes about how to work here, not product intent: anything that says what the product does still belongs in the docs and the specs. Memories are kept in Claude Code's memory files, so a session on the Claude Agent SDK reads them natively and a session on an OpenAI-compatible endpoint reaches the same notes through the agent's memory tools.

## Remembering what the person settled
During a session the agent notices something that will matter again and writes it down.
- **Written on a correction or a standing rule**: the agent records a memory when the person corrects it or states something that holds beyond the task in hand, and at no other time.
  - **Single-use fact**: something that matters only for the current task, such as a value it just worked out or the file it is about to edit, is not remembered.
- **One note per memory**: a memory is one note of a few lines, named by what it is about, and carries one line of its own in the memory index.
- **Project or user scope**: a memory about this codebase or its environment is kept for the project, and one about how the person wants to be worked with is kept for the person across every project.
  - **Scope named by the person**: when the person says which scope a memory belongs to, that is where it is kept.
- **The write is shown in chat**: each memory written appears in the chat as one line naming the memory and its scope, so the person can have it taken back in the same turn.
- **Contradicting memory is replaced**: a new memory that contradicts one already kept at the same scope replaces that one instead of being kept beside it.
- **Intent is filed rather than remembered**: something that says what the product does, or is a decision about it, is written to the unfiled decisions instead of being kept as a memory (docs/intent/agent.md#Unfiled decisions).
- **Memories stay out of the repository**: memories are kept with the person's own files rather than in the workspace's source, and a note the whole team should follow is offered as a docs change instead.
- **Index cap**: a scope holds at most fifty memories; a write past the cap drops the oldest note of that scope and says so in the chat line.

## Starting a session with what is already known
- **Every session that may read the code starts with the memories**: every session but the blind planner begins with the project's and the person's memory index in hand.
- **The blind planner gets none**: a feature-planning session is given no memories (docs/intent/agent.md#Phase 1: Feature planning).
- **Index first and note on demand**: a session starts with the one-line index only and reads a note's body when the work touches it.
  - **Memory written mid-session**: a memory written during a session is in hand for the rest of that session without a restart.
- **Project over user on a clash**: where a project memory and a user memory say different things about the same subject, the project memory holds (docs/settings.md#Instruction files and skills).
- **Same memories on both engines**: a session on the Claude Agent SDK and a session on the own loop work from the same memory notes (docs/intent/agent.md#Engines).
  - **No second copy on the Claude engine**: memories the Claude engine reads for itself are not put in front of it again (docs/settings.md#Instruction files and skills).

## Reviewing and forgetting
- **Memories can be listed and opened**: the person can see every memory kept for this project and for themselves, each with its scope, and open one to change it by hand.
- **Forgetting removes the note and its line**: when the person asks for a memory to be forgotten, the note and its index line go, and no later session sees it.
- **Notes are the truth**: when the index and the notes disagree, because the person added, changed or deleted a note by hand, the index is rebuilt from the notes.
- **A wrong memory is corrected where it misleads**: memories are never swept for staleness; one that turns out to be wrong is replaced at the moment it misleads a session.
