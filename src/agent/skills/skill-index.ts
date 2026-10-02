import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { KIWI_DIR } from '../kiwi-dir'
import { readOptional } from '../workspace-files'

/** Where a bundle it was installed by came from, so a skill a bundle wrote is told apart from one written by hand. */
export type SkillBundleSource = { source: string; name: string; version: string }

/** The file a bundle's own skill install drops beside the skill's files, naming the bundle that owns it. */
export const BUNDLE_MARKER_FILE = '.bundle.json'

export type SkillEntry = {
  name: string
  /** What the skill is for and when to load it, from its frontmatter. */
  description: string
  /** Folder holding SKILL.md; relative paths inside the skill resolve here. */
  dir: string
  /** Set when a bundle installed this skill, naming it: unset for one the workspace or the person wrote by hand. */
  bundle?: SkillBundleSource
}

/** A bundle's skill that lost a name clash to the person's own and so was not applied. */
export type ShadowedBundleSkill = { name: string; bundle: SkillBundleSource }

/**
 * Skill roots in override order, later wins: the user's serve every
 * workspace, the workspace's replace them on a shared name, and at each
 * level `.kiwi/skills` (ours) beats `.claude/skills` (Claude Code's layout,
 * so one skill serves both engines).
 */
export function skillRoots(cwd: string, home = homedir()): string[] {
  return [home, cwd].flatMap((base) => [join(base, '.claude', 'skills'), join(base, KIWI_DIR, 'skills')])
}

/** Every `<root>/<folder>/SKILL.md`, one entry per name, sorted, and every bundled one a name clash left unapplied. */
export async function indexSkillsDetailed(cwd: string, home = homedir(), builtinRoot?: string): Promise<{ skills: SkillEntry[]; shadowed: ShadowedBundleSkill[] }> {
  const byName = new Map<string, SkillEntry>()
  const shadowed: ShadowedBundleSkill[] = []
  // The extension's own skills come first, so any the user or workspace defines under the same name replace them.
  for (const root of [...(builtinRoot ? [builtinRoot] : []), ...skillRoots(cwd, home)]) {
    for (const skill of await indexRoot(root)) {
      const existing = byName.get(skill.name)
      // A bundle's skill never displaces one the person or the workspace wrote by hand, whatever
      // the root order says: only another hand-written entry of the same name replaces it.
      if (existing && !existing.bundle && skill.bundle) {
        shadowed.push({ name: skill.name, bundle: skill.bundle })
        continue
      }
      byName.set(skill.name, skill)
    }
  }
  return { skills: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), shadowed }
}

/** Every `<root>/<folder>/SKILL.md`, one entry per name, sorted. */
export async function indexSkills(cwd: string, home = homedir(), builtinRoot?: string): Promise<SkillEntry[]> {
  return (await indexSkillsDetailed(cwd, home, builtinRoot)).skills
}

/** Every `<folder>/SKILL.md` under one root, unsorted and with no precedence applied: the raw read a scan over several roots is built from. */
export async function indexRoot(root: string): Promise<SkillEntry[]> {
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
    const bundle = await readBundleMarker(dir)
    skills.push({ name: frontmatter['name'] ?? folder.name, description: frontmatter['description'] ?? '', dir, ...(bundle ? { bundle } : {}) })
  }
  return skills
}

async function readBundleMarker(dir: string): Promise<SkillBundleSource | undefined> {
  const text = await readOptional(join(dir, BUNDLE_MARKER_FILE))
  return text === undefined ? undefined : (JSON.parse(text) as SkillBundleSource)
}

/**
 * One throwaway plugin folder mirroring a resolved skill list: every entry's
 * whole folder, under its own name, so an engine that only reads a plugin's
 * `skills` subfolder sees exactly what the index resolved, bundled skills
 * included like any other. Dropped and rebuilt whole each time, so a skill
 * removed since the last build does not linger.
 */
export async function writeSkillsPlugin(pluginDir: string, skills: readonly SkillEntry[]): Promise<void> {
  await rm(pluginDir, { recursive: true, force: true })
  const skillsDir = join(pluginDir, 'skills')
  await mkdir(skillsDir, { recursive: true })
  for (const skill of skills) await cp(skill.dir, join(skillsDir, skill.name), { recursive: true })
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
