import type { SessionEvent } from '../../agent/session/code-session'
import { renderMarkdown } from './markdown'
import { agentTag, copyButton } from './transcript-blocks'

type AssistantBubble = { element: HTMLElement; text: HTMLElement; thinking: HTMLElement; streamed: string; finalParts: string[] }

type Insert = (element: HTMLElement, parentToolUseId?: string) => void

/** The assistant's messages of a transcript, patched as their text streams in. */
export class AssistantBubbles {
  private readonly bubbles = new Map<string, AssistantBubble>()

  constructor(
    private readonly insert: Insert,
    private readonly agentLabel: (parentToolUseId: string) => string,
  ) {}

  clear(): void {
    this.bubbles.clear()
  }

  /** Streamed text is rendered once at the end of a replay, not per delta. */
  renderStreamed(): void {
    for (const bubble of this.bubbles.values()) {
      if (bubble.finalParts.length === 0) renderMarkdown(bubble.streamed, bubble.text, true)
    }
  }

  appendText(event: Extract<SessionEvent, { type: 'assistant_text' }>, live: boolean): void {
    const bubble = this.bubble(event.messageId, event.parentToolUseId)
    bubble.streamed += event.delta
    if (live && bubble.finalParts.length === 0) renderMarkdown(bubble.streamed, bubble.text, false)
  }

  appendThinking(event: Extract<SessionEvent, { type: 'assistant_thinking' }>): void {
    const bubble = this.bubble(event.messageId, event.parentToolUseId)
    bubble.thinking.hidden = false
    bubble.thinking.textContent += event.delta
  }

  finish(event: Extract<SessionEvent, { type: 'assistant_message' }>): void {
    const bubble = this.bubble(event.messageId, event.parentToolUseId)
    bubble.finalParts.push(event.text)
    renderMarkdown(bubble.finalParts.join(''), bubble.text, true)
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
    const bubble: AssistantBubble = { element, text, thinking, streamed: '', finalParts: [] }
    element.append(thinking, text, copyButton(() => bubble.finalParts.join('') || bubble.streamed))
    if (parentToolUseId) {
      element.classList.add('from-subagent')
      element.prepend(agentTag(this.agentLabel(parentToolUseId)))
    }
    this.insert(element, parentToolUseId)
    this.bubbles.set(messageId, bubble)
    return bubble
  }
}
