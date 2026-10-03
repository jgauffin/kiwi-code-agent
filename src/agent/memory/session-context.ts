import { homedir } from 'node:os'
import { join } from 'node:path'
import { readOptional } from '../workspace-files'
import { projectMemoryDir } from './memories'

/**
 * Memories as a session start uses them: every session but the blind feature
 * planner begins with the project's notes already in hand, the index only, a
 * note's body read on demand when the work touches it. Read fresh from disk;
 * a memory is a handful of short files, never worth a generated-context build
 * like the repo map or the docs map. The person's own notes live inside their
 * instruction file instead of a folder of their own, so they ride along
 * wherever instruction files join a prompt rather than being read here.
 */

/**
 * The modes that work in the intent and read what a planner reads: the blind planner, the filing of decisions,
 * the docs cleanup and the docs map build. A memory is about the codebase and how it is run, so they stay as
 * blind to the notes as to the code they describe.
 */
const BLIND_MODES: ReadonlySet<string> = new Set(['plan', 'file-decisions', 'doc-migration', 'docs-map'])

/** The modes that start with memories: every mode that works in the code. */
export const wantsMemories = (mode: string): boolean => !BLIND_MODES.has(mode)

export type MemorySources = { project: string | undefined }

/** The project's index (`MEMORY.md`), left out when there is nothing in it. */
export async function readMemorySources(cwd: string, home: string = homedir()): Promise<MemorySources> {
  const index = await readOptional(join(projectMemoryDir(cwd, home), 'MEMORY.md'))
  return { project: index?.trim() || undefined }
}

/** The project's notes as they go into a system prompt: one line each, a note's body read with Read when the work at hand touches it. */
export function memorySection(sources: MemorySources): string | undefined {
  if (!sources.project) return undefined
  return [
    '## What is already known',
    '',
    "Notes kept from earlier sessions. Open a note's file with Read when the work at hand touches it. A memory written this session is said in the chat as it happens, not repeated here.",
    '',
    'Project notes:',
    '',
    sources.project,
  ].join('\n')
}

/**
 * The system prompt a session of this mode starts with, the project's memory
 * index appended when the mode wants it. For the blind planner the prompt is
 * returned untouched and nothing is read.
 */
export async function withMemories(mode: string, systemPrompt: string, cwd: string, home: string = homedir()): Promise<string> {
  if (!wantsMemories(mode)) return systemPrompt
  const section = memorySection(await readMemorySources(cwd, home))
  return section ? `${systemPrompt}\n\n${section}` : systemPrompt
}

/**
 * The project's notes, for the Claude engine's own default chat prompt: its
 * own CLAUDE.md loading leaves out the project index (not a setting source)
 * and its auto-memory tool is off, so it reaches the prompt no other way. The
 * person's own notes live inside their instruction file and reach this chat
 * the same way they reach every other mode's, through the instruction files
 * joined alongside this section (see `session-engines.ts`).
 */
export async function chatMemorySection(cwd: string, home: string = homedir()): Promise<string | undefined> {
  return memorySection(await readMemorySources(cwd, home))
}
