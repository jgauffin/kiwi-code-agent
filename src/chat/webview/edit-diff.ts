import type { FileEditChange } from '../../agent/session/code-session'
import { omittedNotice } from '../../agent/edits/file-edit-diff'
import { fillCode, languageForPath } from './highlight'
import { post } from './vscode-api'

/**
 * A file edit as the chat shows it: the diff the host captured, already capped,
 * with the way into the editor for the rest of it. The edit is what the session
 * produced, so it is shown without asking — but never more than the cap allows.
 */
export function editDiffView(change: FileEditChange): HTMLElement {
  const box = document.createElement('div')
  box.className = 'edit'
  if (change.summary !== undefined) {
    // Nothing to diff: a sentence says more than an empty diff block, and there is nothing to open.
    box.append(line('p', 'edit-summary', change.summary))
    return box
  }
  const lang = languageForPath(change.path)
  for (const diff of change.diffs) box.append(diffBlock(diff, lang))
  if (change.omitted > 0) box.append(omission(change))
  return box
}

/** The edited file's path, clickable: it opens the file where the change landed. */
export function fileLink(change: FileEditChange): HTMLElement {
  const link = document.createElement('button')
  link.type = 'button'
  link.className = 'link file'
  link.textContent = change.label
  link.title = `Open ${change.label}${change.line ? ` at line ${change.line}` : ''}`
  link.addEventListener('click', (event) => {
    event.preventDefault()
    post({ type: 'open_file', path: change.path, ...(change.line ? { line: change.line } : {}) })
  })
  return link
}

/** What the cap left out, and where the whole edit can be read. */
function omission(change: FileEditChange): HTMLElement {
  const text = omittedNotice(change.omitted)
  if (change.snapshot === undefined) return line('p', 'omitted', text)
  const paragraph = line('p', 'omitted')
  const link = document.createElement('button')
  link.type = 'button'
  link.className = 'link'
  link.textContent = text
  link.title = 'Open the pre-edit content against the file as it is now.'
  link.addEventListener('click', () => {
    post({ type: 'open_edit_diff', snapshot: change.snapshot!, path: change.path, label: change.label })
  })
  paragraph.append(link)
  return paragraph
}

/**
 * Code lines are colored one at a time in the file's language, so the +/-
 * mark stays outside the tokens; a construct spanning lines (a block comment)
 * may color imperfectly, which the diff editor is there for.
 */
function diffBlock(diff: string, lang: string | undefined): HTMLElement {
  const block = document.createElement('pre')
  block.className = 'diff'
  for (const text of diff.split('\n')) {
    const kind = kindOf(text)
    const row = line('span', `diff-line ${kind}`)
    if (kind === 'hunk') {
      row.textContent = text
    } else {
      const code = line('span', 'code')
      fillCode(code, text.slice(1), lang)
      row.append(text.slice(0, 1), code)
    }
    block.append(row)
  }
  return block
}

function kindOf(text: string): string {
  if (text.startsWith('@@')) return 'hunk'
  if (text.startsWith('+')) return 'add'
  if (text.startsWith('-')) return 'del'
  return 'ctx'
}

function line(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
