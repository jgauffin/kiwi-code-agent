import type { HookCallback, HookJSONOutput, Options } from '@anthropic-ai/claude-agent-sdk'
import type { SessionHooks } from '../session/hooks'
import { bareToolName } from './tool-server'

type PreToolUse = NonNullable<SessionHooks['preToolUse']>
type PostToolUse = NonNullable<SessionHooks['postToolUse']>

/** Maps the engine-agnostic hooks onto the SDK's hook protocol. */
export function sdkHooks(hooks: SessionHooks): NonNullable<Options['hooks']> {
  const registered: NonNullable<Options['hooks']> = {}
  if (hooks.preToolUse) registered.PreToolUse = [{ hooks: [preToolUseCallback(hooks.preToolUse.bind(hooks))] }]
  if (hooks.postToolUse) registered.PostToolUse = [{ hooks: [postToolUseCallback(hooks.postToolUse.bind(hooks))] }]
  return registered
}

function preToolUseCallback(pre: PreToolUse): HookCallback {
  return async (input): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== 'PreToolUse') return {}
    // The hook's `cwd` follows the engine's shell from one call to the next.
    // Only a sub agent's call carries an agent id; a session started as an agent carries its type without one.
    const agent = input.agent_id !== undefined ? input.agent_type : undefined
    const outcome = await pre({ toolName: bareToolName(input.tool_name), input: input.tool_input, toolUseId: input.tool_use_id, cwd: input.cwd, ...(agent ? { agent } : {}) })
    return preToolUseOutput(outcome)
  }
}

function preToolUseOutput(outcome: Awaited<ReturnType<PreToolUse>>): HookJSONOutput {
  if (outcome && 'deny' in outcome) {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: outcome.deny } }
  }
  if (!outcome?.allow && !outcome?.ask && !outcome?.additionalContext) return {}
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      // An ask is explicit so the engine's own allow rules, which the policy has already read as grants, cannot let the call past it.
      ...(outcome.allow ? { permissionDecision: 'allow' } : outcome.ask ? { permissionDecision: 'ask' } : {}),
      ...(outcome.additionalContext ? { additionalContext: outcome.additionalContext } : {}),
    },
  }
}

function postToolUseCallback(post: PostToolUse): HookCallback {
  return async (input): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== 'PostToolUse') return {}
    const output = typeof input.tool_response === 'string' ? input.tool_response : JSON.stringify(input.tool_response)
    const outcome = await post({
      toolName: bareToolName(input.tool_name),
      input: input.tool_input,
      toolUseId: input.tool_use_id,
      output,
      isError: false,
    })
    if (outcome?.additionalContext) {
      return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: outcome.additionalContext } }
    }
    return {}
  }
}
