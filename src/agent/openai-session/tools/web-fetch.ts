import { z } from 'zod'
import { fail, ok, truncate, type Tool } from './tool'

const schema = z.object({
  url: z.string().describe('The address to fetch, including its scheme (https://...).'),
})

/** Strips scripts, styles and tags from fetched HTML, decodes the handful of entities a page is likely to use, and collapses runs of whitespace a tag left behind. */
function textOf(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

export const WEB_FETCH_TOOL = 'WebFetch'

/**
 * Fetches one page and hands back its readable text, for a sub agent that
 * reaches the open internet: never offered to a session's own tool set, only
 * to the delegation whose sub agent names it. No key, so nothing short of the
 * address itself can be missing; a network failure is reported in the result
 * rather than thrown, so the sub agent reports it could not research instead
 * of answering from what the model already knows.
 */
export function webFetchTool(fetchImpl: typeof fetch = fetch): Tool<typeof schema> {
  return {
    name: WEB_FETCH_TOOL,
    description: 'Fetches one page from the open internet and returns its readable text.',
    schema,
    readOnly: true,
    async execute(input) {
      let response: Response
      try {
        response = await fetchImpl(input.url)
      } catch (error) {
        return fail(`The internet could not be reached: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (!response.ok) return fail(`${input.url} answered ${response.status} ${response.statusText}`)
      const body = await response.text()
      const text = textOf(body)
      return ok(truncate(text || '(empty page)'))
    },
  }
}
