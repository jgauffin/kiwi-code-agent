---
feature: Background work
status: verified
id: b0429cd3-3124-4724-b927-333324ed32d3
authored: planned
---

# Background work

## Goal
A session regularly has to wait: for a build or a test suite to finish, for a server to come up, for a line in a log, for a file to appear, or for something outside the machine such as a CI run. Today the model waits by sleeping for a guessed time and then looking, which holds a call open for nothing, returns late when the thing was ready early and too soon when it was not. This feature gives a session, on either engine, a way to run a long command in the background and be told when it ends, a way to wait for a named condition that returns the moment it holds, and a way to end its turn and come back a few minutes later. With those in place a long sleep is refused, and the refusal names the way to wait that fits.

## Running a long command in the background
The model starts a command it does not want to sit and watch.
- **Background command**: a session on either engine can start a shell command in the background and gets an id back at once, while the command keeps running (docs/intent/agent.md#Engines)
  - **Survives an engine switch**: the session changes engine while a background command runs → the command keeps running and its notice reaches the session on the new engine, naming the command line it ran and what the model said it was for when it started it (docs/intent/agent.md#Engines)
- **Claude's own background commands**: the Claude engine's built-in way of running a command in the background is not offered, so a session on either engine runs background commands only this way.
- **Wake in a planning session**: chat sessions are offered background commands, waits and scheduled returns, a task or fix run is offered background commands and waits but no scheduled return, and a code plan session, a feature planning session and the check are offered none of them (docs/intent/agent.md#What a session is offered)
- **Judged like any command**: a background command is judged by the permission rules exactly as the same command run in the foreground, and is asked, passed or refused the same way (docs/features/permission-engine.md#The shell line)
- **Output kept in the scratch folder**: the command's output is written to a file in the session's scratch folder as it runs, and the session reads it there without a prompt.
- **Told when it ends**: when a background command exits, the session is told its id, its exit code, the last lines of its output and where the full output is, and an idle session starts a turn on it without the person prompting (docs/features/coordination.md#Channels)
  - **Ends during a turn**: the command exits while the session is in a turn → the notice reaches it as a tail on its next tool result instead of interrupting it (docs/features/coordination.md#Channels)
  - **Several end together**: several commands exit before the session is told → it is told about all of them at once.
  - **Held after interrupt**: a command exits after the person interrupted the session → no turn starts, and the notice reaches the session with the person's next prompt (docs/intent/agent.md#Interrupting)
- **Seen and stopped by the person**: the transcript shows each background command while it runs and how it ended, and the person can stop a running one from there.
- **Stopped by the model**: the model can list its running background commands and stop one by its id.
- **Ended with the session**: closing a session stops every background command it started, while interrupting a turn, granting the session full access, or changing its model or engine stops none of them.
  - **Run ends first**: a task or fix run ends its turn while a background command it started is running → the run is finished, the command is stopped, and no notice of it is ever delivered.
  - **Cut by a reload**: a window reload stops every running background command → on its next turn the session is told which ones were stopped, and their output so far stays where it was written.

## Waiting for something to happen
The model needs a condition to hold before it can go on, and the condition can be named.
- **Wait for a condition**: a session on either engine can wait for one condition, and the wait returns as soon as the condition holds.
  - **Already true**: the condition holds when the wait starts → it returns at once.
- **Conditions offered**: the condition is one of: a background command exits, a background command's output shows a line matching a pattern, a URL answers with any HTTP response, a port accepts connections, or a file exists, changes or is gone.
  - **Command ends before its pattern**: waiting for a pattern in a command's output, and the command exits without printing it → the wait returns at once, saying the command ended and how.
- **Bounded by a timeout**: every wait has a timeout of at most ten minutes, and one that runs out says so and returns what it last saw: the last lines of output, the last response or error.
- **Wait judged like its reach**: a wait on a URL or a port is judged by the permission rules as reaching the network, and one on a file as reading it (docs/features/permission-engine.md#Effects)
- **Wait ended by interrupt**: interrupting the turn ends a wait in progress and leaves the background command it watched running (docs/intent/agent.md#Interrupting)

## Coming back later
The model is waiting on something outside the machine that changes slowly, and holding a call open for it would waste the session.
- **Scheduled return**: a session can end its turn and ask to be resumed after a delay of at most ten minutes, saying why, and at that time it starts a turn with that reason, without the person prompting.
  - **Longest scheduled return**: a delay over ten minutes is refused, and the refusal names the longest delay allowed.
- **Shown while waiting**: while a return is scheduled, the session's status says when it will resume and why, and the person can cancel it (docs/intent/agent.md#Waiting for the person)
- **Person prompts first**: the person prompts the session before the scheduled time → the scheduled return is cancelled, and the session is told so with the person's prompt.
- **Lost on interrupt**: interrupting the session cancels a scheduled return (docs/intent/agent.md#Interrupting)
- **Kept across a reload**: a scheduled return survives a window reload.
  - **Missed while closed**: its time passed while the window was closed → no turn starts, and the session shows the missed return and waits for the person.
- **Runaway self-started turns**: turns a session starts on its own, on a background command's notice or a scheduled return, with no prompt from the person between them are capped at a configured number, ten unless set, and the next one is held and the person told why.

## Sleeping instead
The model reaches for `sleep` anyway.
- **Long sleep refused**: a shell command that sleeps for more than five seconds, by `sleep`, `Start-Sleep` or `timeout /t`, is refused without a prompt, and the refusal tells the model to wait for the background command's notice, wait for the condition it is after, or schedule its return.
  - **Short sleep in a loop**: a sleep of five seconds or less, such as one between retries in a polling loop, runs as before.
  - **Sleep in a background command**: the long sleep is inside a background command → it is refused the same way.
