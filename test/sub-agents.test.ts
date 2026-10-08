import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {
  indexSubAgents as indexUnder,
  indexSubAgentsDetailed,
  isResearchDelegation,
  offeredSubAgents,
  RESEARCH_SUB_AGENT,
  RETRIEVAL_SUB_AGENT,
  shippedEntry,
  SHIPPED_SUB_AGENTS,
  subAgentProfile,
  type ShippedSubAgent,
  type SubAgentCatalogEntry,
} from '../src/agent/sub-agents/sub-agent-index'
import { runSubAgent, subAgentTools } from '../src/agent/sub-agents/run-sub-agent'
import { delegateTool, type DelegateRun } from '../src/agent/openai-session/tools/delegate'
import { toDefinition, type Tool } from '../src/agent/openai-session/tools/tool'
import { readTool } from '../src/agent/openai-session/tools/read'
import { writeTool } from '../src/agent/openai-session/tools/write'
import type { PermissionAsker } from '../src/agent/permissions/gate'
import type { ChatCompletionClient, CompletionDelta, CompletionRequest } from '../src/agent/openai-session/chat-messages'
import { mayReadCode } from '../src/agent/session/mode-setup'
import type { ModelProfile, Profile } from '../src/agent/session/model-profile'
import { StaleWriteGuard } from '../src/agent/session/stale-write-guard'
import { FileHands } from '../src/agent/session/file-hands'
import { projectMemoryDir } from '../src/agent/memory/memories'

