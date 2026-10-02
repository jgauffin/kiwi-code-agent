import { deflateRawSync, inflateRawSync } from 'node:zlib'
import type { SessionEvent } from '../session/code-session'

const PREFIX = 'kp1:'

/**
 * Text the extension wrote, kept unreadable at rest: not a secret from anyone
 * determined, only out of reach of a glance or a grep through the run log.
 */
export function seal(text: string): string {
  return PREFIX + deflateRawSync(Buffer.from(text, 'utf8')).toString('base64')
}

/** The sealed text back; text that was never sealed (a log written before sealing) passes as it is. */
export function unseal(text: string): string {
  if (!text.startsWith(PREFIX)) return text
  return inflateRawSync(Buffer.from(text.slice(PREFIX.length), 'base64')).toString('utf8')
}

/** The event as the run log stores it: a kickoff's text and a tool result's context sealed. */
export function sealEvent(event: SessionEvent): SessionEvent {
  if (event.type === 'user_message' && event.label) return { ...event, text: seal(event.text) }
  if (event.type === 'tool_result' && event.context) return { ...event, context: seal(event.context) }
  return event
}

export function unsealEvent(event: SessionEvent): SessionEvent {
  if (event.type === 'user_message' && event.label) return { ...event, text: unseal(event.text) }
  if (event.type === 'tool_result' && event.context) return { ...event, context: unseal(event.context) }
  return event
}
