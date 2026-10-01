import { existsSync } from 'node:fs'
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve, sep } from 'node:path'
import type { PostToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import { readOptional } from '../workspace-files'

export type MemoryScope = 'project' | 'user'

/** A scope holds at most this many notes; a write past it drops the oldest. */
export const MEMORY_CAP = 50

const INDEX_FILE = 'MEMORY.md'
const MEMORIES_HEADING = /^##\s+Memories\s*$/
const MEMORY_BULLET = /^-\s+\*\*(.+?)\*\*:\s*(.*)$/

/** Claude Code's own name for a checkout: its path with every separator turned into a dash. */
function sanitizedWorkspace(cwd: string): string {
  return cwd
    .split('')
    .map((ch) => (ch === '/' || ch === '\\' || ch === ':' ? '-' : ch))
    .join('')
}

/**
 * Project notes sit beside Claude Code's own per-project memory, under the
 * person's home directory rather than the checkout, so they never land in a
 * commit and a plain Claude Code session on this project finds the same folder.
 */
export function projectMemoryDir(cwd: string, home: string = homedir()): string {
  return join(home, '.claude', 'projects', sanitizedWorkspace(cwd), 'memory')
}

/**
 * User notes fold into the person's own instructions file instead of a folder
 * of their own: it is the one file Claude Code already reads on every project,
 * on both engines, so a memory that should follow the person everywhere has
 * nowhere else to earn that for free.
 */
export function userMemoryFile(home: string = homedir()): string {
  return join(home, '.claude', 'CLAUDE.md')
}

export type MemoryEntry = { title: string; file: string; summary: string }
export type DroppedNote = { title: string; file: string }

/** The note's title: its `# Heading`, or the file name read back as words when a note has none. */
function titleOf(body: string, fileName: string): string {
  const heading = /^#\s+(.+)$/m.exec(body)
  if (heading) return heading[1]!.trim()
  return fileName.replace(/\.md$/, '').replace(/[-_]+/g, ' ').trim()
}

/** The note's one-line summary: its first non-empty line after the title. */
function summaryOf(body: string): string {
  const lines = body.split(/\r?\n/).map((l) => l.trim())
  const afterHeading = /^#\s+/.test(lines[0] ?? '') ? lines.slice(1) : lines
  return afterHeading.find((l) => l.length > 0) ?? ''
}

/**
 * Notes are the source of truth for a project's memory: the index is always
 * rebuilt from the note files on disk, oldest first by when a note was last
 * written, so a note rewritten under the same name moves to the front and the
 * scope's cap is enforced by dropping whichever note has sat longest untouched.
 */
export async function rebuildProjectIndex(dir: string): Promise<{ entries: MemoryEntry[]; dropped: DroppedNote[] }> {
  if (!existsSync(dir)) return { entries: [], dropped: [] }
  const names = (await readdir(dir)).filter((f) => f.endsWith('.md') && f !== INDEX_FILE)
  const notes = await Promise.all(
    names.map(async (name) => ({ name, mtime: (await stat(join(dir, name))).mtimeMs, body: await readFile(join(dir, name), 'utf8') })),
  )
  notes.sort((a, b) => a.mtime - b.mtime)
  const dropped: DroppedNote[] = []
  while (notes.length > MEMORY_CAP) {
    const oldest = notes.shift()!
    dropped.push({ title: titleOf(oldest.body, oldest.name), file: oldest.name })
    await rm(join(dir, oldest.name))
  }
  const entries = notes.map(({ name, body }) => ({ title: titleOf(body, name), file: name, summary: summaryOf(body) }))
  const index = entries.map((e) => `- [${e.title}](${e.file}) \u2014 ${e.summary}`).join('\n')
  await writeFile(join(dir, INDEX_FILE), entries.length ? index + '\n' : '', 'utf8')
  return { entries, dropped }
}

/** Where the `## Memories` section of a user-memory file sits: its heading line and the line after its last bullet. */
function memoriesSection(lines: string[]): { start: number; end: number } | undefined {
  const start = lines.findIndex((l) => MEMORIES_HEADING.test(l.trim()))
  if (start === -1) return undefined
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!.trim())) {
      end = i
      break
    }
  }
  return { start, end }
}

/**
 * Keeps the person's `## Memories` section to the same rules as a project's
 * notes: a title written again replaces the earlier bullet of that title
 * rather than sitting beside it, and the section holds at most fifty bullets,
 * the oldest dropped past that. A file with no such section is left alone.
 */
export function enforceUserMemoryCap(text: string): { text: string; dropped: string[]; changed: boolean } {
  const lines = text.split(/\r?\n/)
  const section = memoriesSection(lines)
  if (!section) return { text, dropped: [], changed: false }
  const { start, end } = section
  const bulletLines = lines.slice(start + 1, end).filter((l) => MEMORY_BULLET.test(l.trim()))
  const titleOfLine = (l: string): string => MEMORY_BULLET.exec(l.trim())![1]!
  const lastIndex = new Map<string, number>()
  bulletLines.forEach((l, i) => lastIndex.set(titleOfLine(l), i))
  const deduped = bulletLines.filter((l, i) => lastIndex.get(titleOfLine(l)) === i)
  const dropped: string[] = []
  while (deduped.length > MEMORY_CAP) dropped.push(titleOfLine(deduped.shift()!))
  if (dropped.length === 0 && deduped.length === bulletLines.length) return { text, dropped: [], changed: false }
  const rebuilt = [lines[start]!, '', ...deduped, '']
  return { text: [...lines.slice(0, start), ...rebuilt, ...lines.slice(end)].join('\n'), dropped, changed: true }
}

