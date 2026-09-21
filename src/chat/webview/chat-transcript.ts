import type { SessionEvent } from '../../agent/session/code-session'
import { isShellTool } from '../../agent/permissions/permission-rules'
import { splitShellCommand } from '../../agent/permissions/shell-split'
import { renderAnsi } from './ansi'
import { editDiffView, fileLink } from './edit-diff'
import { formatUsage } from './format-usage'
import { fillCode } from './highlight'
import { renderMarkdown } from './markdown'
import { PermissionCard } from './permission-card'
import { isQuestionTool, QuestionCard } from './question-card'

type AssistantBubble = { element: HTMLElement; text: HTMLElement; thinking: HTMLElement; streamed: string; finalParts: string[] }

const WAITING_ON_MODEL = 'Waiting on model'

/**
 * The conversation as an append-only stream. Events patch the DOM directly:
 * streamed text lands in the bubble it belongs to, tool results attach to
 * their call, permission cards resolve in place. `reset()` replays history.
 */
export class ChatTranscript extends HTMLElement {
  private readonly bubbles = new Map<string, AssistantBubble>()
  private readonly tools = new Map<string, HTMLDetailsElement>()
  private readonly permissions = new Map<string, PermissionCard>()
  private readonly questions = new Map<string, QuestionCard>()
  /** Tool calls of the question tool: the card says what they ask, so their own rows say nothing. */
  private readonly questionCalls = new Set<string>()
  private statusLine!: HTMLElement
  /** Tool calls still without a result, by id, each named as its row is. */
  private readonly pendingTools = new Map<string, string>()
  /** What the session is doing right now; nothing when it waits on the user or is idle. */
  private activity: string | undefined
  private working: { element: HTMLElement; label: string; startedAt: number; stop: () => void } | undefined

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
    this.questions.clear()
    this.questionCalls.clear()
    this.pendingTools.clear()
    this.working?.stop()
    this.working = undefined
    this.activity = undefined
    this.setStatus('')
    for (const event of events) this.apply(event, false)
    // Streamed text is rendered once at the end of a replay, not per delta.
    for (const bubble of this.bubbles.values()) {
      if (bubble.finalParts.length === 0) renderMarkdown(bubble.streamed, bubble.text, true)
    }
    this.showWorking()
    this.scrollToEnd()
  }

  /** A question card still waiting on the user. */
  get hasOpenQuestion(): boolean {
    return [...this.questions.values()].some((card) => !card.isResolved)
  }

  apply(event: SessionEvent, live = true): void {
    switch (event.type) {
      case 'session_started':
        this.setStatus(`${event.model} · Claude Code ${event.engineVersion ?? ''}`.trim())
        break
      case 'user_message':
        // A test-run handoff quotes the command's output, colours and all.
        this.insert(block('user', event.text, renderAnsi))
        this.activity = WAITING_ON_MODEL
        break
      case 'assistant_text': {
        const bubble = this.bubble(event.messageId, event.parentToolUseId)
        bubble.streamed += event.delta
        if (live && bubble.finalParts.length === 0) renderMarkdown(bubble.streamed, bubble.text, false)
        this.activity = 'Writing'
        break
      }
      case 'assistant_thinking': {
        const bubble = this.bubble(event.messageId, event.parentToolUseId)
        bubble.thinking.hidden = false
        bubble.thinking.textContent += event.delta
        this.activity = 'Thinking'
        break
      }
      case 'assistant_message': {
        const bubble = this.bubble(event.messageId, event.parentToolUseId)
        bubble.finalParts.push(event.text)
        renderMarkdown(bubble.finalParts.join(''), bubble.text, true)
        // The tool calls the message carries, if any, follow right after and take over.
        this.activity = WAITING_ON_MODEL
        break
      }
      case 'tool_call': {
        // The question is put as a card, so its call and its result are not shown as a tool step.
        if (isQuestionTool(event.name)) {
          this.questionCalls.add(event.toolUseId)
          break
        }
        const details = this.toolCall(event)
        this.insert(details, event.parentToolUseId)
        this.pendingTools.set(event.toolUseId, `Running ${details.querySelector('summary')?.textContent ?? event.name}`)
        this.activity = this.pendingActivity()
        break
      }
      case 'tool_result': {
        if (this.questionCalls.has(event.toolUseId)) break
        this.pendingTools.delete(event.toolUseId)
        this.activity = this.pendingActivity()
        const details = this.tools.get(event.toolUseId)
        const result = document.createElement('pre')
        result.className = event.isError ? 'result error' : 'result'
        renderAnsi(event.text, result)
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
        this.activity = undefined
        break
      }
      case 'permission_resolved':
        this.permissions.get(event.requestId)?.resolve(event.decision)
        this.activity = this.pendingActivity()
        break
      case 'question_request': {
        const card = new QuestionCard()
        card.className = 'question-card'
        this.insert(card)
        card.show(event)
        this.questions.set(event.requestId, card)
        // The card is waiting on the user, not the model; a ticking clock would say otherwise.
        this.activity = undefined
        break
      }
      case 'question_resolved':
        this.questions.get(event.requestId)?.resolve(event.outcome)
        this.activity = this.pendingActivity()
        break
      case 'status':
        // 'idle' also arrives mid-turn (after compaction, between requests); only the turn's end clears the activity.
        if (event.status === 'requesting') this.activity = WAITING_ON_MODEL
        if (event.status === 'compacting') this.activity = 'Compacting context'
        break
      case 'turn_done': {
        this.activity = undefined
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
        if (event.fatal) this.activity = undefined
        break
      case 'ended':
        this.activity = undefined
        this.insert(block('ended', 'Engine stopped. The next prompt resumes the conversation.'))
        break
    }
    if (live) {
      this.showWorking()
      this.scrollToEnd()
    }
  }

  /** The newest tool call still running, or the model's turn once every call has its result. */
  private pendingActivity(): string {
    return [...this.pendingTools.values()].at(-1) ?? WAITING_ON_MODEL
  }

  /** A pulsing row naming the current activity, with the time spent in it, kept last while the session is at work. */
  private showWorking(): void {
    if (!this.activity) {
      this.working?.stop()
      this.working?.element.remove()
      this.working = undefined
      return
    }
    if (!this.working) {
      const row = document.createElement('p')
      row.className = 'working'
      const working = { element: row, label: '', startedAt: 0, stop: () => window.clearInterval(timer) }
      const timer = window.setInterval(() => {
        row.textContent = `${working.label}… ${Math.round((Date.now() - working.startedAt) / 1000)}s`
      }, 1000)
      this.working = working
    }
    if (this.working.label !== this.activity) {
      this.working.label = this.activity
      this.working.startedAt = Date.now()
      this.working.element.textContent = `${this.activity}…`
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
    const input = document.createElement('pre')
    input.className = 'input'
    const shell = isShellTool(event.name) ? shellCall(event.input) : undefined
    if (shell) {
      // A shell step is named by what it is for; its body is the commands it runs, one per line.
      summary.textContent = shell.description ?? summarizeInput(event.input)
      fillCode(input, shell.lines.join('\n'), 'bash')
    } else {
      summary.textContent = `${event.name} ${summarizeInput(event.input)}`
      fillCode(input, JSON.stringify(event.input, null, 2), 'json')
    }
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

function block(className: string, text: string, render: (text: string, into: HTMLElement) => void = plainText): HTMLElement {
  const element = document.createElement('article')
  element.className = className
  render(text, element)
  return element
}

function plainText(text: string, into: HTMLElement): void {
  into.textContent = text
}

/** A shell call's description and its commands, one per line; nothing when the input holds no command. */
function shellCall(input: unknown): { description?: string; lines: string[] } | undefined {
  const record = (input ?? {}) as Record<string, unknown>
  if (typeof record['command'] !== 'string') return undefined
  const description = typeof record['description'] === 'string' && record['description'].trim() ? record['description'] : undefined
  const lines = splitShellCommand(record['command']).segments.map((s) => s.text)
  return { ...(description ? { description } : {}), lines: lines.length ? lines : [record['command']] }
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
