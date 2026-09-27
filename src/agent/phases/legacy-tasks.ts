import { readFile, rm, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { WORK_DIR, featureSlug } from './blind-plan'
import { bodyOf, frontMatterValue } from './spec-file'
import { readBoard, TASKS_SUFFIX, writeBoard, type CleanupDecision, type Proof, type Task, type TaskBoard, type TaskState, type VerificationRecord } from './tasks-file'

/**
 * The task board as it was kept before it became JSON: a markdown file whose
 * task state rode as markers on each line. Read here and nowhere else, to
 * convert a board once; nothing writes this shape any more.
 */

export const LEGACY_TASKS_SUFFIX = '.tasks.md'

export function legacyTasksPath(cwd: string, feature: string): string {
  return join(cwd, WORK_DIR, `${featureSlug(feature)}${LEGACY_TASKS_SUFFIX}`)
}

const VERIFICATION_SECTION = 'Verification'
const CLEANUP_DECISIONS: CleanupDecision[] = ['postponed', 'skipped', 'done']

/** `- **Name** (Rule a, Rule b): text`; the delivered rules ride between the name and the colon. */
const TASK = /^-\s+\*\*([^*]+?)\*\*\s*(?:\(([^)]*)\))?\s*:?\s*(.*)$/
const FILES = /^\s+-\s+files\s*:\s*(.*)$/i
const CONTEXT = /^\s+-\s+context\s*:\s*(.*)$/i
const PROVES = /^\s+-\s+proves\s*:\s*(.*)$/i
const NOTE = /^\s+-\s+note\s*:\s*(.*)$/i
/** `- how:` opens a block: the rest of its line, then every line indented deeper than it, until the next key, task or heading. */
const HOW = /^(\s+)-\s+how\s*:\s*(.*)$/i
/** `Rule name → test/file.ts test_name`; the arrow keeps a name with spaces apart from the path. */
const PROOF = /^(.+?)\s*(?:→|->)\s*(\S+)\s+(.+)$/
const HEADING = /^#{1,6}\s+(.*)$/
const GROUP = /^##\s+(.*)$/
const RECORD = /^-\s+(\S+)\s*:\s*(passed|failed)\b\s*,?\s*(.*)$/i
const REMOVED = /\[removed\]/i
const BLOCKED = /\[blocked\s*:?\s*([^\]]*)\]/i
const TESTED = /\[tested\]/i
const DONE = /\[done\]/i
const IN_PROGRESS = /\[in progress\]/i
const MARKERS = /\s*\[(?:in progress|done|tested|removed|blocked[^\]]*)\]/gi
const NEW = /\s*\(new\)\s*$/i

/** Blocked wins over any finish: a task marked tested and then blocked on a re-run is not finished. */
function stateOf(text: string): TaskState {
  if (BLOCKED.test(text)) return 'blocked'
  if (TESTED.test(text)) return 'tested'
  if (DONE.test(text)) return 'done'
  if (IN_PROGRESS.test(text)) return 'in_progress'
  return 'open'
}

