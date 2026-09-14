export type Engine = 'claude-sdk' | 'openai-compatible'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** One selectable way to run a session: which engine, which model, how hard to think. */
export type ModelProfile = {
  name: string
  engine: Engine
  model: string
  /** OpenAI-compatible engines only. */
  baseUrl?: string
  /** Name under which the API key is stored in secret storage. */
  apiKeySecret?: string
  effort?: Effort
  /** Path to a system prompt file, relative to the workspace. Later slices use it per phase. */
  systemPromptFile?: string
}
