import type { SessionEvent } from '../../agent/session/code-session'
import { editDiffView, fileLink } from './edit-diff'
import { formatUsage } from './format-usage'
import { renderMarkdown } from './markdown'
import { PermissionCard } from './permission-card'

type AssistantBubble = { element: HTMLElement; text: HTMLElement; thinking: HTMLElement; streamed: string; finalParts: string[] }

/**
 * The conversation as an append-only stream. Events patch the DOM directly:
 * streamed text lands in the bubble it belongs to, tool results attach to
 * their call, permission cards resolve in place. `reset()` replays history.
 */
export class ChatTranscript extends HTMLElement {
  private readonly bubbles = new Map<string, AssistantBubble>()
  private readonly tools = new Map<string, HTMLDetailsElement>()
  private readonly permissions = new Map<string, PermissionCard>()
  private statusLine!: HTMLElement
  private busy = false
  private working: { element: HTMLElement; stop: () => void } | undefined

  connectedCallback(): void {
    if (this.childElementCount === 0) {
      this.statusLine = document.createElement('p')
      this.statusLine.className = 'status'
      this.appendChild(this.statusLine)
    }
  }

  reset(events: SessionEvent[]): void {
    this.replaceChildren(this.statusLine)
    this.bubbles.clear()
    this.tools.clear()
    this.permissions.clear()
    this.working?.stop()
    this.working = undefined
    this.busy = false
    this.setStatus('')
    for (const event of events) this.apply(event, false)
    // Streamed text is rendered once at the end of a replay, not per delta.
    for (const bubble of this.bubbles.values()) {
      if (bubble.finalParts.length === 0) renderMarkdown(bubble.streamed, bubble.text, true)
    }
    this.showWorking()
    this.scrollToEnd()
  }

  apply(event: SessionEvent, live = true): void {
    switch (event.type) {
      case 'session_started':
        this.setStatus(`${event.model} · Claude Code ${event.engineVersion ?? ''}`.trim())
        break
      case 'user_message':
        this.insert(block('user', event.text))
        this.busy = true
        break
      case 'assistant_text': {
        const bubble = this.bubble(event.messageId, event.parentToolUseId)
        bubble.streamed += event.delta
        if (live && bubble.finalParts.length === 0) renderMarkdown(bubble.streamed, bubble.text, false)
        break
      }
      case 'assistant_thinking': {
        const bubble = this.bubble(event.messageId, event.parentToolUseId)
        bubble.thinking.hidden = false
        bubble.thinking.textContent += event.delta
        break
      }
      case 'assistant_message': {
        const bubble = this.bubble(event.messageId, event.parentToolUseId)
        bubble.finalParts.push(event.text)
        renderMarkdown(bubble.finalParts.join(''), bubble.text, true)
        break
      }
      case 'tool_call':
        this.insert(this.toolCall(event), event.parentToolUseId)
        break
      case 'tool_result': {
        const details = this.tools.get(event.toolUseId)
        const result = document.createElement('pre')
        result.className = event.isError ? 'result error' : 'result'
        result.textContent = event.text
        if (details) {
          if (event.edit) showEdit(details, event.edit)
          details.appendChild(result)
          details.classList.toggle('failed', event.isError)
        } else {
          this.insert(result, event.parentToolUseId)
        }
        break
      }
      case 'permission_request': {
        const card = new PermissionCard()
        card.className = 'permission'
        this.insert(card)
        card.show(event)
        this.permissions.set(event.requestId, card)
        // The card is the indicator now; a ticking clock would say the model is at work.
        this.busy = false
        break
      }
      case 'permission_resolved':
        this.permissions.get(event.requestId)?.resolve(event.decision)
        this.busy = true
        break
      case 'status':
        // 'idle' also arrives mid-turn (after compaction, between requests); only the turn's end clears busy.
        if (event.status !== 'idle') this.busy = true
        break
      case 'turn_done': {
        this.busy = false
        const line = document.createElement('p')
        line.className = event.isError ? 'turn error' : 'turn'
        const usage = event.usage
        const parts = []
        if (usage) parts.push(formatUsage(usage))
        if (usage?.costUsd) parts.push(`$${usage.costUsd.toFixed(4)}`)
        if (event.durationMs) parts.push(`${(event.durationMs / 1000).toFixed(1)}s`)
        if (event.errors.length) parts.push(event.errors.join('; '))
        line.textContent = parts.join(' · ')
        this.insert(line)
        break
      }
      case 'error':
        this.insert(block(event.fatal ? 'error fatal' : 'error', event.message))
        if (event.fatal) this.busy = false
        break
      case 'ended':
        this.busy = false
        this.insert(block('ended', 'Engine stopped. The next prompt resumes the conversation.'))
        break
    }
    if (live) {
      this.showWorking()
      this.scrollToEnd()
    }
  }

