import { readFile, writeFile } from 'node:fs/promises'

export type SpecStatus = 'draft' | 'approved'

/** `body` is the markdown after the front matter, what a reader should see. */
export type SpecState = { exists: false } | { exists: true; status: SpecStatus; body: string }

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/

/**
 * The spec's front-matter `status` is the approval gate: phase 2 refuses a
 * draft, and a human sets `approved`. Held in the file so it survives
 * reloads and is visible in git.
 */
export async function readSpecState(path: string): Promise<SpecState> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false }
    throw error
  }
  return { exists: true, status: statusOf(text), body: bodyOf(text) }
}

export function bodyOf(text: string): string {
  return text.replace(FRONT_MATTER, '').replace(/^\s+/, '')
}

export function statusOf(text: string): SpecStatus {
  const match = FRONT_MATTER.exec(text)
  const line = match?.[1]?.split(/\r?\n/).find((l) => /^status:/.test(l))
  return line?.slice('status:'.length).trim() === 'approved' ? 'approved' : 'draft'
}

export async function setSpecStatus(path: string, status: SpecStatus): Promise<void> {
  const text = await readFile(path, 'utf8')
  await writeFile(path, withStatus(text, status), 'utf8')
}

export function withStatus(text: string, status: SpecStatus): string {
  const match = FRONT_MATTER.exec(text)
  if (!match) return `---\nstatus: ${status}\n---\n\n${text}`
  const body = match[1]!
  const lines = body.split(/\r?\n/)
  const index = lines.findIndex((l) => /^status:/.test(l))
  if (index === -1) lines.push(`status: ${status}`)
  else lines[index] = `status: ${status}`
  return text.replace(FRONT_MATTER, `---\n${lines.join('\n')}\n---${match[2]}`)
}
