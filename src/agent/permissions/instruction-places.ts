import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectMemoryDir, sanitizedWorkspace } from '../memory/memories'
import { skillRoots } from '../skills/skill-index'
import { subAgentRoots } from '../sub-agents/sub-agent-index'

/**
 * Where a session's own instructions live outside the project: skills and the
 * files they refer to, sub agent definitions, memory notes and the person's
 * instruction files. A session already works under what is written there, so
 * reading it is reading its own rules and is never put to the person; writing
 * there is a write like any other and is answered the usual way.
 *
 * `shipped` names what the extension keeps for itself: the skills it ships and
 * the folder it mirrors them into for the Claude engine.
 */
export function instructionPlaces(cwd: string, shipped: readonly string[] = [], home: string = homedir()): string[] {
  return [
    ...skillRoots(cwd, home),
    ...subAgentRoots(cwd, home),
    projectMemoryDir(cwd, home),
    join(home, 'AGENTS.md'),
    join(home, 'CLAUDE.md'),
    join(home, '.claude', 'CLAUDE.md'),
    ...shipped,
  ]
}

/**
 * Where the Claude engine writes the output of this workspace's background
 * commands. The session is told to read it there, so a read is never asked;
 * other workspaces' output and the rest of the temp folder stay asked.
 */
export function engineOutputPlace(cwd: string, temp: string = tmpdir()): string {
  return join(temp, 'claude', sanitizedWorkspace(cwd))
}