/**
 * The person's whole `## Memories` section, exactly as it reads in their
 * instructions file. A user-scope memory is that one bullet line and nothing
 * more, so there is no separate body to read later: the section is already
 * the complete index.
 */
export function userMemorySection(text: string): string | undefined {
  const lines = text.split(/\r?\n/)
  const section = memoriesSection(lines)
  if (!section) return undefined
  const body = lines.slice(section.start, section.end)
  if (!body.some((l) => MEMORY_BULLET.test(l.trim()))) return undefined
  return body.join('\n').trim()
}

/** The title a bullet write names, read from the tool's own text rather than re-reading the file, since the hook runs right after the write. */
function writtenBulletTitle(tool: ToolUse): string | undefined {
  const input = (typeof tool.input === 'object' && tool.input !== null ? tool.input : {}) as Record<string, unknown>
  const text = typeof input['new_string'] === 'string' ? input['new_string'] : typeof input['content'] === 'string' ? input['content'] : ''
  for (const line of text.split(/\r?\n/)) {
    const m = MEMORY_BULLET.exec(line.trim())
    if (m) return m[1]
  }
  return undefined
}

function chatLine(scope: MemoryScope, title: string, dropped: string[]): string {
  const lines = [`Tell the person, as a line of your reply: "Noted for ${scope}: ${title}."`]
  if (dropped.length > 0) {
    const names = dropped.map((d) => `"${d}"`).join(', ')
    const plural = dropped.length > 1
    lines.push(`A scope keeps at most fifty notes; the oldest ${plural ? 'notes' : 'note'} (${names}) ${plural ? 'were' : 'was'} dropped to make room \u2014 say that too.`)
  }
  return lines.join(' ')
}

/**
 * After a memory is written, rebuilds the project's index or caps the user's
 * Memories section, and hands the model the exact line to tell the person, so
 * every write reaches the chat the same way.
 */
export class MemoryContract implements SessionHooks {
  constructor(
    private readonly cwd: string,
    private readonly home: string = homedir(),
  ) {}

  async postToolUse(tool: ToolUse & { output: string; isError: boolean }): Promise<PostToolUseOutcome> {
    if (tool.isError || (tool.toolName !== 'Write' && tool.toolName !== 'Edit')) return undefined
    const input = (typeof tool.input === 'object' && tool.input !== null ? tool.input : {}) as Record<string, unknown>
    const raw = input['file_path']
    if (typeof raw !== 'string') return undefined
    const path = isAbsolute(raw) ? raw : resolve(this.cwd, raw)

    const dir = projectMemoryDir(this.cwd, this.home)
    if (path.startsWith(dir + sep)) {
      const name = basename(path)
      if (name === INDEX_FILE) return undefined
      const { entries, dropped } = await rebuildProjectIndex(dir)
      const written = entries.find((e) => e.file === name)
      const title = written?.title ?? titleOf((await readOptional(path)) ?? '', name)
      return { additionalContext: chatLine('project', title, dropped.map((d) => d.title)) }
    }

    if (path === userMemoryFile(this.home)) {
      const text = await readOptional(path)
      if (text === undefined) return undefined
      const { text: capped, dropped, changed } = enforceUserMemoryCap(text)
      if (changed) await writeFile(path, capped, 'utf8')
      const title = writtenBulletTitle(tool)
      if (!title && dropped.length === 0) return undefined
      return { additionalContext: chatLine('user', title ?? 'the change above', dropped) }
    }
    return undefined
  }
}

/** What to tell the model about writing memories, in one place so both engines read the same words. */
export function memoryWritingInstructions(cwd: string, home: string = homedir()): string {
  const dir = projectMemoryDir(cwd, home)
  const file = userMemoryFile(home)
  return [
    'When the person corrects you, or states something that holds beyond the task in hand, write it down as a memory so the next session already knows it; a value you just worked out or the file you are about to edit is a single-use fact, not a memory.',
    `A memory is one short note, a few lines, named by what it is about. One about this codebase or how it is run belongs to the project: write \`${join(dir, '<title-as-a-slug>.md')}\`, starting with "# Title" then the note \u2014 its index is rebuilt for you from the notes that exist, so only the note file itself needs writing. One about how the person wants to be worked with, across every project, belongs to them: add or replace a "- **Title**: note" line under a "## Memories" heading in \`${file}\` (add the heading yourself if it is missing). When the person names the scope, use that one, not your own guess. Writing a note or a bullet under a title already used replaces the old one instead of sitting beside it; a scope keeps at most fifty.`,
    'Say so in the chat as one line naming the memory and its scope, so the person can have it taken back in the same turn.',
    'A memory is about working here, not about the product: something that says what the product does belongs with the unfiled decisions instead, not here. A note the whole team should follow, not just you working here, is offered as a docs change instead.',
  ].join('\n')
}
