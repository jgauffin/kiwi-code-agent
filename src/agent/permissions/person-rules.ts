import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { readOptional } from '../workspace-files'

/**
 * Permission rules kept for the person rather than for one workspace: granted
 * once, honoured in every workspace that reaches the same ground, the way
 * `~/.mcp.json` already carries the person's MCP servers into every project.
 */
export type PersonRules = { allow: string[]; deny: string[] }

const EMPTY: PersonRules = { allow: [], deny: [] }

/** Where the person's own permission rules are kept. */
export function personRulesFile(home: string = homedir()): string {
  return join(home, '.kiwi', 'permissions.json')
}

function cleaned(rules: Partial<PersonRules> | undefined): PersonRules {
  const allow = Array.isArray(rules?.allow) ? rules.allow.filter((r): r is string => typeof r === 'string') : []
  const deny = Array.isArray(rules?.deny) ? rules.deny.filter((r): r is string => typeof r === 'string') : []
  return { allow, deny }
}

export async function readPersonRules(home: string = homedir()): Promise<PersonRules> {
  const text = await readOptional(personRulesFile(home))
  if (!text) return EMPTY
  try {
    return cleaned(JSON.parse(text) as Partial<PersonRules>)
  } catch {
    return EMPTY
  }
}

export async function writePersonRules(rules: PersonRules, home: string = homedir()): Promise<void> {
  const file = personRulesFile(home)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(rules, null, 2)}\n`, 'utf8')
}

/**
 * The person's rules, read once at start-up and kept in memory from then on:
 * `preToolUse` reads permission rules synchronously, on every call, so what
 * is kept for the person has to answer the same way a session's own allow
 * list already does, with the file write trailing behind it.
 */
export class PersonRulesStore {
  private rules: PersonRules = EMPTY
  private readonly loaded: Promise<void>

  constructor(private readonly home: string = homedir()) {
    this.loaded = readPersonRules(this.home).then((rules) => {
      this.rules = rules
    })
  }

  /** Waits for the first read, so an early write is not lost under what is still loading. */
  async ready(): Promise<void> {
    await this.loaded
  }

  get(): PersonRules {
    return this.rules
  }

  /** Adds rules not already kept, as "Allow ... for me" / "Deny ... for me" do. */
  async add(kind: 'allow' | 'deny', rules: string[]): Promise<void> {
    await this.loaded
    const current = this.rules[kind]
    await this.set(kind, [...current, ...rules.filter((r) => !current.includes(r))])
  }

  /** Replaces the whole list, as editing it on the settings page does. */
  async set(kind: 'allow' | 'deny', rules: string[]): Promise<void> {
    await this.loaded
    this.rules = { ...this.rules, [kind]: rules }
    await writePersonRules(this.rules, this.home)
  }
}
