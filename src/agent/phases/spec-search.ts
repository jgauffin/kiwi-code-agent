import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { searchPattern } from '../openai-session/tools/search-text'
import { fail, ok, truncate, type Tool, type ToolContext } from '../openai-session/tools/tool'
import { SPECS_DIR } from './blind-plan'
import { specFiles } from './plan-list'
import { frontMatterValue, statusOf } from './spec-file'
import { parseSpecText, type Item, type Spec } from './spec-model'
import { isSettled, type SpecStatus } from './spec-status'

export const SPEC_SEARCH_TOOL = 'SpecSearch'

const schema = z.object({
  query: z.string().min(1).describe("Text to find in the specs' rules, edge cases, open questions and goals. Taken literally unless regex is true."),
  regex: z.boolean().optional().describe('Treat query as a regular expression'),
  case_sensitive: z.boolean().optional().describe('Match case; the default ignores it'),
  limit: z.number().int().min(1).max(200).optional().describe('Maximum rules to show (default 30)'),
})

/** An edge case as a script gets it. */
type Clause = { name: string; text: string; citation: string | null }

/** One match as a script gets it: a rule with its edge cases, an open question, or a spec's goal. */
export type SpecMatch = {
  file: string
  feature: string
  status: SpecStatus
  kind: 'rule' | 'question' | 'goal'
  /** The scenario a rule sits in; null for a question or a goal. */
  scenario: string | null
  /** Null for a goal. */
  name: string | null
  text: string
  citation: string | null
  edges: Clause[]
}

const clause = (item: Item): Clause => ({ name: item.name, text: item.text, citation: item.citation ?? null })

/**
 * Search over the specs that answers with the rules themselves. A rule is one
 * line in a known shape, so a match comes back whole, with its edge cases, its
 * scenario and the status of its spec, and most questions about what the
 * product does need no Read of the spec at all. Removed rules are left out.
 *
 * `canRead` is the session's read scope, as for the other search tools.
 */
export function specSearchTool(canRead: (relPath: string) => boolean = () => true): Tool<typeof schema> {
  return {
    name: SPEC_SEARCH_TOOL,
    description:
      "Searches the feature specs under specs/ and returns each matching rule whole: its spec and that spec's status (approved rules are what the product does, a draft's are a proposal), its scenario, its text and citation, and its edge cases. A match in an edge case returns the rule it qualifies; open questions and goals match too. Removed rules are left out. Read a spec only for what its rules leave out. Literal and case-insensitive unless regex or case_sensitive is set.",
    schema,
    readOnly: true,
    async execute(input, ctx) {
      let pattern: RegExp
      try {
        pattern = searchPattern(input)
      } catch (error) {
        return fail(`Invalid regular expression: ${(error as Error).message}`)
      }
      const files = await readableSpecFiles(ctx, canRead)
      if (files.length === 0) return ok(`No specs under ${SPECS_DIR}/ yet.`, [])

      const matches: SpecMatch[] = []
      for (const file of files) {
        if (ctx.signal.aborted) return fail('Search interrupted')
        matches.push(...(await matchesInFile(ctx, file, pattern)))
      }

      // What the product does comes first; a draft is a proposal, read after it.
      matches.sort(byStatusThenFile)
      if (matches.length === 0) return ok(`No matches in ${files.length} spec${files.length === 1 ? '' : 's'}.`, [])
      const shown = matches.slice(0, input.limit ?? 30)
      return ok(truncate(render(shown, matches.length, files.length)), matches)
    },
  }
}

/** Every spec under `specs/`, any depth, that the session's read scope allows. */
async function readableSpecFiles(ctx: ToolContext, canRead: (relPath: string) => boolean): Promise<string[]> {
  // Any depth: a spec a person filed in a folder, or deeper, is searched like any other.
  const found = await specFiles(join(ctx.cwd, SPECS_DIR))
  return found.map(({ slug, folder }) => `${SPECS_DIR}/${folder ? `${folder}/` : ''}${slug}.spec.md`).filter((file) => canRead(file))
}

function byStatusThenFile(a: SpecMatch, b: SpecMatch): number {
  return Number(isSettled(b.status)) - Number(isSettled(a.status)) || a.file.localeCompare(b.file)
}

