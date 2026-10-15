import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { query, type HookCallback, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'

/**
 * What the research sub agent relies on the Claude engine to do: it searches
 * and fetches while the session that calls it may not. Runs on this
 * machine's Claude login and reaches the internet, so it is opt-in.
 */
const enabled = process.env.KIWI_CLAUDE_INTEGRATION === '1'
const model = process.env.KIWI_CLAUDE_MODEL ?? 'claude-sonnet-5-5'

const FETCHER = { description: 'Fetches one web page and reports its title.', prompt: 'Fetch the page you are given with WebFetch and report its title.', tools: ['WebFetch'] }

async function delegateFetch(prompt: string, tools: string[], hook?: HookCallback) {
  const asked: { tool: string; agentID: string | undefined }[] = []
  const seen: SDKMessage[] = []
  const run = query({
    prompt,
    options: {
      cwd: await mkdtemp(join(tmpdir(), 'kiwi-subagent-')),
      model,
      settingSources: [],
      executable: 'node',
      pathToClaudeCodeExecutable: resolve('node_modules/@anthropic-ai/claude-agent-sdk/cli.js'),
      tools,
      agents: { fetcher: FETCHER },
      ...(hook ? { hooks: { PreToolUse: [{ hooks: [hook] }] } } : {}),
      canUseTool: async (toolName, input, ctx) => {
        asked.push({ tool: toolName, agentID: ctx.agentID })
        return { behavior: 'allow', updatedInput: input }
      },
    },
  })
  for await (const message of run) {
    seen.push(message)
    if (message.type === 'result') break
  }
  const toolUses = (fromSubAgent: boolean) =>
    seen.flatMap((m) =>
      m.type === 'assistant' && (m.parent_tool_use_id !== null) === fromSubAgent ? m.message.content.flatMap((b) => (b.type === 'tool_use' ? [b.name] : [])) : [],
    )
  return { asked, parent: toolUses(false), subAgent: toolUses(true) }
}

describe.runIf(enabled)('Claude engine sub agent tools', () => {
  it('a_built_in_tool_left_out_of_the_parents_base_set_is_out_of_reach_of_its_sub_agents_too', { timeout: 180_000 }, async () => {
    const run = await delegateFetch('Use the Agent tool with the "fetcher" sub agent to fetch https://example.com and report its title. Do not fetch it yourself.', ['Read', 'Agent'])
    expect(run.parent).toContain('Agent')
    expect(run.subAgent).not.toContain('WebFetch')
  })

  it('a_pre_tool_use_hook_tells_a_sub_agents_call_from_the_parents_so_only_the_parent_is_refused', { timeout: 180_000 }, async () => {
    const hook: HookCallback = async (input) => {
      if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'WebFetch' || input.agent_id !== undefined) return {}
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Fetch through the fetcher sub agent.' } }
    }
    const run = await delegateFetch(
      'First try WebFetch on https://example.com yourself. Whatever happens, then use the Agent tool with the "fetcher" sub agent to fetch it and report its title.',
      ['Read', 'Agent', 'WebFetch'],
      hook,
    )
    expect(run.parent).toContain('Agent')
    expect(run.subAgent).toContain('WebFetch')
    // A refused call never reaches the permission prompt: only the sub agent's fetch is asked about.
    expect(run.asked.filter((a) => a.tool === 'WebFetch').every((a) => a.agentID !== undefined)).toBe(true)
    expect(run.asked.some((a) => a.tool === 'WebFetch')).toBe(true)
  })
})
