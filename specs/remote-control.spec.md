---
feature: Remote control
status: approved
---

# Remote control

## Goal
A developer who has left the desk still owns every decision the agent cannot make for itself: a question it asked, a permission it needs, a spec waiting to be approved, decisions waiting to be ruled on. Today all of that waits until they are back in the editor, so a session that could have finished in the meantime stalls for want of a person. Remote control is a paired phone app, a forwarding service and the agent working as one: the phone shows the workspace's unfinished specs and its sessions — at work and stopped — alerts the person whenever something blocks a session from completing, and lets them answer it from the alert or steer the work from the app, while sessions the person has chosen to keep quiet wait silently until the next visit. The spec describes what the three parts deliver together, in the product's language, and binds each of them.

## Pairing a phone with a workspace
How a phone and a workspace's agent come to know each other, and what carries messages between them.
- **Pairing code**: the agent produces a pairing code on request and shows it both as text and as a QR code carrying it, and a phone becomes paired by presenting that code once.
  - **Code used once**: a pairing code pairs one phone and is spent afterwards, and a code nobody uses expires on its own.
- **Pairing is the only identity**: there is no account and no sign-in on either side — a completed pairing is the whole of what a phone and an agent know each other by.
- **One pairing per workspace**: a pairing joins one phone to one workspace's agent, and a phone paired with several workspaces keeps each workspace's specs and sessions apart.
- **Unpairing from the agent**: every paired phone is listed in the agent by the name it gave and when it last connected, and unpairing it there stops it receiving anything further.
- **Unpairing forgets the forward**: a phone's connection is the forward the service holds for it, so unpairing is the service forgetting that forward, after which the phone receives nothing and shows nothing of that workspace, whether or not the phone or the agent is reachable when it happens
  - **Revoking from another phone**: a paired phone can have another phone's forward for the same workspace forgotten, so a lost phone is cut off without waiting for the dev computer to come back
- **Agent reaches out**: the agent holds the link by connecting out to the service, so nothing reaches the dev computer except over a connection the computer opened and no inbound port or address of its own is needed.
- **Nothing kept after delivery**: the service forwards rather than stores — a message lives only until it is delivered or until what it concerns no longer waits, and no spec, transcript, diff or source is left behind.

## Following the work from the phone
What the person sees when they open the app.
- **Three lists**: the app shows the workspace's features whose spec is not finished with the step each is waiting on, the sessions at work, and the sessions that have stopped (docs/intent/agent.md#Stages)
- **Why a session stopped**: a stopped session says what holds it — a question open, a permission prompt pending, a turn ended with the next move the person's, a task blocked, or verification held (docs/intent/agent.md#Waiting for the person)
- **Session in view**: opening a session shows enough of its recent course — the prompts sent, the agent's replies, the tool calls and their outcomes — to judge what it is asking for
- **Last known when unreachable**: while the agent is not connected the app shows every list as it last was, together with when that was true
  - **Nothing to do while unreachable**: an answer or command on a stale list is refused with the reason rather than held for delivery when the agent returns

## Being alerted that work has stopped
The person is away; something stops the work and the phone has to say so, or deliberately not.
- **Anything that blocks completion pushes**: whenever a session stops mid-turn on the person — a question asked or a permission prompt pending — the agent pushes a notification to the paired phones that session is allowed to reach, and a turn that merely ended pushes nothing (specs/unfiled-decisions.md#A tab stopped mid-turn on the person pulses its icon)
  - **Progress is not an alert**: work that is still moving pushes nothing and is seen only in the app
- **Choices as buttons**: the notification carries what is being asked and offers its choices as buttons only where one tap settles the whole of it, and where it does not it carries a way straight into that prompt in the app instead (specs/user-question.spec.md#Being asked a question)
  - **Wizard for several questions**: a request holding more than one question is answered in the app one question to a screen, each taken with a single tap, so a small screen never shows several questions at once (specs/user-question.spec.md#Being asked a question)
  - **Decision that needs a screen**: where a choice cannot be judged from the notification alone — a file write, whose diff has to be read — the notification offers its buttons and a way straight into that prompt in the app (specs/file-edit-diff.spec.md#Behaviour)
- **Per-session push permission**: whether a session may push is the person's to set per session, and a session without permission pushes nothing
  - **Default by where it started**: a session started from the phone may push, and one started at the desk follows the workspace's standing default, which allows pushing until the person changes it
- **Quiet session waits to be visited**: a session that may not push waits with nothing sent, and what waits is counted in the app so the person's next visit shows it
- **Alert withdrawn once answered**: a notification whose question or prompt was resolved elsewhere, or whose session has ended, is withdrawn or shown as resolved rather than left offering buttons that do nothing

## Acting from the phone
The person answers or steers from away, and the effect is the same as at the desk.
- **Answer resolves the card**: an answer sent from the phone resolves the session's question exactly as an answer at the desk does, reaching the model as the result of its own tool call so the session carries on in the same turn (specs/user-question.spec.md#Answering the card)
  - **Free text from the phone**: a question answered from the phone can be answered in the person's own words as well as by the offered options (specs/user-question.spec.md#Being asked a question)
- **Permission answered from the phone**: a permission prompt can be allowed or denied from the phone with the same effect as at the desk, so a session never stalls for want of someone at the keyboard (docs/settings.md#Settings)
- **First answer wins**: the first answer to reach the agent resolves what was asked, that resolution reaches every device connected to the workspace — the computer and the paired phones — where the prompt disappears as it arrives, and a later answer to the same request is ignored (specs/user-question.spec.md#Answering the card)
- **Steering a running session**: the phone can send a running session a prompt and can interrupt it, an interrupt ending its turn as one made at the desk would (docs/intent/agent.md#Interrupting)
- **Approving and ruling**: a spec's rules and the check's decisions can be read on the phone and settled there — the spec approved, the decisions ruled on and sent (docs/intent/agent.md#Phase 2: Check against code)
- **Starting a draft's session**: the only work the phone starts is a spec — picking a feature whose spec is a draft opens that feature's planning session on it (specs/spec-drafts.spec.md#Picking up a draft)
- **Authoring stays at the desk**: writing a spec, commenting on a review and changing settings are not offered on the phone
- **Remote act on the record**: an answer or command from the phone is recorded in the session's log like the same act at the desk, noting that it came from that phone (docs/intent/agent.md#Observability)

## Open questions
- **Pairing lifetime**: whether a pairing that has gone unused for a long time expires by itself or stands until it is unpaired
