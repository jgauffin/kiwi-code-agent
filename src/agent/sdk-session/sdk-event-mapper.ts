import type { SDKAssistantMessageError, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { SessionEvent, TurnUsage } from '../session/code-session'
import { bareToolName } from './tool-server'

/**
 * Turns the Agent SDK's message stream into SessionEvents.
 *
 * Stateful because streaming deltas do not carry the message id they belong
 * to; `message_start` does, and the mapper remembers it until the next one.
 *
 * User messages are not mapped: the host emits `user_message` when it sends,
 * and replays on resume are restored from the run log instead.
 */
export class SdkEventMapper {
  private currentMessageId = ''

  map(msg: SDKMessage): SessionEvent[] {
    switch (msg.type) {
      case 'system':
        return this.mapSystem(msg)
      case 'stream_event':
        return this.mapStreamEvent(msg)
      case 'assistant':
        return this.mapAssistant(msg)
      case 'user':
        return this.mapUser(msg)
      case 'result':
        return this.mapResult(msg)
      case 'auth_status':
        return msg.error ? [{ type: 'error', message: `Authentication: ${msg.error}`, fatal: false }] : []
      default:
        return []
    }
  }

  private mapSystem(msg: Extract<SDKMessage, { type: 'system' }>): SessionEvent[] {
    switch (msg.subtype) {
      case 'init':
        return [
          {
            type: 'session_started',
            engineSessionId: msg.session_id,
            model: msg.model,
            engineVersion: msg.claude_code_version,
          },
        ]
      case 'status': {
        const status: SessionEvent = { type: 'status', status: msg.status ?? 'idle' }
        if (msg.compact_result !== 'failed') return [status]
        return [{ type: 'error', message: `Compaction failed: ${msg.compact_error ?? 'no reason given'}`, fatal: false }, status]
      }
      case 'compact_boundary':
        return [
          {
            type: 'compacted',
            preTokens: msg.compact_metadata.pre_tokens,
            ...(msg.compact_metadata.post_tokens !== undefined ? { postTokens: msg.compact_metadata.post_tokens } : {}),
          },
          { type: 'status', status: 'idle' },
        ]
      default:
        return []
    }
  }

  private mapStreamEvent(msg: Extract<SDKMessage, { type: 'stream_event' }>): SessionEvent[] {
    const event = msg.event
    const parent = parentOf(msg.parent_tool_use_id)
    if (event.type === 'message_start') {
      this.currentMessageId = event.message.id
      return []
    }
    if (event.type !== 'content_block_delta') return []
    const messageId = this.currentMessageId
    if (event.delta.type === 'text_delta') {
      return [{ type: 'assistant_text', messageId, delta: event.delta.text, ...parent }]
    }
    if (event.delta.type === 'thinking_delta') {
      return [{ type: 'assistant_thinking', messageId, delta: event.delta.thinking, ...parent }]
    }
    return []
  }

  private mapAssistant(msg: Extract<SDKMessage, { type: 'assistant' }>): SessionEvent[] {
    const parent = parentOf(msg.parent_tool_use_id)
    const events: SessionEvent[] = []
    if (msg.error) {
      events.push({ type: 'error', message: ASSISTANT_ERRORS[msg.error] ?? `Assistant error: ${msg.error}`, fatal: false })
    }
    const textParts: string[] = []
    for (const block of msg.message.content) {
      if (block.type === 'text') {
        textParts.push(block.text)
      } else if (block.type === 'tool_use') {
        events.push({ type: 'tool_call', toolUseId: block.id, name: bareToolName(block.name), input: block.input, ...parent })
      }
    }
    if (textParts.length > 0) {
      events.push({ type: 'assistant_message', messageId: msg.message.id, text: textParts.join(''), ...parent })
    }
    return events
  }

  private mapUser(msg: Extract<SDKMessage, { type: 'user' }>): SessionEvent[] {
    if ('isReplay' in msg && msg.isReplay) return []
    const content = msg.message.content
    if (typeof content === 'string') return []
    const parent = parentOf(msg.parent_tool_use_id)
    const events: SessionEvent[] = []
    for (const block of content) {
      if (block.type !== 'tool_result') continue
      events.push({
        type: 'tool_result',
        toolUseId: block.tool_use_id,
        text: toolResultText(block.content),
        isError: block.is_error === true,
        ...parent,
      })
    }
    return events
  }

  private mapResult(msg: Extract<SDKMessage, { type: 'result' }>): SessionEvent[] {
    const usage: TurnUsage = {
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
      cacheReadTokens: msg.usage.cache_read_input_tokens,
      cacheWriteTokens: msg.usage.cache_creation_input_tokens,
      costUsd: msg.total_cost_usd,
    }
    const errors = msg.subtype === 'success' ? [] : msg.errors
    if (msg.subtype !== 'success' && errors.length === 0) errors.push(msg.subtype)
    return [{ type: 'turn_done', usage, durationMs: msg.duration_ms, isError: msg.is_error, errors }]
  }
}

/** The refusals a new user meets first, told as what to do about them rather than as a code. */
const ASSISTANT_ERRORS: Partial<Record<SDKAssistantMessageError, string>> = {
  authentication_failed:
    'Claude is not logged in. Add an Anthropic API key to the Claude provider in Kiwipow Agent settings (the gear icon), then start a new session.',
  billing_error: 'Anthropic refused the request for billing reasons: check the credit or plan of the account the Claude provider uses.',
}

function parentOf(parentToolUseId: string | null): { parentToolUseId?: string } {
  return parentToolUseId ? { parentToolUseId } : {}
}

/** The text of an MCP-shaped tool result: text parts joined, other parts named by kind. */
export function toolResultText(content: unknown): string {
  if (content === undefined || content === null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part === 'object' && part !== null && 'type' in part && part.type === 'text' && 'text' in part) {
          return String(part.text)
        }
        return `[${typeof part === 'object' && part !== null && 'type' in part ? String(part.type) : 'content'}]`
      })
      .join('\n')
  }
  return JSON.stringify(content)
}
