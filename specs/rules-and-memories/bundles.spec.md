---
feature: Bundles
status: verified
---

# Bundles

## Goal
A person using the agent once got one fixed set of rules: the ones that make the agent work the way it does, and beside them matters of taste and practice, reproduce a bug before fixing it, refactor towards SOLID, name things this way, that not every team wants and no team can decline. Bundles separate the two. A bundle is a named, versioned thing kept in a git repository and applied for a workspace or a person: it carries rule text, which lands in `AGENTS.md` where both engines read it and the whole team sees it in their source, and it carries skills, a worked procedure with the templates and scripts it needs, which otherwise reach a teammate only by hand. The product keeps its own catalog, so anyone contributes a bundle by a pull request against it, and a company points the agent at its own repositories and names there the bundles its teams must carry. A teammate who clones the project gets what the organization works by with the source rather than by word of mouth.

## Rules that became optional
What the agent guarantees about itself and what the person chooses are no longer the same list.
- **Core behaviour stays in the prompt**: the rules that make a phase what it is — the planner's blindness to the code, the spec contract, reading before writing, tests as the evidence of done — are the agent's own instructions and no bundle can remove, replace or override them (docs/intent/agent.md#Instructions).
- **Optional mechanics ship as bundles**: the judgment rules that are a matter of practice rather than of the agent working at all are gone from every phase's instructions and reach a session only as an applied bundle (docs/intent/agent.md#Instructions).
  - **The agent's own style stays core**: a rule that defines how this agent writes code, not a team's own practice — the smallest change that does the job, no abstractions or comments the task did not ask for — is part of what makes the agent itself and stays in the prompt like any other core rule.
- **Not pre-applied on upgrade**: a workspace in use before bundles existed has none applied for it, so a rule that used to hold by default holds again only once the person has chosen it.
- **Bundle rules reach a session as the person's own instructions do**: an applied bundle joins the instructions of a chat session, a plan session, the check against the code and every implementation, testing and cleanup run, exactly where the workspace's and the person's instruction files join them, on either engine (docs/settings.md#Instruction files and skills).
  - **Person-scope bundle on either engine**: a bundle applied for the person reaches a session on either engine, the same as one applied for the project.
  - **Clash with a core rule**: where a bundle rule contradicts a core rule, the core rule holds and the session says which bundle rule it set aside.
  - **No bundles for the blind planner**: a feature-planning session carries no bundle rules, since bundles describe how code is written (docs/intent/agent.md#Skills).

## What a bundle carries
A bundle is not rule text alone.
- **Rule text and skills only**: a bundle contributes rule text, skills and the metadata it declares about itself, and nothing more — no commands, tools, permission rules, settings or MCP servers — and anything else it carries is ignored.
  - **Metadata a bundle declares about itself**: a bundle may declare metadata describing what it is and what it claims, which the agent reads to match it to a workspace and to compose it with the other applied bundles, and which contributes no rule text of its own.
- **Rule text only** [removed]
- **Skills as a bundle payload**: a bundle declares what it carries — rule text, skills, or both — and one that carries skills is fetched, matched, offered, accepted and versioned exactly as a rule-text bundle is.
  - **Skills-only bundle**: A bundle that carries no rule text writes nothing into `AGENTS.md`, and what it is shows only in the skills it installed.
- **The skill's whole folder travels**: a bundled skill arrives with its description and the files it refers to by relative path, so a skill that ships a template or a script is complete where it lands.
  - **Nothing in a bundle runs when it is applied**: applying a bundle only writes files, and a script a skill carries runs only when a session chooses to run it, answered by the permission rules like any other command.

## Picking up bundles for a workspace
The person has a workspace with no bundles applied, and the agent offers what fits it.
- **Suggested once per workspace**: a workspace with no bundle applied draws one offer of the bundles that match it, and dismissing that offer ends it until the person asks for bundles themselves.
- **Matched by what the workspace holds**: a bundle declares what it applies to — nothing in particular, a language, or a framework — and only the matching ones are suggested, with the ones that apply to nothing in particular always among them.
- **Text seen before it is applied**: the rules a bundle would add are shown before it is applied for the first time, and nothing is written to a file without the person accepting it.
- **Skills seen before they are applied**: the name and description of every skill a bundle would add are shown before that bundle is applied for the first time, beside the rule text it would add, and nothing is written without the person accepting it.
- **Project or person scope**: a bundle is applied either for the project, in the workspace's `AGENTS.md`, or for the person, in the `AGENTS.md` of their user profile, and never into a `CLAUDE.md` (docs/settings.md#Instruction files and skills).
- **Project scope puts the skills in the source**: a bundle applied for the project installs its skills in the workspace among the files the team commits, so a teammate who clones the repository has them without applying anything.
- **Person scope installs into the profile**: a bundle applied for the person installs its skills under their own profile, where they reach every workspace they open.
- **One marked block per bundle**: an applied bundle occupies one block of the file naming its source, its name and its version, and applying, updating or removing a bundle changes nothing outside that block.
- **A bundled skill loads like any other**: once installed, a bundle's skill is offered to the sessions that carry skills, on either engine, and never to the feature-planning session (docs/intent/agent.md#Skills).
- **The person's own skill wins a name clash**: where a bundle's skill carries the name of a skill in the workspace or the profile that no bundle installed, the person's own is the one that loads and the bundled one is named as not applied.
- **Bundled skills are told apart from hand-written ones**: a skill a bundle installed is marked with its source, bundle name and version wherever skills are listed, so what the organization supplies is distinct from what the workspace wrote itself.
- **Managed at any time**: the person can see which bundles are available and which are applied, apply one and remove one, without waiting for a suggestion.

## Where bundles come from
A bundle is fetched from a git repository, the product's own or a company's.
- **The product's catalog is a source without being configured**: the product's own bundle repository is always among the sources and is an ordinary git source, so a bundle is contributed by a pull request against it.
- **Further sources are git repositories named in settings**: more sources are named as git repository URLs in the person's settings and in the workspace's, the workspace's adding to the person's rather than replacing them.
- **Fetched with the git access the person already has**: a source is read with the person's existing git credentials, so a company's private repository needs no sign-in of its own.
- **A source is accepted before it is fetched**: a source the person has not accepted before is not fetched until they accept it, named by its repository.
  - **Source that arrived with the workspace**: a source named by a workspace the person just cloned is put to them in that workspace like any other new source.
- **A source may require bundles**: a source repository can name bundles as required, and those are applied for the project the first time that source is used in a workspace.
  - **A required bundle comes back**: a required bundle whose block has been removed is applied again, with a line naming the source that requires it.
  - **Required bundle held by another source**: a source may require a bundle that another source holds, the product's own catalog among them, and that bundle is resolved when the source is used rather than when its list is written.
- **Unreachable source falls back to the last fetch**: when a source cannot be reached its bundles are offered from the copy last fetched, said to be as of that fetch, and a source never fetched offers nothing.

## Keeping bundles current
A source holds a newer version, requires a bundle, or cannot be reached.
- **Updates are never silent**: when a source holds a newer version of an applied bundle the change is put to the person, and the answer is remembered for that bundle — later versions arrive with a notice, or this version is kept and not raised again until the person asks.
  - **Block changed by hand**: when the block of an applied bundle has been edited by hand, that is said before an update replaces it.
- **Required bundles carry skills too**: a bundle a source names as required is applied for the project the first time that source is used in a workspace, skills included, and its skills are installed again once they have been deleted.
- **An update replaces a bundle's skills whole**: accepting a newer version of a bundle replaces the skills it installed, dropping the files the new version no longer carries, and touches no skill the bundle did not install.
  - **Skill changed by hand**: when a file of a bundled skill has been edited since it was installed, that is said before an update replaces it, and the edit leaves the bundle's scope as it was, so a bundle applied for the person stays the person's in every workspace they open.
- **Removing a bundle takes its skills with it**: removing a bundle removes the skills it installed and leaves everything else in place.
- **Unreachable source keeps what is installed**: installed skills go on loading while their source cannot be reached, and a failed fetch never removes or disables one.

## Open questions
- **Committed location for project skills**: project-scope skills have to sit where the team commits them, but the workspace's `.kiwi/` folder is the one the product advises putting in `.gitignore` (docs/settings.md#Logs) — so which folder holds a project-scope bundle's skills: the committed `.claude/skills`, a committed skills folder of our own, or `.kiwi/skills` with the advice narrowed to the generated parts?
- **Categories of bundle**: a bundle's metadata differs by what the bundle is for, testing, cleanup, verification or code quality, so does a bundle declare a category that settles which metadata it must carry, and is a category something a source may invent or only the product?
- **Composing the applied bundles**: when two applied bundles claim the same ground, the same test surface, or opposite answers to one question of code organization, is that refused outright, shown to the person to resolve, or left to the session to notice?
- **Who composes**: the agent reads a bundle's metadata, but the composed result, which bundle owns which surface, is either worked out by the extension before a session starts or by the session itself from the bundles it carries.
