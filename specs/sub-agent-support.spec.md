---
feature: Sub agent support
status: implemented
authored: planned
---

# Sub agent support

## Goal
A session regularly needs work done that would fill its own context with material it does not need to keep: locating something across many files, answering a question from the internet, reading a long document for one fact. A sub agent is a delegate a session hands one self-contained task to and gets one report back from, with its own instructions, a tool set capped by its caller, a budget the caller sets and a transcript of its own. The product ships the sub agents it needs, a workspace or a person adds their own as files, and a session defines one in the call where none of those fits, saying there what it wants back. A session on the Claude engine hands work on through that engine's own path, which the engine decides and we do not; this feature is the delegation we own end to end, where a session on an OpenAI-compatible endpoint calls sub agents the product names, instructs, caps and shows.

## Sub agents a session can call
- **Three kinds of sub agent**: a session is offered the sub agents the product ships, the ones defined in the person's and the workspace's files, and one it defines in the call itself when neither fits.
- **Definitions follow the skills layout**: a defined sub agent is a file under the person's profile and under the workspace in the folders skills already use, the workspace winning over the person and our own folder over Claude Code's where a name is shared (docs/settings.md#Instruction files and skills)
  - **Clash with a shipped sub agent**: a definition taking the name of one the product ships does not replace it; the shipped one keeps the name and the session is told that definition is not on offer.
- **The index rides in the tool**: each offered sub agent's name and what it is for reaches the model in the delegating tool's description, and the model picks one itself when a task matches rather than being told which to use (docs/intent/agent.md#Skills)
- **Offered by phase**: delegation reaches every session that may read the code, and a feature-planning session only as research and as a sub agent it defines itself (docs/intent/agent.md#What a session is offered)
- **Each engine's own delegation**: a session on an OpenAI-compatible endpoint delegates through the sub agents the product offers, with their names, instructions and caps, while a session on the Claude engine keeps that engine's own way of handing work on, which the product neither lists nor restricts (docs/intent/agent.md#Engines)
- **Retrieval is a shipped sub agent**: The product ships a quote-only lookup sub agent, offered to every session that may read the code, which reports verbatim excerpts with their source, one line on why each matches and what it could not find, in its report like any other sub agent.

## Handing a task over
What one delegation carries, and what comes back from it.
- **What the call carries**: a delegation names the sub agent or defines one, states the task in full and what the caller wants back, and sets what it may spend.
- **Return contract**: a shipped sub agent answers in its own shape and a caller cannot loosen it; a sub agent the caller defines answers in the shape that call asked for.
- **Budget per call**: the budget is tool calls and tokens, set by the caller, and a sub agent that exhausts it returns what it has as a partial result rather than as an error (docs/intent/agent.md#Retrieval)
- **One report into the caller's context**: what reaches the calling conversation is the report alone, the sub agent's own messages and tool results staying in the run log (docs/intent/agent.md#Observability)
  - **Shown as one row**: The transcript shows a delegation as one step giving the task, its status and its counts, which expands in place to the sub agent's own messages and tool calls.
- **No delegating further**: a sub agent is never offered the delegating tool, so a delegation is one level deep (docs/intent/agent.md#Retrieval)
- **Independent delegations fan out**: a caller may have several sub agents at work at once, each on its own task with no shared state, each reporting back on its own (docs/intent/agent.md#Retrieval)
- **The model it runs on**: a shipped sub agent runs on the profile entry for its own kind and a defined one on the model its definition names, and anything else runs on the model of the session that called it (specs/chosing-models.spec.md#The model for each phase of a plan)
  - **Same provider as the caller**: what either names is a model id on the calling session's own provider, not a switch to another provider, so a delegation never needs a connection or a key of its own.
- **Spend counted to the caller**: a sub agent's tokens and cost are part of the calling session's totals rather than a session of their own (docs/features/session-cost.md#Session cost)
- **Interrupting the caller ends it**: interrupting a session ends every delegation in flight, and what a sub agent had found is abandoned rather than reported (docs/intent/agent.md#Interrupting)

## What a sub agent may touch
- **Tools capped by the caller**: a sub agent's tools are what its definition or its call asks for, narrowed to what the calling session is itself offered, so a delegation never reaches past its caller (docs/intent/agent.md#What a session is offered)
  - **The engine's own dispatch**: the cap holds for the sub agents the product offers, and a subagent the Claude engine hands work to on its own is neither named, instructed nor narrowed by the product.
- **Writes under the caller's own rules**: a sub agent whose tools include writing writes through the ordinary permission prompt, exactly as the calling session's own writes do (docs/intent/agent.md#Phase 3: Implement)
  - **A file it has not read**: a sub agent is refused a write to a file it never read or that changed since it read it, as any session is (specs/parallell-session-support.spec.md#Writing a file another hand changed)
- **Claims belong to the calling session**: a file a sub agent touches is claimed for the session that called it, so it never collides with its own caller while another session is still told who holds the file (docs/features/coordination.md#Claims)
- **Instructions and tools only**: a definition contributes its instructions and the tools it asks for and nothing else, no MCP servers, permission rules or settings of its own (specs/bundles.spec.md#What a bundle carries)
- **The caller's rules reach it**: a sub agent carries the instruction files, skills, memories and applied bundles its calling session carries, since it works in the same code under the same rules (docs/settings.md#Instruction files and skills)

## Research while planning blind
The blind planner reaches the internet only through a research sub agent, which is how a question is answered in one delegation instead of one call per site.
- **Research is blind by construction**: the research sub agent's tools are the planner's own minus anything that writes, plus searching and fetching from the internet, so nothing that could show the planner the code is in its set (docs/intent/agent.md#Phase 1: Feature planning)
- **One permission for the whole research**: approving a research delegation approves the research, and the sub agent then reads whatever pages answering the question takes without being asked about per site, since what the person approved is the question rather than a list of addresses.
  - **Standing permission per workspace**: a workspace may allow research outright, after which no research delegation is asked about at all.
- **Quotes with their source**: research reports verbatim excerpts, each with the address it came from and one line on why it matches, together with what it could not find, so the planner rules on the material rather than on a summary (docs/intent/agent.md#Retrieval)
- **Research is never a citation**: a rule cites only `docs/**` or another spec, so a rule the planner reached through research stands as its own default and the research is named in the direction instead (docs/intent/agent.md#Phase 1: Feature planning)
- **Unreachable internet**: where the internet cannot be reached the delegation reports that it could not research, rather than answering from what the model remembers.

## Open questions
- **Further shipped sub agents**: beyond the quote-only lookup and research, which sub agents the product should ship of its own.
