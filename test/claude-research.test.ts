import { describe, expect, it } from 'vitest'
import { claudeBaseTools, claudeResearchAgent, ResearchOnlyDelegation } from '../src/agent/sub-agents/claude-research'
import { RESEARCH_SUB_AGENT } from '../src/agent/sub-agents/sub-agent-index'

const guard = new ResearchOnlyDelegation()
const call = (toolName: string, input: unknown, agent?: string) => guard.preToolUse({ toolName, input, toolUseId: 't', ...(agent ? { agent } : {}) })

describe('research on the Claude engine', () => {
  it('is_registered_with_the_research_instructions_and_only_searching_and_fetching', () => {
    expect(claudeResearchAgent()).toEqual({ description: RESEARCH_SUB_AGENT.description, prompt: RESEARCH_SUB_AGENT.prompt, tools: ['WebSearch', 'WebFetch'] })
  })

  it('a_tool_set_that_delegates_gains_the_engines_sub_agent_tool_and_what_research_reaches_with', () => {
    expect(claudeBaseTools(['Read', 'Delegate'])).toEqual(['Read', 'Delegate', 'Agent', 'WebSearch', 'WebFetch'])
  })

  it('a_tool_set_that_does_not_delegate_is_left_as_it_is', () => {
    expect(claudeBaseTools(['Read', 'Write'])).toEqual(['Read', 'Write'])
  })
})

describe('ResearchOnlyDelegation', () => {
  it('lets_a_scoped_session_hand_work_to_research_and_to_no_other_sub_agent', async () => {
    expect(await call('Agent', { subagent_type: 'research', prompt: 'p' })).toBeUndefined()
    expect(await call('Agent', { subagent_type: 'Explore', prompt: 'p' })).toMatchObject({ deny: expect.stringContaining('research') })
    expect(await call('Task', { subagent_type: 'general-purpose', prompt: 'p' })).toMatchObject({ deny: expect.any(String) })
  })

  it('refuses_the_session_its_own_search_or_fetch_but_not_the_research_run_it_started', async () => {
    expect(await call('WebFetch', { url: 'https://example.com' })).toMatchObject({ deny: expect.stringContaining('research') })
    expect(await call('WebSearch', { query: 'x' })).toMatchObject({ deny: expect.any(String) })
    expect(await call('WebFetch', { url: 'https://example.com' }, 'research')).toBeUndefined()
    expect(await call('WebSearch', { query: 'x' }, 'research')).toBeUndefined()
  })

  it('has_no_say_over_any_other_call', async () => {
    expect(await call('Read', { file_path: 'docs/a.md' })).toBeUndefined()
  })
})
