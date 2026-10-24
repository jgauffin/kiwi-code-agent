---
feature: Cross-window chat
status: verified
id: 01af9c89-71d9-425b-8890-ee129d2b944a
authored: planned
---

# Cross-window chat

## Goal
A developer building a frontend in one VS Code window and its backend in another has an agent in each, and today the two never hear from each other: every contract change, endpoint shape and field rename is carried across by the person copying text between tabs. Cross-window chat links a chat session in one window to a chat session in another workspace on the same machine so the agents can talk: the person tells either agent what to keep in step, that agent asks or tells the other directly, and the receiving agent picks it up without waiting for the person. It carries the notes coordination passes between sessions of one workspace across to a second workspace. Each window keeps its own conversation, and what passes between the agents appears in both.

## Linking two sessions
The two windows run on the same machine; the person joins them by copying a code from one to the other.
- **Chat sessions only**: only a chat session offers linking, and plan, feature planning and implement sessions neither produce nor accept a code (docs/intent/agent.md#What a session is offered)
- **Pairing code**: a chat session produces a pairing code from a link action on the session, and entering that code through the same action in a chat session of another window links the two (specs/sessions/remote-control.spec.md#Pairing a phone with a workspace)
  - **Code used once**: a code links one session and is spent afterwards, and a code nobody uses expires on its own (specs/sessions/remote-control.spec.md#Pairing a phone with a workspace)
  - **Same machine only**: a code is accepted only by a window on the same machine under the same user, and a window whose extension runs elsewhere, a remote, container or WSL one included, refuses it with the reason.
  - **Same workspace refused**: entering a code in a session of the same workspace that produced it is refused with the reason.
- **Linked work on the new-session screen**: *Linked work* on the new-session screen's Code tab starts a new chat session linked by a pairing code, either creating the code there or entering the code the other window created (specs/unfiled-decisions.md#Linked work on the new-session screen)
  - **Unusable code starts nothing**: a code that is unknown, expired, produced in the same workspace or entered on a remote, container or WSL window is refused with the reason before any chat session is started.
- **Two to a link**: a link joins exactly two sessions, and a session already linked must unlink before it can take another code.
- **Link survives reloads**: a link outlives a window reload or restart and reconnects once both windows are open again, while the other side shows it as disconnected in the meantime.
  - **Message to a closed window**: a message for the other side while it is disconnected is refused with the reason rather than held for later.
- **Unlinking from either side**: either session can end the link, after which both show it as ended and neither agent can reach the other.
  - **Session closed ends the link**: a linked session that is deleted ends the link, and the other side shows it as ended.

## Agents talking to each other
- **Messages in both transcripts**: a message one agent sends the other appears in the sender's transcript as sent and in the receiver's as received, labelled with the other side's workspace.
  - **Nothing else crosses**: the person's messages, an agent's replies to the person and its tool calls show only in their own window.
- **Asking the other agent**: an agent can send a message to the agent of the session linked to its own, which reaches that agent as its next turn when it is idle and is answered back the same way.
  - **Receiver mid-turn**: a message arriving while the other agent is in a turn reaches it as a tail on its next tool result instead of interrupting it (docs/features/coordination.md#Channels)
- **Not the person's word**: a message from the other agent reaches the session marked as from the other window's agent, and grants no permission, answers no question the session put to the person and lifts no approved rule.
- **Runaway exchange stopped**: agent-to-agent messages with no message from the person in between are capped at a configured number, and the next one beyond it is refused and the person is told in both windows.
- **Other workspace out of reach**: linking grants no permission on the other workspace's files, so a read or write there is asked like any place outside this workspace (docs/features/permission-engine.md#Which scopes a place may be kept for)
- **Interrupt is local**: interrupting the agent in one window ends only that agent's turn (docs/intent/agent.md#Interrupting)
  - **Held after interrupt**: a message from the other side arriving after the person interrupted starts no turn, and is read by the agent on the turn the person's next message starts.
- **Origin on the record**: a message from the other window is recorded in the session's run log as an event carrying the workspace it came from.

## Pausing to redirect
The person sees the two agents heading the wrong way and wants to stop them before giving new instructions.
- **Pause from either window**: pausing the conversation from either window ends both agents' turns in flight, and both windows show it as paused.
- **Agents held while paused**: while paused, a message from one agent to the other is refused with the reason, so no agent starts a turn on the other side.
  - **Person still heard**: a message the person writes while paused starts turns as it would unpaused, so the person can redirect one or both agents before resuming.
- **Resume**: resuming from either window lets the agents reach each other again, and nothing refused during the pause is delivered afterwards.

## Open questions
- **More than two windows**: should a link later take a third session, for a repo such as a shared contracts library?
