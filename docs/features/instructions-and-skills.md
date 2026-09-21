# Instructions and skills

Instruction files and skills in Claude Code's layout, at the user level and in the workspace, so the same rules and skills serve both engines and every workspace on the machine.

## Instruction files

The own-loop engine appends every one of these that exists to its system prompt, one section per file headed by the file's path, global first and workspace last:

1. `~/.claude/CLAUDE.md`
2. `~/.claude/AGENTS.md`
3. `~/.codex/AGENTS.md`
4. `~/AGENTS.md`
5. `<workspace>/CLAUDE.md`
6. `<workspace>/AGENTS.md`

A profile's `systemPromptFile` comes after them. A blank file adds nothing.

The Claude engine reads `<workspace>/CLAUDE.md` itself, through its project settings.

## Skills

A skill is a folder holding `SKILL.md` with `name` and `description` in its frontmatter and the instructions below. Roots, later wins on a shared name:

1. `~/.claude/skills`
2. `~/.agent/skills`
3. `<workspace>/.claude/skills`
4. `<workspace>/.agent/skills`

`.agent/skills` is ours; `.claude/skills` is Claude Code's, so one skill serves both engines. On the own loop the index (name and description) rides in the `Skill` tool's description, the model loads a skill itself when a task matches, and the tool returns the body with the skill's folder for relative paths. Skills are indexed when a session starts; one added later shows up on the next session.

Not included: the Claude engine's user-level settings, instruction files and skills (its `settingSources` stay `project` and `local`); phase sessions on the own loop (plan, implement, reconcile, cleanup carry their own prompts without the instruction files); a `/` listing of skills in the composer.
