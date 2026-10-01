import { homedir } from 'node:os'
import { join } from 'node:path'
import { readOptional } from '../workspace-files'
import { projectMemoryDir, userMemoryFile, userMemorySection } from './memories'

/**
 * Memories as a session start uses them: every session but the blind feature
 * planner begins with the project's and the person's notes already in hand,
 * the index only, a note's body read on demand when the work touches it.
 * Both scopes are read fresh from disk; a memory is a handful of short files,
 * never worth a generated-context build like the repo map or the docs map.
 */

/** The modes that start with memories: everything but the blind planner, which stays exactly as blind to them as to the rest of the project. */
export const wantsMemories = (mode: string): boolean => mode !== 'plan'

export type MemorySources = { project?: string; user?: string }

/** The project's index (`MEMORY.md`) and the person's whole `## Memories` section, each left out when there is nothing in it. */
export async function readMemorySources(cwd: string, home: string = homedir()): Promise<MemorySources> {
  const index = await readOptional(join(projectMemoryDir(cwd, home), 'MEMORY.md'))
  const userFile = await readOptional(userMemoryFile(home))
  return { project: index?.trim() || undefined, user: userFile ? userMemorySection(userFile) : undefined }
}

/** The notes as they go into a system prompt: one line each, a project note's body read with Read when the work at hand touches it. */
export function memorySection(sources: MemorySources): string | undefined {
  if (!sources.project && !sources.user) return undefined
  const lines = [
    '## What is already known',
    '',
    "Notes kept from earlier sessions. Open a project note's file with Read when the work at hand touches it; a person's own note is already the whole of it. A memory written this session is said in the chat as it happens, not repeated here.",
  ]
  if (sources.project) lines.push('', 'Project notes:', '', sources.project)
  if (sources.user) lines.push('', 'Your own notes, kept across every project:', '', sources.user)
  return lines.join('\n')
}

/**
 * The system prompt a session of this mode starts with, the memory index
 * appended when the mode wants it. For the blind planner the prompt is
 * returned untouched and nothing is read.
 */
export async function withMemories(mode: string, systemPrompt: string, cwd: string, home: string = homedir()): Promise<string> {
  if (!wantsMemories(mode)) return systemPrompt
  const section = memorySection(await readMemorySources(cwd, home))
  return section ? `${systemPrompt}\n\n${section}` : systemPrompt
}
