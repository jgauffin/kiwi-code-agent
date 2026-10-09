/**
 * Engine-agnostic hook points. The Claude engine maps them onto the SDK's
 * PreToolUse / PostToolUse hooks, the own-loop engine calls them directly, so
 * a hook is written once.
 */

/** `cwd` is where the engine's shell stands for this call, where the engine says; the workspace root otherwise. */
export type ToolUse = { toolName: string; input: unknown; toolUseId: string; cwd?: string }

/**
 * `allow` skips the permission prompt: the hook has ruled the call safe. `ask`
 * puts it to the person whatever the engine's own rules would have said.
 */
export type PreToolUseOutcome =
  | { deny: string }
  | { allow?: true; ask?: true; additionalContext?: string }
  | undefined

export type PostToolUseOutcome = { additionalContext?: string } | undefined

export interface SessionHooks {
  preToolUse?(tool: ToolUse): Promise<PreToolUseOutcome>
  postToolUse?(tool: ToolUse & { output: string; isError: boolean }): Promise<PostToolUseOutcome>
}

/** Runs several hooks in order: the first deny wins, any allow allows, an ask stands when nothing allows, contexts are joined. */
export function composeHooks(...hooks: SessionHooks[]): SessionHooks {
  return {
    async preToolUse(tool) {
      const contexts: string[] = []
      let allow = false
      let ask = false
      for (const hook of hooks) {
        const outcome = await hook.preToolUse?.(tool)
        if (outcome && 'deny' in outcome) return outcome
        if (outcome?.allow) allow = true
        if (outcome?.ask) ask = true
        if (outcome?.additionalContext) contexts.push(outcome.additionalContext)
      }
      if (!allow && !ask && contexts.length === 0) return undefined
      return {
        ...(allow ? { allow: true as const } : ask ? { ask: true as const } : {}),
        ...(contexts.length ? { additionalContext: contexts.join('\n\n') } : {}),
      }
    },
    async postToolUse(tool) {
      const contexts: string[] = []
      for (const hook of hooks) {
        const outcome = await hook.postToolUse?.(tool)
        if (outcome?.additionalContext) contexts.push(outcome.additionalContext)
      }
      return contexts.length ? { additionalContext: contexts.join('\n\n') } : undefined
    },
  }
}
