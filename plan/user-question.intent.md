## docs/intent/agent.md#The mapping run has no voice (new)
- from: F4 (naive)
- why: intent does not say that the mapping run never speaks to the person.

The mapping run has no conversation of its own: while it works, the person sees a single line of progress on the plan it runs under. What it cannot settle it writes down as a finding for the person to rule on, and never asks.

## docs/intent/agent.md#Waiting for the person (new)
- from: F5 (naive)
- why: intent does not say that "needs human" is the resting state of a plan or implement session.

A plan, mapping or implement session hands back to the person whenever its turn ends: having stopped is itself needing the person. The status says the session is waiting; what it is waiting for is read from the session itself.

## docs/intent/agent.md#What a session is offered (new)
- from: F8 (naive)
- why: intent does not say that a session's phase decides which tools exist for its model at all.

A session's phase decides what its model can do: a capability outside the phase is not offered, so the model never proposes it and there is nothing to turn down.

## docs/intent/agent.md#Interrupting (new) [applied]
- from: F7 (naive)
- why: intent does not say what an interrupt does to whatever the session was waiting for.

Interrupting a session ends the turn it is in. Anything the session was waiting on is abandoned rather than answered, and the session learns how it ended when the person next prompts it.
