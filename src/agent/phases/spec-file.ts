import { readFile, writeFile } from 'node:fs/promises'

/** `implemented` is written by the extension once the feature is verified, so the stage outlives the working files. */
export type SpecStatus = 'draft' | 'approved' | 'implemented'

/** `body` is the markdown after the front matter, what a reader should see. `built` is `true` for a spec migrated from a doc about behaviour the code already has, deciding what a clean check against the code means for it. */
export type SpecState = { exists: false } | { exists: true; status: SpecStatus; body: string; built: boolean }

export const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/

/** The value of one front-matter line, `key: value`; undefined without front matter or the key. */
export function frontMatterValue(text: string, key: string): string | undefined {
  const match = FRONT_MATTER.exec(text)
  const line = match?.[1]?.split(/\r?\n/).find((l) => l.startsWith(`${key}:`))
  const value = line?.slice(key.length + 1).trim()
  return value || undefined
}

/** Sets one front-matter line, adding the front matter when the text has none. */
export function withFrontMatterValue(text: string, key: string, value: string): string {
  const match = FRONT_MATTER.exec(text)
  if (!match) return `---\n${key}: ${value}\n---\n\n${text}`
  const lines = match[1]!.split(/\r?\n/)
  const index = lines.findIndex((l) => l.startsWith(`${key}:`))
  if (index === -1) lines.push(`${key}: ${value}`)
  else lines[index] = `${key}: ${value}`
  return text.replace(FRONT_MATTER, `---\n${lines.join('\n')}\n---${match[2]}`)
}

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
  return { exists: true, status: statusOf(text), body: bodyOf(text), built: builtOf(text) }
}

export function bodyOf(text: string): string {
  return text.replace(FRONT_MATTER, '').replace(/^\s+/, '')
}

export function statusOf(text: string): SpecStatus {
  const value = frontMatterValue(text, 'status')
  return value === 'approved' || value === 'implemented' ? value : 'draft'
}

/** Whether the migration that wrote this spec marked it as behaviour the code already has, `built: true` in the front matter. */
export function builtOf(text: string): boolean {
  return frontMatterValue(text, 'built') === 'true'
}

export async function setSpecStatus(path: string, status: SpecStatus): Promise<void> {
  const text = await readFile(path, 'utf8')
  await writeFile(path, withStatus(text, status), 'utf8')
}

export function withStatus(text: string, status: SpecStatus): string {
  return withFrontMatterValue(text, 'status', status)
}
