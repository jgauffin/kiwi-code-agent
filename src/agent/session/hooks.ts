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

/** Runs several hooks in order: the first deny or block wins, contexts are joined. */
export function composeHooks(...hooks: SessionHooks[]): SessionHooks {
  return {
    async preToolUse(tool) {
      const contexts: string[] = []
      for (const hook of hooks) {
        const outcome = await hook.preToolUse?.(tool)
        if (outcome && 'deny' in outcome) return outcome
        if (outcome?.additionalContext) contexts.push(outcome.additionalContext)
      }
      return contexts.length ? { additionalContext: contexts.join('\n\n') } : undefined
    },
    async postToolUse(tool) {
      const contexts: string[] = []
      for (const hook of hooks) {
        const outcome = await hook.postToolUse?.(tool)
        if (outcome?.additionalContext) contexts.push(outcome.additionalContext)
      }
      return contexts.length ? { additionalContext: contexts.join('\n\n') } : undefined
    },
    async stop(onStarted) {
      const verifications: VerificationResult[] = []
      for (const hook of hooks) {
        const outcome = await hook.stop?.(onStarted)
        verifications.push(...(outcome?.verifications ?? []))
        if (outcome?.block) return { verifications, block: outcome.block }
      }
      return verifications.length ? { verifications } : undefined
    },
  }
}
