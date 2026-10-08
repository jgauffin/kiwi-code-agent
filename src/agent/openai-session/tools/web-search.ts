import { z } from 'zod'
import { SEARCH_PROVIDER_SECRET_NAME } from '../../../settings/protocol'
import { fail, ok, truncate, type Tool } from './tool'

const schema = z.object({
  query: z.string().describe('What to search the open internet for.'),
})

type BraveResult = { title?: string; url?: string; description?: string }
type BraveResponse = { web?: { results?: BraveResult[] } }

/**
 * Searches the open internet through the Brave Search API and hands back
 * each result's title, address and snippet, for a sub agent that reaches the
 * internet: never offered to a session's own tool set, only to the
 * delegation whose sub agent names it. `apiKey` reads the key lazily, since
 * it may change between calls on the same session. Without one, or on a
 * network failure, the result says so rather than throwing, so the sub agent
 * reports it could not research instead of answering from what the model
 * already knows.
 */
export function webSearchTool(opts: { apiKey: () => Promise<string | undefined>; fetchImpl?: typeof fetch }): Tool<typeof schema> {
  const fetchImpl = opts.fetchImpl ?? fetch
  return {
    name: 'WebSearch',
    description: 'Searches the open internet and returns each result\u2019s title, address and snippet.',
    schema,
    readOnly: true,
    async execute(input) {
      const apiKey = await opts.apiKey()
      if (!apiKey) return fail(`No search provider key is configured. Set one under "${SEARCH_PROVIDER_SECRET_NAME}" in Kiwipow Agent settings.`)
      let response: Response
      try {
        response = await fetchImpl(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(input.query)}`, {
          headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
        })
      } catch (error) {
        return fail(`The internet could not be reached: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (!response.ok) return fail(`The search provider answered ${response.status} ${response.statusText}`)
      const data = (await response.json()) as BraveResponse
      const results = data.web?.results ?? []
      if (results.length === 0) return ok('No results.')
      const text = results.map((r) => `- ${r.title ?? r.url ?? ''}\n  ${r.url ?? ''}\n  ${r.description ?? ''}`).join('\n')
      return ok(truncate(text))
    },
  }
}