  /** A pulsing "Working…" row with elapsed time, kept last, while the model is at work. */
  private showWorking(): void {
    if (!this.busy) {
      this.working?.stop()
      this.working?.element.remove()
      this.working = undefined
      return
    }
    if (!this.working) {
      const row = document.createElement('p')
      row.className = 'working'
      row.textContent = 'Working…'
      const startedAt = Date.now()
      const timer = window.setInterval(() => {
        row.textContent = `Working… ${Math.round((Date.now() - startedAt) / 1000)}s`
      }, 1000)
      this.working = { element: row, stop: () => window.clearInterval(timer) }
    }
    this.appendChild(this.working.element)
  }

  private bubble(messageId: string, parentToolUseId: string | undefined): AssistantBubble {
    const existing = this.bubbles.get(messageId)
    if (existing) return existing
    const element = document.createElement('article')
    element.className = 'assistant'
    const thinking = document.createElement('pre')
    thinking.className = 'thinking'
    thinking.hidden = true
    const text = document.createElement('div')
    text.className = 'text'
    element.append(thinking, text)
    this.insert(element, parentToolUseId)
    const bubble = { element, text, thinking, streamed: '', finalParts: [] }
    this.bubbles.set(messageId, bubble)
    return bubble
  }

  private toolCall(event: Extract<SessionEvent, { type: 'tool_call' }>): HTMLDetailsElement {
    const details = document.createElement('details')
    details.className = 'tool'
    const summary = document.createElement('summary')
    summary.textContent = `${event.name} ${summarizeInput(event.input)}`
    const input = document.createElement('pre')
    input.className = 'input'
    input.textContent = JSON.stringify(event.input, null, 2)
    details.append(summary, input)
    this.tools.set(event.toolUseId, details)
    return details
  }

  /** Subagent output nests under the tool call that spawned it. */
  private insert(element: HTMLElement, parentToolUseId?: string): void {
    const parent = parentToolUseId ? this.tools.get(parentToolUseId) : undefined
    ;(parent ?? this).appendChild(element)
  }

  private setStatus(text: string): void {
    this.statusLine.textContent = text
    this.statusLine.hidden = text === ''
  }

  private scrollToEnd(): void {
    this.scrollTop = this.scrollHeight
  }
}

/**
 * An edit step shows what it did, open, where every other step shows only its
 * name: the edit is the session's output, not its plumbing, and the diff is
 * capped so it cannot swallow the transcript. The arguments it was called with
 * say nothing the diff does not, so they give way to it.
 */
function showEdit(details: HTMLDetailsElement, change: Parameters<typeof editDiffView>[0]): void {
  details.classList.add('edit-step')
  details.open = true
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

function block(className: string, text: string): HTMLElement {
  const element = document.createElement('article')
  element.className = className
  element.textContent = text
  return element
}

function summarizeInput(input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const record = input as Record<string, unknown>
  const key = ['command', 'file_path', 'pattern', 'path', 'query', 'description'].find((k) => typeof record[k] === 'string')
  if (!key) return ''
  const value = record[key] as string
  return value.length > 80 ? value.slice(0, 77) + '...' : value
}

customElements.define('chat-transcript', ChatTranscript)
