import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * System prompt for the own-loop engine. Short on purpose: judgment rules
 * belong here, checkable rules belong in the build. The workspace's
 * CLAUDE.md and any per-profile prompt file are appended so project
 * instructions apply to every engine alike.
 */
export async function buildSystemPrompt(cwd: string, profilePromptFile?: string): Promise<string> {
  const parts = [
    `You are a coding agent working in the directory ${cwd} on ${process.platform}.`,
    'Work through the tools: Read before Edit or Write, Grep and Glob to find things, Bash for builds, tests and git.',
    'Make the smallest change that does the job. Do not add abstractions, options or comments the task did not ask for.',
    'When a tool reports an error, read it and adjust; do not repeat the same call.',
    'When the task is done, say what changed in a few sentences. When something is unclear, ask instead of guessing.',
  ]
  const claudeMd = await readOptional(join(cwd, 'CLAUDE.md'))
  if (claudeMd) parts.push('\n# Project instructions\n\n' + claudeMd)
  if (profilePromptFile) {
    const extra = await readOptional(join(cwd, profilePromptFile))
    if (extra) parts.push('\n' + extra)
  }
  return parts.join('\n')
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
