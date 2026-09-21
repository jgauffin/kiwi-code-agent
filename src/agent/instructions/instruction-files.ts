import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type InstructionFile = {
  /** Absolute path, named in the prompt so the model knows where a rule came from. */
  path: string
  text: string
}

/**
 * The instruction files the own loop reads, global first and workspace last
 * so the workspace's words sit nearest the task. CLAUDE.md is Claude Code's
 * name, AGENTS.md the cross-tool one; both levels take both.
 */
export function instructionFilePaths(cwd: string, home = homedir()): string[] {
  return [
    join(home, '.claude', 'CLAUDE.md'),
    join(home, '.claude', 'AGENTS.md'),
    join(home, '.codex', 'AGENTS.md'),
    join(home, 'AGENTS.md'),
    join(cwd, 'CLAUDE.md'),
    join(cwd, 'AGENTS.md'),
  ]
}

/** Every instruction file that exists and says something, in prompt order. */
export async function readInstructionFiles(cwd: string, home = homedir()): Promise<InstructionFile[]> {
  const files: InstructionFile[] = []
  for (const path of instructionFilePaths(cwd, home)) {
    const text = await readOptional(path)
    if (text?.trim()) files.push({ path, text })
  }
  return files
}

/** The file's text, or nothing when there is no such file. Any other failure propagates. */
export async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
