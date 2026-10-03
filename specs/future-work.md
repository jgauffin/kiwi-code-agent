# Future work

### Session tabs open in the right sidebar
- decided: A session's tab opens in the right sidebar instead of the editor group a file would open in, so starting a session never displaces the code the person is reading; which VS Code surface carries it is settled when this is implemented. Tabs today open in the active editor group.
- affects: sessions and tabs, starting a new session

### A bundle may carry skills as well as rule text
- decided: A bundle declares whether it carries rule text, skills or both, and a bundle carrying skills travels the same sources, accepting, matching, versioning and required lists as a rule-text bundle; a bundled skill arrives with the files it refers to, is marked with its source, bundle and version, loses a name clash to a skill nobody's bundle installed, and nothing in a bundle runs when it is applied. Bundles still carry no commands, permission rules, settings or MCP servers.
- affects: organization bundles, agents md rule bundles, instructions and skills, docs/settings.md, docs/intent/agent.md

### Choosing a test strategy for a workspace
- decided: The agent works out a test strategy for a workspace in five steps, since a bundle carries no logic of its own and cannot do this: it detects the stack, the test frameworks installed and where specs live and proposes a profile; the person confirms it; the confirmed profile becomes a seam that assigns every test surface in the vocabulary to one test type and one bundle or marks it deliberately unowned, refusing a surface two applied bundles both claim; one spec at a time is then allocated, each rule to its owning type; and a test that names a rule it does not own fails. The seam is saved beside the workspace's own files and named from its rules, so the spec stays what the person wrote.
- affects: bundles, cleanup phase, finishing the build

### A spec written from a doc about existing code can reach implemented without a build
- decided: When a feature is migrated out of the docs as behaviour the code already has and the check against the code reports no disagreement, the spec is marked implemented with no tasks and no test proofs, and its rules are not flagged for missing them; only the disagreements the check reports become build work.
- affects: doc migration, cleanup phase, docs/intent/agent.md
