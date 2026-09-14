import type { FileEditChange } from '../../agent/session/code-session'
import { omittedNotice } from '../../agent/edits/file-edit-diff'
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
  for (const diff of change.diffs) box.append(diffBlock(diff))
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

function diffBlock(diff: string): HTMLElement {
  const block = document.createElement('pre')
  block.className = 'diff'
  for (const text of diff.split('\n')) block.append(line('span', `diff-line ${kindOf(text)}`, text))
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
