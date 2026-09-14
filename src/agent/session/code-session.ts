import type { ModelProfile } from './model-profile'

/** Token accounting for one assistant turn, as far as the engine reports it. */
export type TurnUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd?: number
}

/** What an engine is told about one call. Remembering a decision is the host's business, not the engine's. */
export type PermissionDecision = { kind: 'allow' } | { kind: 'deny'; message?: string }

/**
 * What a session emits. One shape for every engine so the UI, the run log and
 * later the phase orchestration never see wire formats.
 *
 * `parentToolUseId` is set on events produced inside a subagent.
 */
export type SessionEvent =
  | { type: 'session_started'; engineSessionId: string; model: string; engineVersion?: string }
  | { type: 'user_message'; text: string }
  | { type: 'assistant_text'; messageId: string; delta: string; parentToolUseId?: string }
  | { type: 'assistant_thinking'; messageId: string; delta: string; parentToolUseId?: string }
  /** Final text of an assistant message, replaces whatever was streamed under the same id. */
  | { type: 'assistant_message'; messageId: string; text: string; parentToolUseId?: string }
  | { type: 'tool_call'; toolUseId: string; name: string; input: unknown; parentToolUseId?: string }
  | { type: 'tool_result'; toolUseId: string; text: string; isError: boolean; parentToolUseId?: string }
  | {
      type: 'permission_request'
      requestId: string
      toolName: string
      input: unknown
      title?: string
      description?: string
    }
  | { type: 'permission_resolved'; requestId: string; decision: PermissionDecision['kind'] }
  | { type: 'status'; status: 'requesting' | 'compacting' | 'verifying' | 'idle' }
  | { type: 'verification_started'; command: string; cwd: string }
  | { type: 'verification'; command: string; cwd: string; ok: boolean; output: string }
  | { type: 'turn_done'; usage?: TurnUsage; durationMs?: number; isError: boolean; errors: string[] }
  | { type: 'error'; message: string; fatal: boolean }
  | { type: 'ended' }

export type SessionEventType = SessionEvent['type']

/**
 * A coding session on one engine. Session-centric on purpose: the extension
 * sends prompts and reacts to events; how the engine talks to its model is
 * the engine's business.
 */
export interface CodeSession {
  readonly id: string
  readonly profile: ModelProfile
  /** Queue a user turn. Returns immediately. */
  send(text: string): void
  /** Single consumer. Ends after the `ended` event. */
  events(): AsyncIterable<SessionEvent>
  respondToPermission(requestId: string, decision: PermissionDecision): void
  /** Stop the current turn; the session stays usable. */
  interrupt(): Promise<void>
  /** Terminate the engine and release resources. */
  dispose(): Promise<void>
}
