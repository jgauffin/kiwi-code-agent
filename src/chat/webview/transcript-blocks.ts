import type { SessionEvent } from '../../agent/session/code-session'
import { editDiffView, fileLink } from './edit-diff'
import { BackgroundStopRequestedEvent, ReturnCancelRequestedEvent } from './events'
import { compact, formatUsage } from './format-usage'
import { post } from './vscode-api'
import { renderMarkdown } from './markdown'

/**
 * An edit step shows what it did, where every other step shows only its name:
 * the edit is the session's output, not its plumbing, and the diff is capped so
 * it cannot swallow the transcript. It opens for an edit the user has not read
 * yet. The arguments it was called with say nothing the diff does not, so they
 * give way to it.
 */
export function showEdit(details: HTMLDetailsElement, change: Parameters<typeof editDiffView>[0], open: boolean): void {
  details.classList.add('edit-step')
  details.open = open
  const summary = details.querySelector('summary')
  if (summary) {
    const name = summary.textContent?.split(' ')[0] ?? ''
    summary.replaceChildren(document.createTextNode(`${name} `), fileLink(change))
    if (change.added !== undefined || change.removed !== undefined) {
      const stats = document.createElement('span')
      stats.className = 'stats'
      stats.textContent = ` +${change.added ?? 0} −${change.removed ?? 0}`
      summary.appendChild(stats)
    }
  }
  const input = details.querySelector('pre.input')
  if (input instanceof HTMLElement) input.hidden = true
  details.appendChild(editDiffView(change))
}

/** Where the conversation was folded, with the summary to hand for anyone who wants to see what was kept. */
export function compactionMarker(event: Extract<SessionEvent, { type: 'compacted' }>): HTMLElement {
  const sizes =
    event.preTokens === undefined
      ? ''
      : ` · ${compact(event.preTokens)}${event.postTokens === undefined ? ' before' : ` → ${compact(event.postTokens)}`}`
  if (!event.summary) return block('turn compaction', `Context compacted${sizes}`)
  const details = document.createElement('details')
  details.className = 'turn compaction'
  const summary = document.createElement('summary')
  summary.textContent = `Context compacted${sizes}`
  details.append(summary, block('compaction-summary', event.summary))
  return details
}

/** The line closing a turn: what it used, what it cost, how long it took, and why it failed. */
export function turnLine(event: Extract<SessionEvent, { type: 'turn_done' }>): HTMLElement {
  const line = document.createElement('p')
  line.className = event.isError ? 'turn error' : 'turn'
  const usage = event.usage
  const parts = []
  if (usage) parts.push(formatUsage(usage))
  if (usage?.costUsd) parts.push(`$${usage.costUsd.toFixed(4)}`)
  if (event.durationMs) parts.push(`${(event.durationMs / 1000).toFixed(1)}s`)
  if (event.errors.length) parts.push(event.errors.join('; '))
  line.textContent = parts.join(' · ')
  return line
}

/** Where the session switched to another model, so a reader can place which model produced what follows (B13). */
export function switchMarker(event: Extract<SessionEvent, { type: 'session_started' }>): HTMLElement {
  return block('turn model-switch', `Switched to ${event.model}`)
}

const COPY_ICONS =
  '<svg class="idle" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="5.5" y="1.5" width="9" height="9" rx="1.5"/><path d="M10.5 13.5A1.5 1.5 0 0 1 9 15H3a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 3 5.5"/></svg>' +
  '<svg class="done" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="m2.5 8.5 3.5 3.5 7.5-8"/></svg>'

/** Icon-only and without a space between its tags, so a message's own words stay the whole of its text. */
const COPY_BUTTON = document.createElement('template')
COPY_BUTTON.innerHTML = `<button type="button" class="copy" title="Copy as Markdown" aria-label="Copy as Markdown">${COPY_ICONS}</button>`

/** The Markdown the message was written in, not the HTML it was rendered to. The clipboard is the host's, so the text goes there to be written. */
export function copyButton(markdown: () => string): HTMLButtonElement {
  const button = COPY_BUTTON.content.firstElementChild!.cloneNode(true) as HTMLButtonElement
  let revert: number | undefined
  button.addEventListener('click', () => {
    post({ type: 'copy_text', text: markdown() })
    button.classList.add('copied')
    window.clearTimeout(revert)
    revert = window.setTimeout(() => button.classList.remove('copied'), 1500)
  })
  return button
}

