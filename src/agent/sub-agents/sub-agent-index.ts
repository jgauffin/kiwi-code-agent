import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { KIWI_DIR } from '../kiwi-dir'
import { readOptional } from '../workspace-files'
import { splitFrontmatter } from '../skills/skill-index'
import { choiceFor, type ModelProfile, type Profile, type Step } from '../session/model-profile'

/**
 * A sub agent the product ships: its own instructions and, where it must not
 * have the run of everything the caller has, the tool names it is held to.
 * Absent `tools` takes every read-only tool the calling session itself has.
 */
export type ShippedSubAgent = {
  name: string
  description: string
  /** The sub agent's own system prompt. */
  prompt: string
  tools?: string[]
}

/**
 * The quote-only lookup: it locates and quotes, never interprets, so the
 * caller rules on the material itself rather than on a summary of it.
 */
export const RETRIEVAL_SUB_AGENT: ShippedSubAgent = {
  name: 'retrieve',
  description: 'Looks something up across the code or docs and answers in verbatim excerpts, never a summary: for a question one search would not settle.',
  prompt: [
    'You are a retrieval sub agent. Find what the task asks for and answer in verbatim excerpts only: never summarise, interpret or paraphrase what you quote.',
    'For each finding, give the excerpt exactly as written, its source (a file path with the line range or heading it came from) and one line on why it answers the task.',
    'List what you looked for and could not find, as plainly as what you found.',
  ].join('\n'),
}

/**
 * The research lookup: it reaches the open internet rather than the code or the docs, so a session that
 * may not read the code can still be offered it, unlike every other shipped or defined sub agent. Searching
 * and fetching join its tools once it is wired to a session (`run-sub-agent`'s `subAgentTools`); nothing here
 * grants them on their own.
 */
export const RESEARCH_SUB_AGENT: ShippedSubAgent = {
  name: 'research',
  description: 'Searches and fetches the open internet for one question and answers in verbatim excerpts, never a summary: for intent a doc or a spec leaves unsettled.',
  prompt: [
    'You are a research sub agent, reaching the open internet for what the task asks. Find it and answer in verbatim excerpts only: never summarise, interpret or paraphrase what you quote.',
    'For each finding, give the excerpt exactly as written, the address it came from and one line on why it answers the task.',
    'List what you looked for and could not find, as plainly as what you found.',
    'If the internet cannot be reached, say so plainly and stop there: never answer from what you already know in its place.',
  ].join('\n'),
}

/** Beyond this, which further sub agents the product should ship of its own is open. */
export const SHIPPED_SUB_AGENTS: readonly ShippedSubAgent[] = [RETRIEVAL_SUB_AGENT]

/** Whether a Delegate call names the research sub agent: the one whose tools reach the open internet, so it alone needs its own permission rather than running unasked like every other delegation. */
export function isResearchDelegation(input: unknown): boolean {
  return (input as { agent?: unknown } | undefined)?.agent === RESEARCH_SUB_AGENT.name
}

/**
 * A defined sub agent follows the skills layout: a folder named `agents`
 * beside `skills`, at the same four roots, each one file rather than a
 * folder of its own. The workspace wins over the person and our own folder
 * (`.kiwi`) wins over Claude Code's (`.claude`) on a shared name.
 */
export function subAgentRoots(cwd: string, home = homedir()): string[] {
  return [home, cwd].flatMap((base) => [join(base, '.claude', 'agents'), join(base, KIWI_DIR, 'agents')])
}

export type DefinedSubAgent = {
  name: string
  description: string
  prompt: string
  tools?: string[]
  /** The model it names to run on, as the active profile's `steps` would (a model id on the same provider); absent runs on the calling session's own model. */
  model?: string
  /** The file this definition was read from. */
  file: string
}

/** A definition that took the name of a shipped sub agent: the shipped one keeps the name, so this one is never offered. */
export type ShadowedSubAgent = { name: string; file: string }

