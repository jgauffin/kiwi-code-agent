import type { McpServerConfig, McpServerStatus, Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { AsyncQueue } from '../src/agent/session/async-queue'

/**
 * Stands in for the SDK's `query()`: what the engine would emit is pushed by
 * the test, what the session sends is collected for assertions.
 */
export function fakeQuery() {
  const emitted = new AsyncQueue<SDKMessage>()
  const received: SDKUserMessage[] = []
  const setServers: Record<string, McpServerConfig>[] = []
  const reconnected: string[] = []
  let mcpStatus: McpServerStatus[] = []
  let reconnectError: Error | undefined
  let contextUsage = { totalTokens: 20_000, maxTokens: 200_000 }
  let options: Options | undefined
  let interrupted = 0
  let closed = 0

  const query = (params: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }): Query => {
    options = params.options
    void (async () => {
      for await (const m of params.prompt) received.push(m)
    })()
    const generator = emitted[Symbol.asyncIterator]()
    const q = {
      next: () => generator.next(),
      return: () => generator.return!(),
      throw: (e: unknown) => Promise.reject(e),
      [Symbol.asyncIterator]() {
        return q
      },
      interrupt: async () => {
        interrupted++
      },
      close: () => {
        closed++
        emitted.end()
      },
      mcpServerStatus: async () => mcpStatus,
      setMcpServers: async (servers: Record<string, McpServerConfig>) => {
        setServers.push(servers)
        return { added: Object.keys(servers), removed: [], errors: {} }
      },
      reconnectMcpServer: async (name: string) => {
        reconnected.push(name)
        if (reconnectError) throw reconnectError
      },
      getContextUsage: async () => ({ ...contextUsage, rawMaxTokens: contextUsage.maxTokens, isAutoCompactEnabled: false }),
    }
    return q as unknown as Query
  }

  return {
    query,
    emit: (m: SDKMessage) => emitted.push(m),
    endStream: () => emitted.end(),
    failStream: (e: unknown) => emitted.fail(e),
    /** What `mcpServerStatus()` answers from now on. */
    setMcpStatus: (status: McpServerStatus[]) => void (mcpStatus = status),
    failReconnect: (error: Error) => void (reconnectError = error),
    /** What `getContextUsage()` answers from now on. */
    setContextUsage: (usage: { totalTokens: number; maxTokens: number }) => void (contextUsage = usage),
    received,
    setServers,
    reconnected,
    get options() {
      return options
    },
    get interrupted() {
      return interrupted
    },
    get closed() {
      return closed
    },
  }
}

export const initMessage = (sessionId = 'engine-1'): SDKMessage =>
  ({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    model: 'claude-opus-4-7',
    claude_code_version: '2.1.112',
    apiKeySource: 'none',
    cwd: '/w',
    tools: [],
    mcp_servers: [],
    permissionMode: 'default',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
    uuid: 'u-init',
  }) as unknown as SDKMessage

/** A main-conversation reply whose request carried `contextTokens` in all. */
export const assistantMessage = (contextTokens: number): SDKMessage =>
  ({
    type: 'assistant',
    parent_tool_use_id: null,
    uuid: 'u-assistant',
    session_id: 'engine-1',
    message: {
      id: 'msg_1',
      content: [],
      usage: { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: contextTokens - 1002, output_tokens: 50 },
    },
  }) as unknown as SDKMessage

/**
 * What the engine sends while it compacts, as the real one does; `error` makes it fail.
 * A failure is told twice in status and once more as a reply the engine made up, and the result still succeeds.
 */
export const compactionMessages = (error?: string): SDKMessage[] => {
  const failed = { type: 'system', subtype: 'status', status: null, compact_result: 'failed', compact_error: error, uuid: 'u-c2', session_id: 'engine-1' }
  return [
    { type: 'system', subtype: 'status', status: 'compacting', uuid: 'u-c1', session_id: 'engine-1' },
    ...(error
      ? [failed, failed, syntheticReply(`Error: Error during compaction: ${error}`)]
      : [
          { type: 'system', subtype: 'status', status: null, compact_result: 'success', uuid: 'u-c2', session_id: 'engine-1' },
          { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 160_000, post_tokens: 3000 }, uuid: 'u-c3', session_id: 'engine-1' },
        ]),
    resultMessage(),
  ] as unknown as SDKMessage[]
}

/** The engine turning `/compact` down before asking the API, as it does with nothing to summarise. */
export const compactionRefusedMessages = (reason: string): SDKMessage[] =>
  [syntheticReply(`Error: ${reason}`), resultMessage()] as unknown as SDKMessage[]

const syntheticReply = (text: string) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  uuid: 'u-synthetic',
  session_id: 'engine-1',
  message: {
    id: 'synthetic-2',
    model: '<synthetic>',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  },
})

/** The engine refusing a prompt on its own, before any request, as the real one does past its limit. */
export const promptTooLongMessages = (): SDKMessage[] =>
  [
    {
      type: 'assistant',
      error: 'invalid_request',
      parent_tool_use_id: null,
      uuid: 'u-ptl',
      session_id: 'engine-1',
      message: {
        id: 'synthetic-1',
        model: '<synthetic>',
        content: [{ type: 'text', text: 'Prompt is too long' }],
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    },
    { ...resultMessage(), is_error: true, duration_ms: 3, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  ] as unknown as SDKMessage[]

/** How a turn stopped by an interrupt ends. */
export const interruptedResult = (): SDKMessage =>
  ({ ...resultMessage(), subtype: 'error_during_execution', is_error: true, errors: [] }) as unknown as SDKMessage

export const resultMessage = (): SDKMessage =>
  ({
    type: 'result',
    subtype: 'success',
    duration_ms: 1200,
    duration_api_ms: 1000,
    is_error: false,
    num_turns: 1,
    result: 'done',
    stop_reason: 'end_turn',
    total_cost_usd: 0.01,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    uuid: 'u-result',
    session_id: 'engine-1',
  }) as unknown as SDKMessage
