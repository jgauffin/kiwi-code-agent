import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import type { SessionEvent } from '../session/code-session'
import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import { applyEdits, editedPath, isDiffable, isFileEdit } from './edit-tools'
import { fileEditChange, type FileEditChange } from './file-edit-diff'

/** Beyond this a file is not shown as a diff; the step is reported in summary form. */
const MAX_TEXT_BYTES = 1_000_000

/** Calls kept waiting for their result; an interrupted turn must not pile up file contents. */
const MAX_OPEN_CALLS = 50

type Capture = {
  /** The tool use the capture belongs to; also names its snapshot file. */
  id: string
  toolName: string
  input: unknown
  /** Absolute path of the file. */
  path: string
  label: string
  /** Content as the call found it; absent when it could not be read as text. */
  before?: string
  /** Why there is no text to diff. */
  unreadable?: string
  /** Where `before` was written, once something asked for it. */
  snapshot?: string
}

export type FileEditRecorderOptions = {
  /** The workspace the session runs in; paths are shown relative to it. */
  cwd: string
  /** The session's own run directory, where pre-edit snapshots are kept. */
  runDir: string
}

/**
 * Captures what a file looked like when an edit call started, and turns that
 * into the diff the chat shows — on the permission card for a proposed change
 * and on the step once the edit has run.
 *
 * The content comes from the host reading the file, never from the engine, so
 * every engine shows the same diff and an auto-approved edit gets one too.
 * The full pre-edit content is kept as a snapshot under the run directory; the
 * event carries only the capped diff, so the transcript stays small.
 */
export class FileEditRecorder implements SessionHooks {
  private readonly captures = new Map<string, Capture>()

  constructor(private readonly options: FileEditRecorderOptions) {}

  /** Every file edit is captured here, before the call runs and before any prompt. */
  async preToolUse(tool: ToolUse): Promise<PreToolUseOutcome> {
    if (!isFileEdit(tool.toolName)) return undefined
    const raw = editedPath(tool.input)
    if (!raw) return undefined
    const path = isAbsolute(raw) ? raw : resolve(this.options.cwd, raw)
    const read = await this.readText(path)
    this.remember(tool.toolUseId, {
      toolName: tool.toolName,
      input: tool.input,
      path,
      label: this.labelFor(path),
      ...(isDiffable(tool.toolName) ? read : { unreadable: 'notebook cell edited' }),
    })
    return undefined
  }

  /**
   * The diff rides on the step it belongs to: the permission card shows the
   * change it is asking about, the result shows the change it made. Anything
   * else passes through untouched.
   */
  async decorate(event: SessionEvent): Promise<SessionEvent> {
    if (event.type === 'permission_request') {
      const change = await this.proposed(event.requestId)
      return change ? { ...event, edit: change } : event
    }
    if (event.type !== 'tool_result') return event
    const capture = this.captures.get(event.toolUseId)
    if (!capture) return event
    this.captures.delete(event.toolUseId)
    // Nothing changed, so there is nothing to show: the step's own outcome says it.
    if (event.isError) return event
    const change = await this.made(capture)
    return { ...event, edit: change }
  }

  /** The change the call would make, worked out from the captured content and what it asks for. */
  private async proposed(toolUseId: string): Promise<FileEditChange | undefined> {
    const capture = this.captures.get(toolUseId)
    if (!capture) return undefined
    if (capture.before === undefined) return this.summary(capture)
    const states = applyEdits(capture.before, capture.toolName, capture.input)
    // What the call would do cannot be worked out; the raw arguments say more than a wrong diff.
    if (!states) return undefined
    return this.change(capture, states)
  }

  /** The change the call made: captured content against the file as it now stands. */
  private async made(capture: Capture): Promise<FileEditChange> {
    if (capture.before === undefined) return this.summary(capture)
    const after = await this.readText(capture.path)
    if (after.before === undefined) return this.summary(capture, after.unreadable)
    const predicted = applyEdits(capture.before, capture.toolName, capture.input)
    // Several edits in one step are several diffs, each against the file as it
    // stood before that edit — but only when they add up to what is on disk.
    const states = predicted && predicted[predicted.length - 1] === after.before ? predicted : [capture.before, after.before]
    return this.change(capture, states)
  }

  private async change(capture: Capture, states: string[]): Promise<FileEditChange> {
    const snapshot = await this.snapshot(capture)
    return fileEditChange({
      path: capture.path,
      label: capture.label,
      states,
      ...(snapshot !== undefined ? { snapshot } : {}),
    })
  }

  private summary(capture: Capture, unreadable?: string): FileEditChange {
    return fileEditChange({ path: capture.path, label: capture.label, unreadable: unreadable ?? capture.unreadable ?? 'changed' })
  }

  /** The pre-edit content, written under the run directory once something links to it. */
  private async snapshot(capture: Capture): Promise<string | undefined> {
    if (capture.snapshot) return capture.snapshot
    if (capture.before === undefined) return undefined
    const dir = join(this.options.runDir, 'edits')
    const name = `${safeName(capture.id)}${basename(capture.path)}`
    const path = join(dir, name)
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(path, capture.before, 'utf8')
    } catch {
      // A snapshot that cannot be written costs the link, not the diff.
      return undefined
    }
    capture.snapshot = path
    return path
  }

  private remember(toolUseId: string, capture: Omit<Capture, 'id'>): void {
    if (this.captures.size >= MAX_OPEN_CALLS) {
      const oldest = this.captures.keys().next()
      if (!oldest.done) this.captures.delete(oldest.value)
    }
    this.captures.set(toolUseId, { ...capture, id: toolUseId })
  }

  private labelFor(path: string): string {
    const rel = relative(this.options.cwd, path).split('\\').join('/')
    return rel && !rel.startsWith('..') ? rel : path
  }

  /** The file as text, or why it is not: a missing file is a new one, and reads as empty. */
  private async readText(path: string): Promise<{ before?: string; unreadable?: string }> {
    let size: number
    try {
      size = (await stat(path)).size
    } catch {
      return { before: '' }
    }
    if (size > MAX_TEXT_BYTES) return { unreadable: 'file too large to diff' }
    try {
      const text = await readFile(path, 'utf8')
      if (text.includes('\u0000')) return { unreadable: 'binary file' }
      return { before: text }
    } catch {
      return { unreadable: 'file could not be read as text' }
    }
  }
}

function safeName(toolUseId: string): string {
  const cleaned = toolUseId.replace(/[^A-Za-z0-9._-]/g, '_').slice(-40)
  return cleaned ? `${cleaned}-` : ''
}
