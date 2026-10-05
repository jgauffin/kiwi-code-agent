import { featureSlug } from './blind-plan'

/** One prompt to a model, answered as plain text: all that naming a feature asks of an engine. */
export type Namer = (prompt: string) => Promise<string>

/** Past this a name has stopped being one, and numbering it still fits the slug a spec file is named by. */
const MAX_WORDS = 6
const MAX_CHARS = 50

function namingPrompt(description: string, taken: string[]): string {
  const avoid = taken.length > 0 ? `\n\nThese names are taken and may not be reused:\n${taken.map((n) => `- ${n}`).join('\n')}` : ''
  return `Name the feature described below, so that a developer reading the name on its own knows which feature it is.

Answer with the name alone: no quotes, no explanation, no full stop. At most ${MAX_WORDS} words, in the language of the domain rather than of the implementation, capitalised as a sentence reads: "Order cancellation", not "order-cancellation" and not "Order Cancellation".${avoid}

The feature:
${description}`
}

/** The name out of whatever came back: the first line it has, less the quoting and list markers a model reaches for. */
export function nameFrom(answer: string): string {
  const line =
    answer
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '') ?? ''
  return line
    .replace(/^[-*>#\s]+/, '')
    .replace(/^["'`*]+|["'`*.]+$/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, MAX_WORDS)
    .join(' ')
    .slice(0, MAX_CHARS)
    .trim()
}

/** `name` itself, or the first numbered variant of it that no taken name resolves to. */
function free(name: string, taken: string[]): string {
  const slugs = new Set(taken.map(featureSlug))
  if (!slugs.has(featureSlug(name))) return name
  let n = 2
  while (slugs.has(featureSlug(`${name} ${n}`))) n++
  return `${name} ${n}`
}

/**
 * A name for the feature a description is about, clear of the names already
 * taken. The model is told which those are, and an answer that collides anyway
 * is numbered rather than handed back: what was asked for is a name to put in
 * the field and edit, so a refusal would answer the wrong question.
 */
export async function suggestFeatureName(ask: Namer, description: string, taken: string[]): Promise<string> {
  const name = nameFrom(await ask(namingPrompt(description, taken)))
  if (name === '') throw new Error('The model answered without a name. Try again, or type one yourself.')
  return free(name, taken)
}