/** What every match in a file shares: the file and what its spec parsed to. */
type FileBase = { file: string; feature: string; status: SpecStatus }

/** Every match in one spec file: its goal, its rules with their edge cases, and its open questions. */
async function matchesInFile(ctx: ToolContext, file: string, pattern: RegExp): Promise<SpecMatch[]> {
  const text = await readFile(join(ctx.cwd, ...file.split('/')), 'utf8').catch(() => undefined)
  if (text === undefined) return []
  const spec = parseSpecText(text)
  const base: FileBase = { file, feature: frontMatterValue(text, 'feature') ?? spec.title, status: statusOf(text) }
  const hits = (...texts: (string | undefined)[]): boolean => texts.some((t) => t !== undefined && pattern.test(t))
  const matches: SpecMatch[] = []
  if (hits(spec.goal)) matches.push({ ...base, kind: 'goal', scenario: null, name: null, text: spec.goal, citation: null, edges: [] })
  matches.push(...ruleMatches(spec, base, hits))
  matches.push(...questionMatches(spec, base, hits))
  return matches
}

function ruleMatches(spec: Spec, base: FileBase, hits: (...texts: (string | undefined)[]) => boolean): SpecMatch[] {
  const matches: SpecMatch[] = []
  for (const scenario of spec.scenarios) {
    for (const rule of scenario.behaviours) {
      if (rule.removed) continue
      const edges = rule.edges.filter((e) => !e.removed)
      if (!hits(rule.name, rule.text, rule.citation) && !edges.some((e) => hits(e.name, e.text, e.citation))) continue
      matches.push({ ...base, kind: 'rule', scenario: scenario.title, name: rule.name, text: rule.text, citation: rule.citation ?? null, edges: edges.map(clause) })
    }
  }
  return matches
}

function questionMatches(spec: Spec, base: FileBase, hits: (...texts: (string | undefined)[]) => boolean): SpecMatch[] {
  const matches: SpecMatch[] = []
  for (const question of spec.questions) {
    if (question.removed || !hits(question.name, question.text)) continue
    matches.push({ ...base, kind: 'question', scenario: null, name: question.name, text: question.text, citation: null, edges: [] })
  }
  return matches
}

const cited = (text: string, citation: string | null): string => (citation ? `${text} (${citation})` : text)

/** Matches with the same spec, grouped in the order they came in. */
type FileGroup = { file: string; feature: string; status: SpecStatus; matches: SpecMatch[] }

function groupByFile(shown: SpecMatch[]): FileGroup[] {
  const groups: FileGroup[] = []
  for (const match of shown) {
    const last = groups[groups.length - 1]
    if (last && last.file === match.file) last.matches.push(match)
    else groups.push({ file: match.file, feature: match.feature, status: match.status, matches: [match] })
  }
  return groups
}

function render(shown: SpecMatch[], total: number, specs: number): string {
  const out: string[] = []
  for (const group of groupByFile(shown)) {
    if (out.length) out.push('')
    out.push(`${group.file}: ${group.feature} [${group.status}]`)
    out.push(...renderMatches(group.matches))
  }
  const inSpecs = new Set(shown.map((m) => m.file)).size
  out.push('', `${total} match${total === 1 ? '' : 'es'} in ${specs} spec${specs === 1 ? '' : 's'} searched, ${shown.length} shown from ${inSpecs}.`)
  return out.join('\n')
}

function renderMatches(matches: SpecMatch[]): string[] {
  const out: string[] = []
  let section = ''
  for (const match of matches) {
    if (match.kind === 'goal') {
      out.push(`  goal: ${match.text.replace(/\s*\n\s*/g, ' ')}`)
      continue
    }
    const heading = match.kind === 'question' ? 'Open questions' : match.scenario!
    if (heading !== section) {
      out.push(`  ## ${heading}`)
      section = heading
    }
    out.push(`  - **${match.name}**: ${cited(match.text, match.citation)}`)
    for (const edge of match.edges) out.push(`    - **${edge.name}**: ${cited(edge.text, edge.citation)}`)
  }
  return out
}
