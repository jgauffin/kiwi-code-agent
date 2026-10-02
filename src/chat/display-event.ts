import type { SessionEvent } from '../agent/session/code-session'

/**
 * The event as the chat may see it. Text the extension wrote for the model
 * stays in the extension host: a kickoff is shown by its label, a tool
 * result without the context only the model reads. Done here rather than in
 * the webview, whose messages anyone can inspect.
 */
export function forDisplay(event: SessionEvent): SessionEvent {
  if (event.type === 'user_message' && event.label) return { type: 'user_message', text: '', label: event.label }
  if (event.type === 'tool_result' && event.context !== undefined) {
    const { context: _context, ...shown } = event
    return shown
  }
  return event
}
