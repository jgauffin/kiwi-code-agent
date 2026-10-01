---
feature: Agents.md rule bundles
status: draft
---

# Agents.md rule bundles

## Goal
A person using the agent today gets one fixed set of rules: the ones that make the agent work the way it does, and beside them matters of taste and practice — reproduce a bug before fixing it, refactor towards SOLID, name things this way — that not every team wants and no team can decline. Rule bundles separate the two. A bundle is a named, versioned set of rule text kept in a git repository, applied into the workspace's or the person's `AGENTS.md`, where both engines already read it and the whole team can see it in their source. The product keeps its own catalog, so anyone contributes a bundle by a pull request against it, and a company points the agent at its own repositories and names there the bundles its teams must carry. Because the rules now live in `AGENTS.md`, a workspace still on `CLAUDE.md` is offered, once, to move.

## Rules that became optional
What the agent guarantees about itself and what the person chooses are no longer the same list.
- **Core behaviour stays in the prompt**: the rules that make a phase what it is — the planner's blindness to the code, the spec contract, reading before writing, tests as the evidence of done — are the agent's own instructions and no bundle can remove, replace or override them (docs/intent/agent.md#Instructions).
- **Optional mechanics ship as bundles**: the judgment rules that are a matter of practice rather than of the agent working at all are gone from every phase's instructions and reach a session only as an applied bundle (docs/intent/agent.md#Instructions).
- **Not pre-applied on upgrade**: a workspace in use before bundles existed has none applied for it, so a rule that used to hold by default holds again only once the person has chosen it.
- **Bundle rules reach a session as the person's own instructions do**: an applied bundle joins a session's instructions exactly where the workspace's and the person's instruction files join them, on either engine (docs/settings.md#Instruction files and skills).
  - **Clash with a core rule**: where a bundle rule contradicts a core rule, the core rule holds and the session says which bundle rule it set aside.
  - **No bundles for the blind planner**: a feature-planning session carries no bundle rules, since bundles describe how code is written (docs/intent/agent.md#Skills).

## Picking up bundles for a workspace
The person has a workspace with no bundles applied, and the agent offers what fits it.
- **Suggested once per workspace**: a workspace with no bundle applied draws one offer of the bundles that match it, and dismissing that offer ends it until the person asks for bundles themselves.
- **Matched by what the workspace holds**: a bundle declares what it applies to — nothing in particular, a language, or a framework — and only the matching ones are suggested, with the ones that apply to nothing in particular always among them.
- **Text seen before it is applied**: the rules a bundle would add are shown before it is applied for the first time, and nothing is written to a file without the person accepting it.
- **Project or person scope**: a bundle is applied either for the project, in the workspace's `AGENTS.md`, or for the person, in their own (docs/settings.md#Instruction files and skills).
- **One marked block per bundle**: an applied bundle occupies one block of the file naming its source, its name and its version, and applying, updating or removing a bundle changes nothing outside that block.
- **Managed at any time**: the person can see which bundles are available and which are applied, apply one and remove one, without waiting for a suggestion.

## Where bundles come from
A bundle is fetched from a git repository, the product's own or a company's.
- **The product's catalog is a source without being configured**: the product's own bundle repository is always among the sources and is an ordinary git source, so a bundle is contributed by a pull request against it.
- **Further sources are git repositories named in settings**: more sources are named as git repository URLs in the person's settings and in the workspace's, the workspace's adding to the person's rather than replacing them.
- **Fetched with the git access the person already has**: a source is read with the person's existing git credentials, so a company's private repository needs no sign-in of its own.
- **A source is accepted before it is fetched**: a source the person has not accepted before is not fetched until they accept it, named by its repository.
  - **Source that arrived with the workspace**: a source named by a workspace the person just cloned is put to them in that workspace like any other new source.
- **Unreachable source falls back to the last fetch**: when a source cannot be reached its bundles are offered from the copy last fetched, said to be as of that fetch, and a source never fetched offers nothing.
- **Rule text only**: a bundle contributes rule text and nothing else — no commands, tools, permissions or settings — and anything else carried in it is ignored.
- **A source may require bundles**: a source repository can name bundles as required, and those are applied for the project the first time that source is used in a workspace.
  - **A required bundle comes back**: a required bundle whose block has been removed is applied again, with a line naming the source that requires it.
- **Updates are offered, never silent**: when a source holds a newer version of an applied bundle the change is put to the person, and the answer is remembered for that bundle — later versions arrive with a notice, or this version is kept and not raised again until the person asks.
  - **Block changed by hand**: when the block of an applied bundle has been edited by hand, that is said before an update replaces it.

## Moving from CLAUDE.md to AGENTS.md
A workspace or a person whose rules still sit in `CLAUDE.md`.
- **Offered once per file**: the move is offered once for the workspace's `CLAUDE.md` and once for the person's own, and a declined offer is not raised again (docs/settings.md#Instruction files and skills).
- **Content moves whole**: accepting writes the file's content into `AGENTS.md` beside it and removes `CLAUDE.md`, shown as a change the person confirms before it is made.
  - **Both files already there**: when `AGENTS.md` already exists its text is left as it was and the `CLAUDE.md` text is appended under a heading saying where it came from.
- **Same rules on both engines after the move**: once moved, a session on either engine works from the one `AGENTS.md` and no rule that reached it before the move stops reaching it (docs/settings.md#Instruction files and skills).
