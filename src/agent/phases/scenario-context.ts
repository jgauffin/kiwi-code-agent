import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { WORK_DIR, featureSlug, specPath } from './blind-plan'
import { readSpecState } from './spec-file'
import { parseSpec } from './spec-model'
import type { PostToolUseOutcome, SessionHooks, ToolUse } from '../session/hooks'
import { WRITES_NAMED_FILE } from '../permissions/tool-classes'

/**
 * The context file, `.kiwi/specs/<feature>.context.md`: the files each
 * scenario builds on, as the spec check found them while it read the code.
 * The board hands them to the scenario's task, so its implementer starts
 * there instead of searching. Its own file, since the decisions file holds
 * rulings only.
 */

export function contextFile(feature: string): string {
  return `${WORK_DIR}/${featureSlug(feature)}.context.md`
}

export function contextPath(cwd: string, feature: string): string {
  return join(cwd, contextFile(feature))
}

const TITLE = /^#\s+/
const SCENARIO = /^##\s+(.+?)\s*$/
const PATH = /^[-*]\s+`?([^`]+?)`?\s*$/

/** Files by scenario title as written, in the order given; a problem per line that is neither. */
export function parseScenarioContext(text: string): { byScenario: Map<string, string[]>; problems: string[] } {
  const byScenario = new Map<string, string[]>()
  const problems: string[] = []
  let current: string[] | undefined
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0 || TITLE.test(line)) continue
    const scenario = SCENARIO.exec(line)
    if (scenario) {
      current = byScenario.get(scenario[1]!) ?? []
      byScenario.set(scenario[1]!, current)
      continue
    }
    const path = PATH.exec(line)
    if (path && current) current.push(path[1]!.trim())
    else problems.push(`"${line}": the file holds \`## Scenario\` headings with \`- path\` lines under them, nothing else.`)
  }
  return { byScenario, problems }
}

/** The files each scenario builds on; none when no check has written the file. */
export async function readScenarioContext(path: string): Promise<Map<string, string[]>> {
  try {
    return parseScenarioContext(await readFile(path, 'utf8')).byScenario
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
    throw error
  }
}

/**
 * Tells the check, right after it wrote the context file, what the board
 * cannot use: a heading that names no scenario of the spec reaches no task,
 * and a path that does not exist sends the implementer looking for it.
 */
export class ScenarioContextContract implements SessionHooks {
  constructor(
    private readonly cwd: string,
    private readonly feature: string,
  ) {}

  async postToolUse(tool: ToolUse & { output: string; isError: boolean }): Promise<PostToolUseOutcome> {
    if (tool.isError || !WRITES_NAMED_FILE.has(tool.toolName)) return undefined
    const input = (typeof tool.input === 'object' && tool.input !== null ? tool.input : {}) as Record<string, unknown>
    const raw = input['file_path']
    if (typeof raw !== 'string') return undefined
    const path = isAbsolute(raw) ? raw : resolve(this.cwd, raw)
    const file = contextFile(this.feature)
    if (relative(this.cwd, path).split('\\').join('/') !== file) return undefined
    const { byScenario, problems } = parseScenarioContext(await readFile(path, 'utf8'))
    const titles = await this.scenarioTitles()
    for (const [scenario, paths] of byScenario) {
      if (!titles.some((t) => same(t, scenario))) problems.push(`"## ${scenario}" names no scenario of the spec; the headings are: ${titles.join(', ')}.`)
      for (const p of paths) if (!(await this.exists(p))) problems.push(`"${p}" under "${scenario}" does not exist in the workspace.`)
    }
    if (problems.length === 0) return undefined
    return { additionalContext: [`\`${file}\` needs fixing before you stop:`, ...problems.map((p) => `- ${p}`)].join('\n') }
  }

  private async scenarioTitles(): Promise<string[]> {
    const spec = await readSpecState(specPath(this.cwd, this.feature))
    return spec.exists ? parseSpec(spec.body).scenarios.map((s) => s.title) : []
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await stat(isAbsolute(path) ? path : join(this.cwd, path))
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()
