import type { ModelProfile } from './model-profile'
import type { FileEditChange } from '../edits/file-edit-diff'
import type { CommandLine, WriteScope } from '../permissions/permission-rules'
import type { QuestionOutcome, UserQuestionRequest } from './user-question'
import type { McpServers } from '../mcp/mcp-config'

export type { CommandLine, FileEditChange }

/** One MCP server as the engine last reported it. */
export type McpServerState = {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  error?: string
}

/** What the host may do to a session's MCP servers. Each call ends with a fresh `mcp_servers` event. */
export interface McpControl {
  /** The workspace's servers changed: this set replaces the one the session runs with. */
  reload(servers: McpServers): Promise<void>
  /** Try one server again; a failure shows up as its status, never as a throw. */
  reconnect(name: string): Promise<void>
}

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

/** The event that closes a prompt; a denial keeps the user's reason so the card can show it. */
export function permissionResolved(requestId: string, decision: PermissionDecision): Extract<SessionEvent, { type: 'permission_resolved' }> {
  return decision.kind === 'deny' && decision.message
    ? { type: 'permission_resolved', requestId, decision: 'deny', message: decision.message }
    : { type: 'permission_resolved', requestId, decision: decision.kind }
}

/**
 * What a session emits. One shape for every engine so the UI, the run log and
 * later the phase orchestration never see wire formats.
 *
 * `parentToolUseId` is set on events produced inside a subagent.
 */
export type SessionEvent =
  | { type: 'session_started'; engineSessionId: string; model: string; engineVersion?: string }
  /**
   * `label` is set when the extension wrote the text (a kickoff, a handoff): the chat
   * shows the label, and the text goes to the model and to the run log only, sealed.
   */
  | { type: 'user_message'; text: string; label?: string }
  | { type: 'assistant_text'; messageId: string; delta: string; parentToolUseId?: string }
  | { type: 'assistant_thinking'; messageId: string; delta: string; parentToolUseId?: string }
  /** Final text of an assistant message, replaces whatever was streamed under the same id. */
  | { type: 'assistant_message'; messageId: string; text: string; parentToolUseId?: string }
  /** What one model reply produced, thinking included; with the run log's timestamps it tells a long think from a slow provider. */
  | { type: 'reply_usage'; messageId: string; outputTokens: number; parentToolUseId?: string }
  /** `malformed` is set when the model's arguments were not JSON: `input` is then their text as written. */
  | { type: 'tool_call'; toolUseId: string; name: string; input: unknown; malformed?: true; parentToolUseId?: string }
  /**
   * `edit` is set on a file edit that changed something: the diff the step made, as the chat shows it.
   * `context` is what the model reads after `text` and the chat never shows: hook context, a skill's body.
   */
  | { type: 'tool_result'; toolUseId: string; text: string; isError: boolean; parentToolUseId?: string; edit?: FileEditChange; context?: string }
  | {
      type: 'permission_request'
      requestId: string
      /** The call being asked about, so the prompt and that call's own step are never shown as two things. */
      toolUseId?: string
      toolName: string
      input: unknown
      title?: string
      description?: string
      /** Why the engine asks about a call the rules may already let through, such as a write outside the workspace. */
      reason?: string
      /** The change the call proposes, shown in place of the raw arguments. */
      edit?: FileEditChange
      /** Several files' changes asked about as one: a script's whole run, applied or dropped together. */
      edits?: FileEditChange[]
      /** A shell call as its commands, each with what already lets it through or the rule that would; shown in place of the raw arguments. */
      commands?: CommandLine[]
      /** A write to one project file: how far, beyond this call, the answer may reach. Narrowest first. */
      writeScopes?: WriteScope[]
    }
  | { type: 'permission_resolved'; requestId: string; decision: PermissionDecision['kind']; message?: string }
  /** The model asks the user; the session makes no further progress until the request is resolved. */
  | { type: 'question_request'; requestId: string; request: UserQuestionRequest }
  /** How the request ended: the answers the user gave, or that it went unanswered. Exactly one per request. */
  | { type: 'question_resolved'; requestId: string; outcome: QuestionOutcome }
  /**
   * `starting` is the host's own: the engine is being brought up and cannot yet
   * speak for itself. Its `detail` names the phase the start-up is in.
   */
  | { type: 'status'; status: 'starting' | 'requesting' | 'compacting' | 'idle'; detail?: string }
  /**
   * The conversation was folded into a summary to make room. What the engine
   * does not say it does not carry: the Claude engine reports the sizes but
   * keeps the summary to itself, the own loop has the summary but only knows
   * what the prompt cost before.
   */
  | { type: 'compacted'; summary?: string; preTokens?: number; postTokens?: number }
  /** How full the conversation's window is, as the engine budgets it, and the size at which the session compacts; the newest replaces the last. */
  | { type: 'context_usage'; usedTokens: number; windowTokens: number; compactAtTokens: number }
  /** The session's MCP servers as of now; the newest replaces the last. */
  | { type: 'mcp_servers'; servers: McpServerState[] }
  | { type: 'turn_done'; usage?: TurnUsage; durationMs?: number; isError: boolean; errors: string[] }
  /** `resumable` is set when the turn stopped short with its work intact: another turn carries on where it stopped. */
  | { type: 'error'; message: string; fatal: boolean; resumable?: true }
  | { type: 'ended' }

/**
 * A coding session on one engine. Session-centric on purpose: the extension
 * sends prompts and reacts to events; how the engine talks to its model is
 * the engine's business.
 */
export interface CodeSession {
  readonly id: string
  readonly profile: ModelProfile
  /** Absent on a session that takes no MCP servers. */
  readonly mcp?: McpControl | undefined
  /** Queue a user turn. Returns immediately. */
  send(text: string): void
  /** Single consumer. Ends after the `ended` event. */
  events(): AsyncIterable<SessionEvent>
  respondToPermission(requestId: string, decision: PermissionDecision): void
  /**
   * Answer a question the model asked, or tell it the question went
   * unanswered; resolved at most once. False when this engine no longer holds
   * the request — it was resolved already, or the turn that asked is gone —
   * so the host can deliver the answer another way.
   */
  respondToQuestion(requestId: string, outcome: QuestionOutcome): boolean
  /** Stop the current turn; the session stays usable. */
  interrupt(): Promise<void>
  /** Fold the conversation into a summary to make room. A turn in flight carries on after it, as the same turn. */
  compact(): void
  /** Terminate the engine and release resources. */
  dispose(): Promise<void>
}