/** A message one window's agent sent the other: where it went or came from, then its text rendered from the Markdown the agent wrote it in. */
export function agentMessage(event: Extract<SessionEvent, { type: 'agent_message' }>): HTMLElement {
  const element = document.createElement('article')
  element.className = `agent-message ${event.direction}`
  const from = document.createElement('header')
  from.className = 'from'
  from.textContent = `${event.direction === 'sent' ? 'To' : 'From'} the agent in ${event.workspace}`
  const text = document.createElement('div')
  text.className = 'text'
  renderMarkdown(event.text, text, true)
  element.append(copyButton(() => event.text), from, text)
  return element
}

type BackgroundCommandEvent = Extract<SessionEvent, { type: 'background_command' }>

/** How a background command stands, in words: running, or how it ended. */
export function backgroundState(event: BackgroundCommandEvent): string {
  switch (event.state) {
    case 'running':
      return 'running'
    case 'ended':
      return event.exitCode === 0 ? 'ended, exit code 0' : event.exitCode === null || event.exitCode === undefined ? 'could not be run' : `ended, exit code ${event.exitCode}`
    case 'stopped':
      return 'stopped'
    case 'cut':
      return 'stopped by the window reloading'
  }
}

/** The row of a background command: what it runs and is for, how it stands, where its output is, and a stop while it runs. */
export function fillBackgroundCommand(element: HTMLElement, event: BackgroundCommandEvent): void {
  element.className = `background-command ${event.state}`
  const line = document.createElement('p')
  line.className = 'background-line'
  line.textContent = `Background ${event.id}: ${event.command} · ${event.purpose} · ${backgroundState(event)} · output in ${event.outputFile}`
  element.replaceChildren(line)
  if (event.state !== 'running') return
  const stop = document.createElement('button')
  stop.type = 'button'
  stop.className = 'background-stop'
  stop.textContent = 'Stop'
  stop.addEventListener('click', () => stop.dispatchEvent(new BackgroundStopRequestedEvent(event.id)))
  element.appendChild(stop)
}

type ScheduledReturnEvent = Extract<SessionEvent, { type: 'scheduled_return' }>

/** The row of a scheduled return: when the session resumes and why, or how it ended up, with a cancel while it waits. */
export function fillScheduledReturn(element: HTMLElement, event: ScheduledReturnEvent): void {
  element.className = `scheduled-return ${event.state}`
  const line = document.createElement('p')
  line.className = 'background-line'
  const at = new Date(event.dueAt).toLocaleTimeString()
  const text = {
    scheduled: `Resuming at ${at}: ${event.reason}`,
    cancelled: `Scheduled return for ${at} cancelled: ${event.reason}`,
    due: `Resumed at ${at}: ${event.reason}`,
    missed: `Scheduled return for ${at} missed, the window was closed: ${event.reason}. Waiting for you.`,
  }[event.state]
  line.textContent = text
  element.replaceChildren(line)
  if (event.state !== 'scheduled') return
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = 'background-stop'
  cancel.textContent = 'Cancel'
  cancel.addEventListener('click', () => cancel.dispatchEvent(new ReturnCancelRequestedEvent()))
  element.appendChild(cancel)
}

export function block(className: string, text: string, render: (text: string, into: HTMLElement) => void = plainText): HTMLElement {
  const element = document.createElement('article')
  element.className = className
  render(text, element)
  return element
}

/** How many images a prompt carried, stated where its words are. */
export function imageNote(text: string): HTMLElement {
  const note = document.createElement('div')
  note.className = 'image-note'
  note.textContent = text
  return note
}

/** The pictures a prompt carried, small, for as long as the tab is open. */
export function thumbnails(images: { mediaType: string; data: string }[]): HTMLElement {
  const row = document.createElement('div')
  row.className = 'sent-images'
  for (const image of images) {
    const thumbnail = document.createElement('img')
    thumbnail.src = `data:${image.mediaType};base64,${image.data}`
    thumbnail.alt = 'Attached image'
    row.appendChild(thumbnail)
  }
  return row
}

function plainText(text: string, into: HTMLElement): void {
  into.textContent = text
}

/** Whose thread a step or a message belongs to, as a tag it carries ahead of its own text. */
export function agentTag(label: string): HTMLElement {
  const tag = document.createElement('span')
  tag.className = 'agent-name'
  tag.textContent = label
  return tag
}

/** What a delegation's row adds once it reports back: whether it answered in full, and what it spent. */
export function subAgentStatus(outcome: { status: 'complete' | 'partial'; toolCalls: number; tokens: number }): HTMLElement {
  const tag = document.createElement('span')
  tag.className = `sub-agent-status ${outcome.status}`
  const spend = `${outcome.toolCalls} call${outcome.toolCalls === 1 ? '' : 's'} · ${outcome.tokens} tokens`
  tag.textContent = outcome.status === 'partial' ? `partial · ${spend}` : spend
  return tag
}
