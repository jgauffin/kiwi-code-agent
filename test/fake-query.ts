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