const list = (text: string): string[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

/** `Cancel command → test/a.test.ts a_rule_holds`; an entry that does not parse is kept out, not guessed at. */
function proofs(text: string): Proof[] {
  return list(text).flatMap((entry) => {
    const match = PROOF.exec(entry)
    return match ? [{ item: match[1]!, file: match[2]!, test: match[3]!.trim() }] : []
  })
}

/** A `how:` block being read: the indent of its key line, and its body dedented to the first body line. */
type HowBlock = { indent: number; lines: string[]; dedent?: number }

/** A blank line or one indented deeper than the key belongs to the block; anything else ends it. */
function continues(how: HowBlock, line: string): boolean {
  if (line.trim() === '') {
    how.lines.push('')
    return true
  }
  const indent = line.length - line.trimStart().length
  if (indent <= how.indent) return false
  how.dedent ??= indent
  how.lines.push(line.slice(Math.min(how.dedent, indent)))
  return true
}

export function boardFromMarkdown(text: string): TaskBoard {
  const tasks: Task[] = []
  const verification: VerificationRecord[] = []
  let task: Task | undefined
  let group: string | undefined
  let inVerification = false
  let how: HowBlock | undefined
  for (const raw of bodyOf(text).split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (how && task) {
      if (continues(how, line)) continue
      task.how = how.lines.join('\n').trimEnd()
      how = undefined
    }
    const heading = HEADING.exec(line.trim())
    if (heading) {
      inVerification = heading[1]!.trim() === VERIFICATION_SECTION
      const section = GROUP.exec(line.trim())
      if (section && !inVerification) group = section[1]!.trim()
      task = undefined
      continue
    }
    if (inVerification) {
      const record = RECORD.exec(line.trim())
      if (record) verification.push({ at: record[1]!, ok: record[2]!.toLowerCase() === 'passed', text: record[3]!.trim() })
      continue
    }
    const files = FILES.exec(line)
    if (files && task) {
      const entries = list(files[1]!)
      task.files = entries.map((e) => e.replace(NEW, '').trim())
      task.newFiles = entries.filter((e) => NEW.test(e)).map((e) => e.replace(NEW, '').trim())
      continue
    }
    const context = CONTEXT.exec(line)
    if (context && task) {
      task.context = list(context[1]!)
      continue
    }
    const proves = PROVES.exec(line)
    if (proves && task) {
      task.proves = proofs(proves[1]!)
      continue
    }
    const note = NOTE.exec(line)
    if (note && task) {
      task.note = note[1]!.trim()
      continue
    }
    const opens = HOW.exec(line)
    if (opens && task) {
      how = { indent: opens[1]!.length, lines: opens[2]!.trim() ? [opens[2]!.trim()] : [] }
      continue
    }
    const match = TASK.exec(line.trim())
    if (!match) continue
    const body = match[3]!.trim()
    const state = stateOf(body)
    const reason = BLOCKED.exec(body)?.[1]?.trim()
    task = {
      name: match[1]!.trim().replace(/:$/, '').trim(),
      text: body.replace(MARKERS, '').trim(),
      delivers: list(match[2] ?? ''),
      ...(group !== undefined ? { group } : {}),
      files: [],
      newFiles: [],
      context: [],
      how: '',
      proves: [],
      note: '',
      built: '',
      state,
      ...(state === 'blocked' && reason ? { blockedReason: reason } : {}),
      removed: REMOVED.test(body),
    }
    tasks.push(task)
  }
  if (how && task) task.how = how.lines.join('\n').trimEnd()
  const spec = frontMatterValue(text, 'spec')
  const cleanup = CLEANUP_DECISIONS.find((d) => d === frontMatterValue(text, 'cleanup'))
  return { ...(spec !== undefined ? { spec } : {}), ...(cleanup !== undefined ? { cleanup } : {}), tasks, verification }
}

const ID = '[A-Z]{1,3}\\d+'
const ID_TASK = new RegExp(`^-\\s+(T\\d+)\\b\\s*(?:\\(([^)]*)\\))?\\s*:\\s*(.*)$`)
const PROVES_LINE = /^(\s+-\s+proves\s*:\s*)(.*)$/i
const ID_PROOF = new RegExp(`^(${ID})\\s+(?!→|->)(\\S+)\\s+(.+)$`)

/** `- T1 (B1): text` becomes `- **T1** (B1): text`; a proof `B1 file test` becomes `B1 → file test`. */
export function modernizeTasks(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const task = ID_TASK.exec(line.trimEnd())
      if (task) return `- **${task[1]}**${task[2] !== undefined ? ` (${task[2]})` : ''}: ${task[3]!.trim()}`
      const proves = PROVES_LINE.exec(line.trimEnd())
      if (!proves) return line
      const entries = proves[2]!.split(',').map((entry) => {
        const proof = ID_PROOF.exec(entry.trim())
        return proof ? `${proof[1]} → ${proof[2]} ${proof[3]}` : entry.trim()
      })
      return `${proves[1]}${entries.join(', ')}`
    })
    .join('\n')
}

/**
 * Converts a markdown board beside it into the JSON board and removes it.
 * The JSON board takes the markdown's modification time, so a conversion
 * does not restart the week the housekeeping waits. A JSON board already
 * there wins; the markdown is left for the housekeeping to clear with it.
 * Returns whether a board was converted.
 */
export async function convertLegacyBoard(markdownPath: string): Promise<boolean> {
  const target = markdownPath.slice(0, -LEGACY_TASKS_SUFFIX.length) + TASKS_SUFFIX
  let text: string
  try {
    text = await readFile(markdownPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  if (await readBoard(target)) return false
  const { atime, mtime } = await stat(markdownPath)
  await writeBoard(target, boardFromMarkdown(modernizeTasks(text)))
  await utimes(target, atime, mtime)
  await rm(markdownPath)
  return true
}