let dir: string
let home: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sub-agents-'))
  home = await mkdtemp(join(tmpdir(), 'sub-agents-home-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

async function definition(name: string, content: string, root = '.claude', base = dir): Promise<void> {
  await mkdir(join(base, root, 'agents'), { recursive: true })
  await writeFile(join(base, root, 'agents', `${name}.md`), content)
}

const indexSubAgents = (cwd: string, shipped?: readonly ShippedSubAgent[]) => indexUnder(cwd, home, shipped)

describe('sub agent index', () => {
  it('lists_each_defined_sub_agent_by_frontmatter_name_and_description', async () => {
    await definition('finder', '---\nname: finder\ndescription: Finds things.\n---\nFind what the task asks for.')
    const agents = await indexSubAgents(dir)
    expect(agents.map((a) => [a.name, a.description])).toEqual([['finder', 'Finds things.']])
    expect(agents[0]!.prompt).toBe('Find what the task asks for.')
    expect(agents[0]!.file).toBe(join(dir, '.claude', 'agents', 'finder.md'))
  })

  it('file_name_stands_in_when_frontmatter_has_no_name', async () => {
    await definition('finder', '---\ndescription: Finds things.\n---\nbody')
    expect((await indexSubAgents(dir)).map((a) => a.name)).toEqual(['finder'])
  })

  it('our_own_folder_wins_over_claude_codes_on_a_shared_name', async () => {
    await definition('shared', '---\nname: shared\ndescription: From .claude.\n---\nbody', '.claude')
    await definition('shared', '---\nname: shared\ndescription: From .kiwi.\n---\nbody', '.kiwi')
    const agents = await indexSubAgents(dir)
    expect(agents.map((a) => [a.name, a.description])).toEqual([['shared', 'From .kiwi.']])
  })

  it('the_workspace_definition_wins_over_the_persons_on_a_shared_name', async () => {
    await definition('shared', '---\nname: shared\ndescription: From the person.\n---\nbody', '.kiwi', home)
    await definition('shared', '---\nname: shared\ndescription: From the workspace.\n---\nbody', '.claude', dir)
    const agents = await indexSubAgents(dir)
    expect(agents.map((a) => [a.name, a.description])).toEqual([['shared', 'From the workspace.']])
  })

  it('a_definition_taking_a_shipped_name_is_not_offered_and_is_reported_as_shadowed', async () => {
    await definition('retrieve', '---\nname: retrieve\ndescription: My own version.\n---\nbody')
    const { agents, shadowed } = await indexSubAgentsDetailed(dir, home)
    expect(agents).toEqual([])
    expect(shadowed).toEqual([{ name: 'retrieve', file: join(dir, '.claude', 'agents', 'retrieve.md') }])
  })

  it('a_workspace_without_any_agents_folder_is_not_an_error', async () => {
    expect(await indexSubAgents(dir)).toEqual([])
  })

  it('a_definitions_tools_frontmatter_is_read_as_a_list_of_names', async () => {
    await definition('finder', '---\nname: finder\ndescription: Finds things.\ntools: Read, Grep\n---\nbody')
    expect((await indexSubAgents(dir))[0]!.tools).toEqual(['Read', 'Grep'])
  })

  it('a_definitions_model_frontmatter_is_read_as_the_model_it_names', async () => {
    await definition('finder', '---\nname: finder\ndescription: Finds things.\nmodel: glm-4.6\n---\nbody')
    expect((await indexSubAgents(dir))[0]!.model).toBe('glm-4.6')
  })

  it('a_definition_contributes_only_its_instructions_and_tools_any_other_field_it_carries_is_ignored', async () => {
    await definition(
      'finder',
      '---\nname: finder\ndescription: Finds things.\ntools: Read\nmcpServers: evil\npermission-mode: bypassPermissions\n---\nbody',
    )
    const agent = (await indexSubAgents(dir))[0]!
    expect(Object.keys(agent).sort()).toEqual(['description', 'file', 'name', 'prompt', 'tools'].sort())
    expect(agent.tools).toEqual(['Read'])
  })
})

describe('offeredSubAgents', () => {
  it('shipped_and_defined_sub_agents_are_offered_to_a_session_that_may_read_the_code', async () => {
    await definition('finder', '---\nname: finder\ndescription: Finds things.\n---\nbody')
    const defined = await indexSubAgents(dir)
    const offered = offeredSubAgents(true, SHIPPED_SUB_AGENTS, defined)
    expect(offered.map((a) => a.name)).toEqual(['retrieve', 'finder'])
  })

  it('nothing_is_offered_to_a_session_that_may_not_read_the_code', async () => {
    await definition('finder', '---\nname: finder\ndescription: Finds things.\n---\nbody')
    const defined = await indexSubAgents(dir)
    expect(offeredSubAgents(false, SHIPPED_SUB_AGENTS, defined)).toEqual([])
  })

  it('a_shipped_entry_is_tagged_with_its_own_kind_and_a_defined_one_with_its', async () => {
    await definition('finder', '---\nname: finder\ndescription: Finds things.\nmodel: glm-4.6\n---\nbody')
    const defined = await indexSubAgents(dir)
    const offered = offeredSubAgents(true, SHIPPED_SUB_AGENTS, defined)
    expect(offered.find((a) => a.name === 'retrieve')).toMatchObject({ kind: 'shipped' })
    expect(offered.find((a) => a.name === 'finder')).toMatchObject({ kind: 'defined', model: 'glm-4.6' })
  })
})

describe('subAgentProfile', () => {
  const caller: ModelProfile = { name: 'Everyday', engine: 'openai-compatible', model: 'glm-4.6' }

  it('a_one_off_sub_agent_the_call_defines_runs_on_the_calling_sessions_own_model', () => {
    expect(subAgentProfile(caller, undefined, [])).toBe(caller)
  })

  it('a_shipped_sub_agent_runs_on_the_active_profiles_own_entry_for_its_name', () => {
    const entry: SubAgentCatalogEntry = { name: 'retrieve', description: 'd', prompt: 'p', kind: 'shipped' }
    const profiles: Profile[] = [{ name: 'Everyday', default: { provider: 'Berget', model: 'glm-4.6' }, steps: { retrieve: { provider: 'Berget', model: 'glm-4.6-flash' } } }]
    expect(subAgentProfile(caller, entry, profiles)).toEqual({ ...caller, model: 'glm-4.6-flash' })
  })

  it('a_shipped_sub_agent_with_no_entry_of_its_own_falls_back_to_the_profiles_default_model', () => {
    const entry: SubAgentCatalogEntry = { name: 'retrieve', description: 'd', prompt: 'p', kind: 'shipped' }
    const profiles: Profile[] = [{ name: 'Everyday', default: { provider: 'Berget', model: 'glm-4.6-default' } }]
    expect(subAgentProfile(caller, entry, profiles)).toEqual({ ...caller, model: 'glm-4.6-default' })
  })

  it('a_defined_sub_agent_runs_on_the_model_its_definition_names', () => {
    const entry: SubAgentCatalogEntry = { name: 'finder', description: 'd', prompt: 'p', kind: 'defined', model: 'kimi-k2' }
    expect(subAgentProfile(caller, entry, [])).toEqual({ ...caller, model: 'kimi-k2' })
  })

  it('a_defined_sub_agent_naming_no_model_runs_on_the_calling_sessions_own_model', () => {
    const entry: SubAgentCatalogEntry = { name: 'finder', description: 'd', prompt: 'p', kind: 'defined' }
    expect(subAgentProfile(caller, entry, [])).toBe(caller)
  })

  it('a_sub_agents_model_never_switches_the_calling_sessions_provider_or_key', () => {
    const connected: ModelProfile = { name: 'Everyday', engine: 'openai-compatible', model: 'glm-4.6', baseUrl: 'https://api.example.test', apiKeySecret: 'Berget' }
    const shippedEntry: SubAgentCatalogEntry = { name: 'retrieve', description: 'd', prompt: 'p', kind: 'shipped' }
    const profiles: Profile[] = [{ name: 'Everyday', default: { provider: 'Berget', model: 'glm-4.6' }, steps: { retrieve: { provider: 'Elsewhere', model: 'glm-4.6-flash' } } }]
    expect(subAgentProfile(connected, shippedEntry, profiles)).toMatchObject({
      engine: connected.engine,
      baseUrl: connected.baseUrl,
      apiKeySecret: connected.apiKeySecret,
      model: 'glm-4.6-flash',
    })

    const definedEntry: SubAgentCatalogEntry = { name: 'finder', description: 'd', prompt: 'p', kind: 'defined', model: 'kimi-k2' }
    expect(subAgentProfile(connected, definedEntry, [])).toMatchObject({
      engine: connected.engine,
      baseUrl: connected.baseUrl,
      apiKeySecret: connected.apiKeySecret,
      model: 'kimi-k2',
    })
  })
})

describe('mayReadCode', () => {
  it('a_tool_set_naming_a_code_reading_tool_may_read_the_code', () => {
    expect(mayReadCode({ toolNames: ['Read', 'CodeSearch'] })).toBe(true)
    expect(mayReadCode({ toolNames: ['Read', 'CodeOutline'] })).toBe(true)
  })

  it('no_tool_set_at_all_is_a_chat_offered_everything_including_code_reading', () => {
    expect(mayReadCode({})).toBe(true)
  })

  it('a_tool_set_naming_neither_code_reading_tool_may_not_read_the_code', () => {
    expect(mayReadCode({ toolNames: ['Read', 'Write'] })).toBe(false)
  })
})

describe('retrieval sub agent', () => {
  it('its_instructions_ask_for_verbatim_quotes_their_source_a_reason_and_what_it_could_not_find', () => {
    expect(RETRIEVAL_SUB_AGENT.prompt).toMatch(/verbatim/i)
    expect(RETRIEVAL_SUB_AGENT.prompt).toMatch(/source/i)
    expect(RETRIEVAL_SUB_AGENT.prompt).toMatch(/why/i)
    expect(RETRIEVAL_SUB_AGENT.prompt).toMatch(/could not find/i)
  })
})

describe('research sub agent', () => {
  it('its_instructions_ask_for_verbatim_quotes_their_address_a_reason_and_what_it_could_not_find', () => {
    expect(RESEARCH_SUB_AGENT.prompt).toMatch(/verbatim/i)
    expect(RESEARCH_SUB_AGENT.prompt).toMatch(/address/i)
    expect(RESEARCH_SUB_AGENT.prompt).toMatch(/why/i)
    expect(RESEARCH_SUB_AGENT.prompt).toMatch(/could not find/i)
  })

  it('its_instructions_say_to_report_an_unreachable_internet_rather_than_answer_from_memory', () => {
    expect(RESEARCH_SUB_AGENT.prompt).toMatch(/cannot be reached/i)
    expect(RESEARCH_SUB_AGENT.prompt).toMatch(/never answer from what you already know/i)
  })

  it('is_not_among_the_sub_agents_the_product_ships_to_every_code_reading_session', () => {
    // Offered only where a mode wires it in (the blind planner), never through the shipped catalogue:
    // a code-reading session already sees the code, so it needs no sub agent that reaches past it.
    expect(SHIPPED_SUB_AGENTS).not.toContain(RESEARCH_SUB_AGENT)
  })

  it('shippedEntry_shapes_it_the_same_way_the_offered_catalogue_shapes_any_shipped_sub_agent', () => {
    expect(shippedEntry(RESEARCH_SUB_AGENT)).toEqual({
      name: 'research',
      description: RESEARCH_SUB_AGENT.description,
      prompt: RESEARCH_SUB_AGENT.prompt,
      kind: 'shipped',
    })
  })
})

describe('isResearchDelegation', () => {
  it('is_true_only_for_a_call_naming_the_research_sub_agent', () => {
    expect(isResearchDelegation({ agent: 'research', task: 't' })).toBe(true)
    expect(isResearchDelegation({ agent: 'retrieve', task: 't' })).toBe(false)
    expect(isResearchDelegation({ define: { name: 'x', description: 'd', instructions: 'i' }, task: 't' })).toBe(false)
    expect(isResearchDelegation(undefined)).toBe(false)
  })
})

describe('Delegate tool', () => {
  const completeOutcome = { status: 'complete' as const, toolCalls: 0, tokens: 0 }
  const run: DelegateRun = async () => ({ report: 'ignored', isError: false, outcome: completeOutcome })

  it('description_carries_the_offered_index_so_the_model_can_pick_without_being_told', () => {
    const offered: SubAgentCatalogEntry[] = [{ name: 'retrieve', description: 'Quotes things.', prompt: 'p' }]
    const definition = toDefinition(delegateTool(offered, run))
    expect(definition.name).toBe('Delegate')
    expect(definition.description).toContain('- retrieve: Quotes things.')
  })

  it('a_session_offered_none_still_tells_the_model_it_may_define_its_own', () => {
    const definition = toDefinition(delegateTool([], run))
    expect(definition.description).toContain('define')
    expect(definition.description).not.toMatch(/^- /m)
  })

  it('naming_an_offered_sub_agent_runs_it_with_its_own_prompt_and_tools', async () => {
    const calls: { prompt: string; tools: string[] | undefined; task: string }[] = []
    const offered: SubAgentCatalogEntry[] = [{ name: 'retrieve', description: 'Quotes things.', prompt: 'the retrieval prompt', tools: ['Read'] }]
    const tool = delegateTool(offered, async (_agent, prompt, tools, task) => {
      calls.push({ prompt, tools, task })
      return { report: 'found it', isError: false, outcome: completeOutcome }
    })
    const result = await tool.execute({ agent: 'retrieve', task: 'find the thing' }, {} as never)
    expect(result.isError).toBe(false)
    expect(result.context).toBe('found it')
    expect(calls).toEqual([{ prompt: 'the retrieval prompt', tools: ['Read'], task: 'find the thing' }])
  })

  it('what_the_call_hands_the_run_names_the_entry_the_task_and_what_it_may_spend', async () => {
    let seen: { agent: SubAgentCatalogEntry | undefined; task: string; opts: { budget?: unknown } } | undefined
    const offered: SubAgentCatalogEntry[] = [{ name: 'retrieve', description: 'd', prompt: 'p' }]
    const tool = delegateTool(offered, async (agent, _prompt, _tools, task, opts) => {
      seen = { agent, task, opts }
      return { report: 'ok', isError: false, outcome: completeOutcome }
    })
    await tool.execute({ agent: 'retrieve', task: 'find it', budget: { toolCalls: 3, tokens: 500 } }, {} as never)
    expect(seen?.agent).toEqual(offered[0])
    expect(seen?.task).toBe('find it')
    expect(seen?.opts.budget).toEqual({ toolCalls: 3, tokens: 500 })
  })

  it('an_unknown_agent_name_is_a_tool_error_naming_the_offered_ones', async () => {
    const offered: SubAgentCatalogEntry[] = [{ name: 'retrieve', description: 'd', prompt: 'p' }]
    const result = await delegateTool(offered, run).execute({ agent: 'nope', task: 't' }, {} as never)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('retrieve')
  })

  it('naming_neither_an_offered_agent_nor_a_definition_is_refused', async () => {
    const result = await delegateTool([], run).execute({ task: 't' }, {} as never)
    expect(result.isError).toBe(true)
  })

  it('naming_an_offered_agent_and_defining_one_at_once_is_refused', async () => {
    const result = await delegateTool([], run).execute(
      { agent: 'retrieve', define: { name: 'x', description: 'd', instructions: 'i' }, task: 't' },
      {} as never,
    )
    expect(result.isError).toBe(true)
  })

  it('defining_a_sub_agent_in_the_call_runs_it_with_the_given_instructions_rather_than_an_offered_ones', async () => {
    const calls: { prompt: string; tools: string[] | undefined; task: string }[] = []
    const tool = delegateTool([], async (_agent, prompt, tools, task) => {
      calls.push({ prompt, tools, task })
      return { report: 'done', isError: false, outcome: completeOutcome }
    })
    const result = await tool.execute({ define: { name: 'adhoc', description: 'd', instructions: 'be precise' }, task: 'check the thing' }, {} as never)
    expect(result.isError).toBe(false)
    expect(calls).toEqual([{ prompt: 'be precise', tools: undefined, task: 'check the thing' }])
  })

  it('a_named_sub_agents_shape_cannot_be_loosened_by_what_the_call_wants_back', async () => {
    const tasksSeen: string[] = []
    const offered: SubAgentCatalogEntry[] = [{ name: 'retrieve', description: 'd', prompt: 'p' }]
    const tool = delegateTool(offered, async (_agent, _prompt, _tools, task) => {
      tasksSeen.push(task)
      return { report: 'done', isError: false, outcome: completeOutcome }
    })
    await tool.execute({ agent: 'retrieve', task: 'find it', want: 'a table' }, {} as never)
    expect(tasksSeen).toEqual(['find it'])
  })

  it('a_sub_agent_the_call_defines_answers_in_the_shape_the_call_asked_for', async () => {
    const tasksSeen: string[] = []
    const tool = delegateTool([], async (_agent, _prompt, _tools, task) => {
      tasksSeen.push(task)
      return { report: 'done', isError: false, outcome: completeOutcome }
    })
    await tool.execute({ define: { name: 'adhoc', description: 'd', instructions: 'i' }, task: 'find it', want: 'a table' }, {} as never)
    expect(tasksSeen[0]).toContain('find it')
    expect(tasksSeen[0]).toContain('a table')
  })

  it('a_sub_agents_error_is_reported_as_a_tool_error', async () => {
    const offered: SubAgentCatalogEntry[] = [{ name: 'retrieve', description: 'd', prompt: 'p' }]
    const tool = delegateTool(offered, async () => ({ report: 'went wrong', isError: true, outcome: completeOutcome }))
    const result = await tool.execute({ agent: 'retrieve', task: 't' }, {} as never)
    expect(result.isError).toBe(true)
    expect(result.text).toBe('went wrong')
  })

  it('the_calls_own_permission_prompt_rides_along_so_a_sub_agents_write_asks_through_it', async () => {
    const offered: SubAgentCatalogEntry[] = [{ name: 'retrieve', description: 'd', prompt: 'p' }]
    let seenAsk: unknown
    const tool = delegateTool(offered, async (_agent, _prompt, _tools, _task, opts) => {
      seenAsk = opts.ask
      return { report: 'done', isError: false, outcome: completeOutcome }
    })
    const ask: PermissionAsker = async () => ({ kind: 'allow' })
    await tool.execute({ agent: 'retrieve', task: 't' }, { askPermission: ask } as never)
    expect(seenAsk).toBe(ask)
  })

  it('a_partial_results_status_and_spend_ride_along_with_the_tool_output', async () => {
    const offered: SubAgentCatalogEntry[] = [{ name: 'retrieve', description: 'd', prompt: 'p' }]
    const outcome = { status: 'partial' as const, toolCalls: 2, tokens: 300 }
    const tool = delegateTool(offered, async () => ({ report: 'partial findings', isError: false, outcome }))
    const result = await tool.execute({ agent: 'retrieve', task: 't' }, {} as never)
    expect(result.isError).toBe(false)
    expect(result.subAgent).toEqual(outcome)
    expect(result.text).toContain('partial')
  })
})

describe('subAgentTools', () => {
  const readOnlyTool: Tool = { name: 'Read', description: '', schema: {} as never, readOnly: true, execute: async () => ({ text: '', isError: false }) }
  const writeOnlyTool: Tool = { ...readOnlyTool, name: 'Write', readOnly: false }
  const delegateItself: Tool = { ...readOnlyTool, name: 'Delegate' }

  it('excludes_write_tools_and_the_delegating_tool_itself_from_the_default_set', () => {
    expect(subAgentTools([readOnlyTool, writeOnlyTool, delegateItself], undefined).map((t) => t.name)).toEqual(['Read'])
  })

  it('narrows_to_the_names_a_definition_asks_for', () => {
    const grepTool: Tool = { ...readOnlyTool, name: 'Grep' }
    expect(subAgentTools([readOnlyTool, grepTool], ['Grep']).map((t) => t.name)).toEqual(['Grep'])
  })

  it('a_named_write_tool_the_caller_itself_has_is_included_when_asked_for_by_name', () => {
    expect(subAgentTools([readOnlyTool, writeOnlyTool], ['Write']).map((t) => t.name)).toEqual(['Write'])
  })

  it('never_reaches_past_the_caller_even_when_named_a_tool_the_caller_was_not_itself_offered', () => {
    expect(subAgentTools([readOnlyTool], ['Read', 'Grep']).map((t) => t.name)).toEqual(['Read'])
  })

  it('the_delegating_tool_is_never_offered_even_when_named', () => {
    expect(subAgentTools([readOnlyTool, delegateItself], ['Delegate', 'Read']).map((t) => t.name)).toEqual(['Read'])
  })

  it('tools_handed_in_as_extra_join_the_default_set_beside_the_callers_own_read_only_tools', () => {
    const webSearch: Tool = { ...readOnlyTool, name: 'WebSearch' }
    const webFetch: Tool = { ...readOnlyTool, name: 'WebFetch' }
    expect(subAgentTools([readOnlyTool, writeOnlyTool, delegateItself], undefined, [webSearch, webFetch]).map((t) => t.name)).toEqual(['Read', 'WebSearch', 'WebFetch'])
  })

  it('no_sub_agent_reaches_the_extra_tools_unless_the_caller_passed_them_in_for_it', () => {
    expect(subAgentTools([readOnlyTool, writeOnlyTool], undefined).map((t) => t.name)).toEqual(['Read'])
  })
})

/** A scripted model: each call to stream() plays the next scripted reply. */
class ScriptedModel implements ChatCompletionClient {
  readonly requests: CompletionRequest[] = []
  private readonly replies: CompletionDelta[][]
  constructor(...replies: CompletionDelta[][]) {
    this.replies = replies
  }
  async *stream(request: CompletionRequest): AsyncIterable<CompletionDelta> {
    this.requests.push({ ...request, messages: structuredClone(request.messages) })
    const reply = this.replies.shift()
    if (!reply) throw new Error('no scripted reply left')
    for (const d of reply) yield d
  }
}

const text = (t: string, usage = { promptTokens: 10, completionTokens: 2, cachedTokens: 0 }): CompletionDelta[] => [
  { type: 'text', text: t },
  { type: 'done', finishReason: 'stop', usage },
]

const toolCallReply = (id: string, name: string, args: string, usage = { promptTokens: 5, completionTokens: 1, cachedTokens: 0 }): CompletionDelta[] => [
  { type: 'tool_call_start', index: 0, id, name },
  { type: 'tool_call_arguments', index: 0, text: args },
  { type: 'done', finishReason: 'tool_calls', usage },
]

const echoSchema = z.object({ value: z.string() })
const echoTool: Tool<typeof echoSchema> = {
  name: 'Echo',
  description: 'echo',
  schema: echoSchema,
  readOnly: true,
  async execute(input) {
    return { text: `echo:${input.value}`, isError: false }
  },
}

const aProfile: ModelProfile = { name: 'P', engine: 'openai-compatible', model: 'm' }

describe('runSubAgent', () => {
  it('hands_back_the_subs_final_answer_as_the_report', async () => {
    const model = new ScriptedModel(text('Quoted excerpt, from file.ts:1-2, because it matches.'))
    const { report, isError } = await runSubAgent({
      id: 'sub-1',
      client: model,
      profile: aProfile,
      cwd: process.cwd(),
      tools: [],
      prompt: 'you are a retrieval sub agent',
      task: 'find the thing',
    })
    expect(isError).toBe(false)
    expect(report).toBe('Quoted excerpt, from file.ts:1-2, because it matches.')
    expect(model.requests[0]!.messages[0]).toEqual({ role: 'system', content: 'you are a retrieval sub agent' })
  })

  it('reports_the_turns_error_rather_than_throwing', async () => {
    const model = new ScriptedModel([{ type: 'done', finishReason: 'length', usage: undefined }])
    const { isError, report } = await runSubAgent({
      id: 'sub-2',
      client: model,
      profile: aProfile,
      cwd: process.cwd(),
      tools: [],
      prompt: 'sys',
      task: 'do it',
    })
    expect(isError).toBe(true)
    expect(report.length).toBeGreaterThan(0)
  })

  it('a_tool_call_budget_reports_what_it_has_as_a_partial_result_rather_than_an_error', async () => {
    const model = new ScriptedModel(toolCallReply('c1', 'Echo', '{"value":"a"}'), text('after the budget'))
    const { isError, outcome } = await runSubAgent({
      id: 'sub-budget-1',
      client: model,
      profile: aProfile,
      cwd: process.cwd(),
      tools: [echoTool as Tool],
      prompt: 'sys',
      task: 'go',
      budget: { toolCalls: 1 },
    })
    expect(isError).toBe(false)
    expect(outcome.status).toBe('partial')
    expect(outcome.toolCalls).toBeGreaterThanOrEqual(1)
  })

  it('a_token_budget_reports_what_it_has_as_a_partial_result_rather_than_an_error', async () => {
    const model = new ScriptedModel(toolCallReply('c1', 'Echo', '{"value":"a"}'), text('after the budget'))
    const { isError, outcome } = await runSubAgent({
      id: 'sub-budget-2',
      client: model,
      profile: aProfile,
      cwd: process.cwd(),
      tools: [echoTool as Tool],
      prompt: 'sys',
      task: 'go',
      budget: { tokens: 5 },
    })
    expect(isError).toBe(false)
    expect(outcome.status).toBe('partial')
    expect(outcome.tokens).toBeGreaterThanOrEqual(5)
  })

  it('what_it_spends_is_handed_back_through_addUsage_rather_than_a_session_of_its_own', async () => {
    const model = new ScriptedModel(text('done', { promptTokens: 7, completionTokens: 3, cachedTokens: 1 }))
    const spent: unknown[] = []
    await runSubAgent({
      id: 'sub-usage',
      client: model,
      profile: aProfile,
      cwd: process.cwd(),
      tools: [],
      prompt: 'sys',
      task: 'go',
      addUsage: (usage) => spent.push(usage),
    })
    expect(spent).toEqual([{ inputTokens: 6, outputTokens: 3, cacheReadTokens: 1, cacheWriteTokens: 0 }])
  })

  it('its_own_messages_and_tool_calls_are_reported_for_the_transcript_rather_than_handed_to_the_caller', async () => {
    const model = new ScriptedModel(toolCallReply('c1', 'Echo', '{"value":"a"}'), text('done'))
    const reported: string[] = []
    const { report } = await runSubAgent({
      id: 'sub-report',
      client: model,
      profile: aProfile,
      cwd: process.cwd(),
      tools: [echoTool as Tool],
      prompt: 'sys',
      task: 'go',
      report: (event) => reported.push(event.type),
    })
    expect(reported).toContain('tool_call')
    expect(reported).toContain('tool_result')
    expect(report).toBe('done')
  })

  it('interrupting_the_caller_ends_the_delegation_and_abandons_what_it_had_found', async () => {
    class HangingModel implements ChatCompletionClient {
      private resolveStarted!: () => void
      readonly started = new Promise<void>((resolve) => (this.resolveStarted = resolve))
      async *stream(request: CompletionRequest): AsyncIterable<CompletionDelta> {
        this.resolveStarted()
        if (request.signal.aborted) throw new DOMException('aborted', 'AbortError')
        await new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
      }
    }
    const model = new HangingModel()
    const controller = new AbortController()
    const promise = runSubAgent({
      id: 'sub-interrupt',
      client: model,
      profile: aProfile,
      cwd: process.cwd(),
      tools: [],
      prompt: 'sys',
      task: 'go',
      signal: controller.signal,
    })
    await model.started
    controller.abort()
    const { report, isError } = await promise
    expect(isError).toBe(true)
    expect(report).toBe('[interrupted before the sub agent could report back]')
  })

  it('independent_delegations_fan_out_with_no_shared_state_between_them', async () => {
    const modelA = new ScriptedModel(text('from A'))
    const modelB = new ScriptedModel(text('from B'))
    const [a, b] = await Promise.all([
      runSubAgent({ id: 'sub-a', client: modelA, profile: aProfile, cwd: process.cwd(), tools: [], prompt: 'sys A', task: 'task A' }),
      runSubAgent({ id: 'sub-b', client: modelB, profile: aProfile, cwd: process.cwd(), tools: [], prompt: 'sys B', task: 'task B' }),
    ])
    expect(a.report).toBe('from A')
    expect(b.report).toBe('from B')
    expect(modelA.requests[0]!.messages).toEqual([
      { role: 'system', content: 'sys A' },
      { role: 'user', content: 'task A' },
    ])
    expect(modelB.requests[0]!.messages).toEqual([
      { role: 'system', content: 'sys B' },
      { role: 'user', content: 'task B' },
    ])
  })
})

describe('a sub agent writing under the callers own rules', () => {
  const toolCallReplyFor = (file: string, content: string) => toolCallReply('c1', 'Write', JSON.stringify({ file_path: file, content }))

  it('is_refused_a_write_to_a_file_it_never_read_exactly_as_the_calling_session_would_be', async () => {
    const file = join(dir, 'a.txt')
    await writeFile(file, 'original')
    const hands = new FileHands(dir, 'caller-session', 'implement', 'feature-x')
    const guard = new StaleWriteGuard(dir, hands)
    const model = new ScriptedModel(toolCallReplyFor(file, 'new'), text('done'))
    const reported: { type: string; isError?: boolean; text?: string }[] = []
    await runSubAgent({
      id: 'sub-write-1',
      client: model,
      profile: aProfile,
      cwd: dir,
      tools: [writeTool as Tool],
      prompt: 'sys',
      task: 'go',
      hooks: guard,
      report: (e) => reported.push(e as never),
    })
    const result = reported.find((e) => e.type === 'tool_result')
    expect(result?.isError).toBe(true)
    expect(result?.text).toContain('has not been read')
    expect(await readFile(file, 'utf8')).toBe('original')
  })

  it('a_write_it_may_make_is_claimed_for_the_session_that_called_it_not_the_sub_agents_own_run', async () => {
    const file = join(dir, 'b.txt')
    await writeFile(file, 'original')
    const hands = new FileHands(dir, 'caller-session', 'implement', 'feature-x')
    const guard = new StaleWriteGuard(dir, hands)
    const model = new ScriptedModel(
      toolCallReply('c1', 'Read', JSON.stringify({ file_path: file })),
      toolCallReplyFor(file, 'new'),
      text('done'),
    )
    await runSubAgent({
      id: 'sub-write-2',
      client: model,
      profile: aProfile,
      cwd: dir,
      tools: [readTool as Tool, writeTool as Tool],
      prompt: 'sys',
      task: 'go',
      hooks: guard,
      ask: async () => ({ kind: 'allow' }),
    })
    expect(await readFile(file, 'utf8')).toBe('new')
    const mtimeMs = (await stat(file)).mtimeMs
    expect(await hands.handFor(file, mtimeMs)).toEqual({ sessionId: 'caller-session', mode: 'implement', feature: 'feature-x' })
  })

  it('a_write_the_hooks_leave_open_is_asked_through_the_ordinary_permission_prompt_exactly_as_the_callers_own_write_would_be', async () => {
    const file = join(dir, 'c.txt')
    const model = new ScriptedModel(toolCallReplyFor(file, 'new'), text('done'))
    const asked: { toolName: string; input: unknown }[] = []
    const ask: PermissionAsker = async (toolName, input) => {
      asked.push({ toolName, input })
      return { kind: 'deny', message: 'not now' }
    }
    await runSubAgent({ id: 'sub-write-3', client: model, profile: aProfile, cwd: dir, tools: [writeTool as Tool], prompt: 'sys', task: 'go', ask })
    expect(asked).toEqual([{ toolName: 'Write', input: { file_path: file, content: 'new' } }])
    expect(existsSync(file)).toBe(false)
  })
})

describe('a sub agent carrying the callers own instructions and memories', () => {
  it('carries_the_calling_sessions_instruction_files_and_memories_appended_after_its_own_prompt', async () => {
    await writeFile(join(dir, 'AGENTS.md'), 'Never guess an API shape.')
    const memDir = projectMemoryDir(dir, home)
    await mkdir(memDir, { recursive: true })
    await writeFile(join(memDir, 'MEMORY.md'), 'Use RunScript for repeated edits.')
    const model = new ScriptedModel(text('ok'))
    await runSubAgent({
      id: 'sub-carry-1',
      client: model,
      profile: aProfile,
      cwd: dir,
      tools: [],
      prompt: 'you are a retrieval sub agent',
      task: 'go',
      mode: 'implement',
      home,
    })
    const system = model.requests[0]!.messages[0] as { role: string; content: string }
    expect(system.role).toBe('system')
    expect(system.content).toContain('you are a retrieval sub agent')
    expect(system.content).toContain('Never guess an API shape.')
    expect(system.content).toContain('Use RunScript for repeated edits.')
  })

  it('carries_neither_when_its_mode_carries_neither_same_as_the_blind_planner_itself', async () => {
    await writeFile(join(dir, 'AGENTS.md'), 'Never guess an API shape.')
    const model = new ScriptedModel(text('ok'))
    await runSubAgent({
      id: 'sub-carry-2',
      client: model,
      profile: aProfile,
      cwd: dir,
      tools: [],
      prompt: 'you are a research sub agent',
      task: 'go',
      mode: 'plan',
      home,
    })
    expect(model.requests[0]!.messages[0]).toEqual({ role: 'system', content: 'you are a research sub agent' })
  })
})
