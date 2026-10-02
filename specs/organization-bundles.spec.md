---
feature: Organization bundles
status: verified
---

# Organization bundles

## Goal
A company has practices it wants every team to work by, and today only part of that travels: rule bundles already carry rule text from the company's own git repository into the workspace's or the person's `AGENTS.md`, but a skill — a worked procedure with the templates and scripts it needs — reaches a teammate only by hand. Organization bundles make a bundle able to carry skills beside rule text, from the same sources, with the same accepting, versioning and required lists. A company publishes its best practices as bundles in a repository, names that repository in the workspace's settings and names there what its teams must carry; a teammate who clones the project gets the skills with it, and the organization's way of working arrives with the source rather than by word of mouth.

## What a bundle carries
A bundle is no longer rule text alone.
- **Skills as a bundle payload**: a bundle declares what it carries — rule text, skills, or both — and one that carries skills is fetched, matched, offered, accepted and versioned exactly as a rule-text bundle is (specs/agents-md-rule-bundles.spec.md#Where bundles come from).
  - **Skills-only bundle**: A bundle that carries no rule text writes nothing into `AGENTS.md`, and what it is shows only in the skills it installed.
- **Rule text and skills only**: a bundle contributes rule text and skills and nothing more — no commands, tools, permission rules, settings or MCP servers — and anything else it carries is ignored (specs/agents-md-rule-bundles.spec.md#Where bundles come from).
- **The skill's whole folder travels**: a bundled skill arrives with its description and the files it refers to by relative path, so a skill that ships a template or a script is complete where it lands.
  - **Nothing in a bundle runs when it is applied**: applying a bundle only writes files, and a script a skill carries runs only when a session chooses to run it, answered by the permission rules like any other command.
- **Skills seen before they are applied**: the name and description of every skill a bundle would add are shown before that bundle is applied for the first time, beside the rule text it would add, and nothing is written without the person accepting it (specs/agents-md-rule-bundles.spec.md#Picking up bundles for a workspace).

## Sharing the organization's skills with the team
The company's bundles reach a workspace and the people working in it.
- **Project scope puts the skills in the source**: a bundle applied for the project installs its skills in the workspace among the files the team commits, so a teammate who clones the repository has them without applying anything.
- **Person scope installs into the profile**: a bundle applied for the person installs its skills under their own profile, where they reach every workspace they open (specs/agents-md-rule-bundles.spec.md#Picking up bundles for a workspace).
- **A bundled skill loads like any other**: once installed, a bundle's skill is offered to the sessions that carry skills, on either engine, and never to the feature-planning session (docs/intent/agent.md#Skills).
- **The person's own skill wins a name clash**: where a bundle's skill carries the name of a skill in the workspace or the profile that no bundle installed, the person's own is the one that loads and the bundled one is named as not applied.
- **Bundled skills are told apart from hand-written ones**: a skill a bundle installed is marked with its source, bundle name and version wherever skills are listed, so what the organization supplies is distinct from what the workspace wrote itself.

## Keeping the organization's skills current
A source holds a newer version, requires a bundle, or cannot be reached.
- **Required bundles carry skills too**: a bundle a source names as required is applied for the project the first time that source is used in a workspace, skills included, and its skills are installed again once they have been deleted (specs/agents-md-rule-bundles.spec.md#Where bundles come from).
- **An update replaces a bundle's skills whole**: accepting a newer version of a bundle replaces the skills it installed, dropping the files the new version no longer carries, and touches no skill the bundle did not install (specs/agents-md-rule-bundles.spec.md#Where bundles come from).
  - **Skill changed by hand**: when a file of a bundled skill has been edited since it was installed, that is said before an update replaces it, and the edit leaves the bundle's scope as it was, so a bundle applied for the person stays the person's in every workspace they open.
- **Removing a bundle takes its skills with it**: removing a bundle removes the skills it installed and leaves everything else in place.
- **Unreachable source keeps what is installed**: installed skills go on loading while their source cannot be reached, and a failed fetch never removes or disables one.

## Open questions
- **Committed location for project skills**: project-scope skills have to sit where the team commits them, but the workspace's `.kiwi/` folder is the one the product advises putting in `.gitignore` (docs/settings.md#Logs) — so which folder holds a project-scope bundle's skills: the committed `.claude/skills`, a committed skills folder of our own, or `.kiwi/skills` with the advice narrowed to the generated parts?
