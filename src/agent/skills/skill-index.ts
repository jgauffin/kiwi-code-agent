import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type SkillEntry = {
  name: string
  /** What the skill is for and when to load it, from its frontmatter. */
  description: string
  /** Folder holding SKILL.md; relative paths inside the skill resolve here. */
  dir: string
}

/**
 * Workspace-relative roots, both in Claude Code's layout so one skill serves
 * both engines. `.agent/skills` is ours and wins when a name is in both.
 */
export const SKILL_ROOTS = ['.claude/skills', '.agent/skills']

/** Every `<root>/<folder>/SKILL.md` under the workspace, one entry per name, sorted. */
export async function indexSkills(cwd: string): Promise<SkillEntry[]> {
  const byName = new Map<string, SkillEntry>()
  for (const root of SKILL_ROOTS) {
    for (const skill of await indexRoot(join(cwd, root))) byName.set(skill.name, skill)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

async function indexRoot(root: string): Promise<SkillEntry[]> {
  let folders
  try {
    folders = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const skills: SkillEntry[] = []
  for (const folder of folders) {
    if (!folder.isDirectory()) continue
    const dir = join(root, folder.name)
    const text = await readOptional(join(dir, 'SKILL.md'))
    if (text === undefined) continue
    const { frontmatter } = splitFrontmatter(text)
    skills.push({ name: frontmatter['name'] ?? folder.name, description: frontmatter['description'] ?? '', dir })
  }
  return skills
}

/** The instructions the model reads when it loads the skill: SKILL.md without its frontmatter. */
export async function readSkillBody(skill: SkillEntry): Promise<string> {
  return splitFrontmatter(await readFile(join(skill.dir, 'SKILL.md'), 'utf8')).body
}

/**
 * Splits a `---` frontmatter block off a markdown file. Understands the YAML
 * subset a skill header uses: `key: value` and the `>` / `|` block scalars.
 */
export function splitFrontmatter(text: string): { frontmatter: Record<string, string>; body: string } {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { frontmatter: {}, body: text }
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  if (end === -1) return { frontmatter: {}, body: text }
  const frontmatter: Record<string, string> = {}
  for (let i = 1; i < end; i++) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]!)
    if (!match) continue
    const key = match[1]!
    const value = match[2]!.trim()
    if (/^[>|]-?$/.test(value)) {
      const block: string[] = []
      while (i + 1 < end && /^\s+\S/.test(lines[i + 1]!)) block.push(lines[++i]!.trim())
      frontmatter[key] = block.join(value.startsWith('>') ? ' ' : '\n')
    } else {
      frontmatter[key] = unquote(value)
    }
  }
  return { frontmatter, body: lines.slice(end + 1).join('\n').replace(/^\n+/, '') }
}

function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value)
  return quoted ? quoted[2]! : value
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
