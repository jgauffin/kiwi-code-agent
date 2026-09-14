/**
 * Engine-agnostic hook points. The Claude engine maps them onto the SDK's
 * PreToolUse / PostToolUse / Stop hooks, the own-loop engine calls them
 * directly, so a hook is written once.
 */

export type ToolUse = { toolName: string; input: unknown; toolUseId: string }

export type PreToolUseOutcome =
  | { deny: string }
  | { additionalContext?: string }
  | undefined

export type PostToolUseOutcome = { additionalContext?: string } | undefined

export type VerificationResult = { command: string; cwd: string; ok: boolean; output: string }

/** `block` sends the reason back to the model and the turn continues. */
export type StopOutcome = { verifications?: VerificationResult[]; block?: string } | undefined

export type VerificationStarted = { command: string; cwd: string }

export interface SessionHooks {
  preToolUse?(tool: ToolUse): Promise<PreToolUseOutcome>
  postToolUse?(tool: ToolUse & { output: string; isError: boolean }): Promise<PostToolUseOutcome>
  /** The model wants to end its turn. `onStarted` fires before each verification command so the UI can show progress. */
  stop?(onStarted: (started: VerificationStarted) => void): Promise<StopOutcome>
}