/** Every `<root>/agents/<name>.md`, one entry per name, sorted, and every definition a shipped name's clash left unapplied. */
export async function indexSubAgentsDetailed(
  cwd: string,
  home = homedir(),
  shipped: readonly ShippedSubAgent[] = SHIPPED_SUB_AGENTS,
): Promise<{ agents: DefinedSubAgent[]; shadowed: ShadowedSubAgent[] }> {
  const shippedNames = new Set(shipped.map((s) => s.name))
  const byName = new Map<string, DefinedSubAgent>()
  const shadowed: ShadowedSubAgent[] = []
  for (const root of subAgentRoots(cwd, home)) {
    for (const def of await indexRoot(root)) {
      if (shippedNames.has(def.name)) {
        shadowed.push({ name: def.name, file: def.file })
        continue
      }
      byName.set(def.name, def)
    }
  }
  return { agents: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), shadowed }
}

/** Every `<root>/agents/<name>.md`, one entry per name, sorted. */
export async function indexSubAgents(cwd: string, home = homedir(), shipped?: readonly ShippedSubAgent[]): Promise<DefinedSubAgent[]> {
  return (await indexSubAgentsDetailed(cwd, home, shipped)).agents
}

/** Every `<name>.md` directly under one root: a defined sub agent is one file, not a folder like a skill. */
async function indexRoot(root: string): Promise<DefinedSubAgent[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const defs: DefinedSubAgent[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const file = join(root, entry.name)
    const text = await readOptional(file)
    if (text === undefined) continue
    const { frontmatter, body } = splitFrontmatter(text)
    const tools = frontmatter['tools']
    const model = frontmatter['model']
    defs.push({
      name: frontmatter['name'] ?? entry.name.slice(0, -3),
      description: frontmatter['description'] ?? '',
      prompt: body,
      ...(tools ? { tools: tools.split(',').map((t) => t.trim()).filter(Boolean) } : {}),
      ...(model ? { model } : {}),
      file,
    })
  }
  return defs
}

/**
 * What a session offers the delegating tool, its name and description alone:
 * the model picks from these without a lookup. `kind` and `model` are not
 * shown to the model; they say which model the run picks it.
 */
export type SubAgentCatalogEntry = { name: string; description: string; prompt: string; tools?: string[]; kind?: 'shipped' | 'defined'; model?: string }

/** A shipped sub agent, shaped as the catalogue a delegating tool is built from takes it. */
export function shippedEntry(agent: ShippedSubAgent): SubAgentCatalogEntry {
  return { name: agent.name, description: agent.description, prompt: agent.prompt, kind: 'shipped', ...(agent.tools ? { tools: agent.tools } : {}) }
}

/**
 * The catalogue a session's delegating tool is built from: every shipped and
 * defined sub agent when the session may read the code, none of either
 * otherwise. A feature-planning session reads no code and so is offered
 * neither kind, left with only a sub agent it defines in the call itself
 * and, where its mode wires it in, the research lookup.
 */
export function offeredSubAgents(mayReadCode: boolean, shipped: readonly ShippedSubAgent[], defined: readonly DefinedSubAgent[]): SubAgentCatalogEntry[] {
  if (!mayReadCode) return []
  return [
    ...shipped.map(shippedEntry),
    ...defined.map((a) => ({
      name: a.name,
      description: a.description,
      prompt: a.prompt,
      kind: 'defined' as const,
      ...(a.tools ? { tools: a.tools } : {}),
      ...(a.model ? { model: a.model } : {}),
    })),
  ]
}

/**
 * The model a sub agent runs on: a shipped one takes the active profile's own
 * entry for its name, treated as a step of its own, same as any other phase
 * would; a defined one takes the model its definition names, on the same
 * provider; anything else, including one the call defines itself, runs on
 * the calling session's own model.
 */
export function subAgentProfile(caller: ModelProfile, entry: SubAgentCatalogEntry | undefined, profiles: readonly Profile[]): ModelProfile {
  if (!entry) return caller
  if (entry.kind === 'shipped') {
    const own = profiles.find((p) => p.name === caller.name)
    const model = own ? choiceFor(own, entry.name as Step).model : undefined
    return model ? { ...caller, model } : caller
  }
  if (entry.model) return { ...caller, model: entry.model }
  return caller
}
