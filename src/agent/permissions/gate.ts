import type { FileEditChange, PermissionDecision } from '../session/code-session'
import type { PreToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import type { Tool, ToolOutput } from '../openai-session/tools/tool'

/** What a permission prompt shows besides the call itself. */
export type PermissionShown = { title?: string; edits?: FileEditChange[] }

/** Puts a call to the user and waits for the answer; each engine has its own way to do so. */
export type AskPermission = (toolUseId: string, toolName: string, input: unknown, shown?: PermissionShown) => Promise<PermissionDecision>

/**
 * The decision every call passes, whether the model or a running script makes
 * it: a deny rule blocks, a read-only or already allowed call goes through,
 * anything else is asked. The rules themselves live in the hooks; this is only
 * where their answer meets the person.
 */
export async function gateCall(
  hooks: SessionHooks | undefined,
  ask: AskPermission,
  tool: Pick<Tool, 'name' | 'readOnly'>,
  use: ToolUse,
): Promise<{ refused?: ToolOutput; pre?: Exclude<PreToolUseOutcome, { deny: string }> }> {
  const pre = await hooks?.preToolUse?.(use)
  if (pre && 'deny' in pre) return { refused: { text: `Blocked: ${pre.deny}`, isError: true } }
  if (!tool.readOnly && !pre?.allow) {
    const decision = await ask(use.toolUseId, tool.name, use.input)
    if (decision.kind === 'deny') return { refused: { text: `Denied by user${decision.message ? `: ${decision.message}` : ''}`, isError: true } }
  }
  return { pre }
}

/** The reason a deny rule forbids a call; undefined when none does. Never asks. */
export async function denyReason(hooks: SessionHooks | undefined, use: ToolUse): Promise<string | undefined> {
  const pre = await hooks?.preToolUse?.(use)
  return pre && 'deny' in pre ? `Blocked: ${pre.deny}` : undefined
}

/** The same decision for a call a tool makes on its own account, one the rules may leave to the user. */
export async function confirmReason(hooks: SessionHooks | undefined, ask: AskPermission, use: ToolUse): Promise<string | undefined> {
  const gate = await gateCall(hooks, ask, { name: use.toolName, readOnly: false }, use)
  return gate.refused?.text
}
