import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { KIWI_DIR } from '../kiwi-dir'
import { BUNDLE_MARKER_FILE, indexRoot, type SkillBundleSource } from '../skills/skill-index'
import { readOptional } from '../workspace-files'
import { scanWorkspace } from '../repo-map/workspace-scan'

/** Where a bundle is applied: the workspace's own instructions, or the person's across every workspace. */
export type BundleScope = 'project' | 'user'

/** What a bundle applies to: no language or framework in particular, or one named one. */
export type BundleTarget = { kind: 'any' } | { kind: 'language'; name: string } | { kind: 'framework'; name: string }

/** One file a bundled skill carries, by the path relative to its own folder that the rest of the skill refers to. */
export type BundleSkillFile = { path: string; content: string }

/** A skill a bundle carries: its name and description for showing before it is applied, and every file its folder holds so a template or a script it ships is complete where it lands. */
export type BundleSkill = { name: string; description: string; files: BundleSkillFile[] }

/** A bundle as the catalog offers it: rule text, skills, or both, named by where it comes from, what it is called, and its version. */
export type Bundle = {
  source: string
  name: string
  version: string
  target: BundleTarget
  /** Empty when this bundle carries no rule text: a skills-only bundle writes nothing into `AGENTS.md`. */
  text: string
  /** The skills this bundle carries, if any. */
  skills?: BundleSkill[]
  /** Set when its source could not be reached just now and this is the copy last fetched, not what the source holds today. */
  asOf?: string
}

/** A bundle as a block in a file names itself: what applying it wrote, whether or not that name still has a catalog entry behind it. */
export type AppliedBundle = { source: string; name: string; version: string; scope: BundleScope }

/** Where a catalog of bundles comes from. A later feature fills this with the git sources a person or a workspace names; until then it answers with whatever it is given. */
export type BundleCatalogPort = {
  /** Every bundle in the catalog, from every accepted source, for browsing. */
  available(): Promise<Bundle[]>
}

/**
 * A bundle's own file: the workspace's `AGENTS.md` for the project, the
 * person's own under their home directory for themselves. Never `CLAUDE.md`,
 * which is Claude Code's own name and not the cross-tool one a bundle is
 * written into.
 */
export function bundleFilePath(scope: BundleScope, cwd: string, home: string = homedir()): string {
  return scope === 'project' ? join(cwd, 'AGENTS.md') : join(home, 'AGENTS.md')
}

const BLOCK_START = /^<!--\s*bundle\s+source="([^"]*)"\s+name="([^"]*)"\s+version="([^"]*)"\s*-->\s*$/
const BLOCK_END = '<!-- /bundle -->'

type Block = { start: number; end: number; source: string; name: string; version: string }

/** Every marked block in the file, in the order they appear. A start marker with no matching end is not a block and is left alone. */
function findBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = BLOCK_START.exec(lines[i]!.trim())
    if (!m) continue
    const end = lines.findIndex((l, j) => j > i && l.trim() === BLOCK_END)
    if (end === -1) continue
    blocks.push({ start: i, end, source: m[1]!, name: m[2]!, version: m[3]! })
    i = end
  }
  return blocks
}

/** The text of one block, naming its source, its name and its version on the marker line that opens it. */
function blockText(bundle: Pick<Bundle, 'source' | 'name' | 'version' | 'text'>): string {
  return `<!-- bundle source="${bundle.source}" name="${bundle.name}" version="${bundle.version}" -->\n${bundle.text.trim()}\n${BLOCK_END}`
}

/** What the file says outside its bundle blocks: the part that is the person's own to write. */
export function ownText(text: string): string {
  const lines = text.split(/\r?\n/)
  const inBlock = new Set(findBlocks(lines).flatMap((b) => Array.from({ length: b.end - b.start + 1 }, (_, i) => b.start + i)))
  return lines.filter((_, i) => !inBlock.has(i)).join('\n')
}

/** Every bundle a file's blocks name, read straight off the marker lines. */
export function parseAppliedBundles(text: string, scope: BundleScope): AppliedBundle[] {
  return findBlocks(text.split(/\r?\n/)).map((b) => ({ source: b.source, name: b.name, version: b.version, scope }))
}

/**
 * Writes one bundle's block into a file's text: over its own block when the
 * same source and name already has one, appended otherwise. Nothing outside
 * the block is touched either way.
 */
export function applyBundleText(text: string, bundle: Bundle): string {
  const lines = text.split(/\r?\n/)
  const blocks = findBlocks(lines)
  const existing = blocks.find((b) => b.source === bundle.source && b.name === bundle.name)
  const block = blockText(bundle)
  if (existing) return [...lines.slice(0, existing.start), block, ...lines.slice(existing.end + 1)].join('\n')
  const needsBlankLine = lines.length > 0 && lines[lines.length - 1]!.trim() !== ''
  return [...(needsBlankLine ? [...lines, ''] : lines), block, ''].join('\n')
}

/** Drops one bundle's block from a file's text, the blank line it was applied with alongside it. Nothing outside the block changes; a name not found leaves the text as it was. */
export function removeBundleText(text: string, source: string, name: string): { text: string; removed: boolean } {
  const lines = text.split(/\r?\n/)
  const existing = findBlocks(lines).find((b) => b.source === source && b.name === name)
  if (!existing) return { text, removed: false }
  const after = lines[existing.end + 1]?.trim() === '' ? existing.end + 1 : existing.end
  return { text: [...lines.slice(0, existing.start), ...lines.slice(after + 1)].join('\n'), removed: true }
}

/**
 * One applied bundle's own text, exactly as the file holds it right now, body
 * only, markers left out. Compared against the text last written there to
 * tell an update from a change made by hand; `undefined` when the file or
 * that block no longer exists.
 */
export async function appliedBundleText(scope: BundleScope, source: string, name: string, cwd: string, home: string = homedir()): Promise<string | undefined> {
  const current = await readOptional(bundleFilePath(scope, cwd, home))
  if (current === undefined) return undefined
  const lines = current.split(/\r?\n/)
  const block = findBlocks(lines).find((b) => b.source === source && b.name === name)
  return block ? lines.slice(block.start + 1, block.end).join('\n') : undefined
}

/** Every bundle applied for this workspace, project scope and the person's own both. */
export async function appliedBundles(cwd: string, home: string = homedir()): Promise<AppliedBundle[]> {
  const project = (await readOptional(bundleFilePath('project', cwd, home))) ?? ''
  const user = (await readOptional(bundleFilePath('user', cwd, home))) ?? ''
  return [...parseAppliedBundles(project, 'project'), ...parseAppliedBundles(user, 'user')]
}

/**
 * Applies one bundle in the given scope: its rule text into the scope's file,
 * creating it when it does not exist yet, and its skills alongside it. A
 * bundle carrying no rule text writes nothing into the file at all; what it
 * is shows only in the skills it installed.
 */
export async function applyBundle(scope: BundleScope, bundle: Bundle, cwd: string, home: string = homedir()): Promise<void> {
  if (bundle.text.trim() !== '') {
    const path = bundleFilePath(scope, cwd, home)
    const current = (await readOptional(path)) ?? ''
    await writeFile(path, applyBundleText(current, bundle), 'utf8')
  }
  await installBundleSkills(scope, bundle, cwd, home)
}

/** Where a bundle's skills land: the workspace's own skills folder for the project, the person's own under their home directory for themselves. */
export function bundleSkillsPath(scope: BundleScope, cwd: string, home: string = homedir()): string {
  return join(scope === 'project' ? cwd : home, KIWI_DIR, 'skills')
}

/**
 * Writes one bundled skill's whole folder under a skills root: every file it
 * carries, at the relative path it names itself, and, when `owner` is given,
 * the marker that tells it apart from a skill written by hand. Applying a
 * bundle only ever writes these files; a script among them runs only when a
 * session later chooses to run it.
 */
export async function writeBundleSkill(root: string, skill: BundleSkill, owner?: SkillBundleSource): Promise<void> {
  const dir = join(root, skill.name)
  for (const file of skill.files) {
    const filePath = join(dir, ...file.path.split('/'))
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, file.content, 'utf8')
  }
  if (owner) await writeFile(join(dir, BUNDLE_MARKER_FILE), JSON.stringify(owner), 'utf8')
}

/** The names of the skills under this root that this exact bundle installed, by the marker it left; empty once none of its skills are there any more. */
export async function bundleSkillNames(root: string, source: string, name: string): Promise<string[]> {
  const entries = await indexRoot(root)
  return entries.filter((entry) => entry.bundle?.source === source && entry.bundle?.name === name).map((entry) => entry.name)
}

/** One folder's own files under a skill's directory, its own marker left out, walked into every folder beneath it; a folder gone by the time it is read carries none. */
async function skillFilesUnder(dir: string, sub: string): Promise<BundleSkillFile[]> {
  let entries
  try {
    entries = await readdir(join(dir, sub), { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const files: BundleSkillFile[] = []
  for (const entry of entries) {
    const relative = sub ? `${sub}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...(await skillFilesUnder(dir, relative)))
      continue
    }
    if (relative === BUNDLE_MARKER_FILE) continue
    files.push({ path: relative, content: await readFile(join(dir, relative), 'utf8') })
  }
  return files
}

/** Every file a skill now has on disk, the bundle's own marker left out, read back to tell a hand edit from an untouched install before an update would replace it. */
export async function readInstalledSkillFiles(root: string, skillName: string): Promise<BundleSkillFile[]> {
  const files = await skillFilesUnder(join(root, skillName), '')
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

function skillsFingerprint(skills: readonly { name: string; files: readonly BundleSkillFile[] }[]): string {
  const canonical = skills
    .map((skill) => ({ name: skill.name, files: [...skill.files].sort((a, b) => a.path.localeCompare(b.path)) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

/** A hash of exactly what a bundle's skills should write, so the files actually on disk can later be compared against it to tell a hand edit from an untouched install. */
export function hashBundleSkills(skills: readonly BundleSkill[]): string {
  return skillsFingerprint(skills)
}

/** What a bundle's own skills look like on disk right now, hashed the same way as `hashBundleSkills`; `undefined` once none of them are installed any more. */
export async function installedSkillsHash(scope: BundleScope, source: string, name: string, cwd: string, home: string = homedir()): Promise<string | undefined> {
  const root = bundleSkillsPath(scope, cwd, home)
  const names = await bundleSkillNames(root, source, name)
  if (names.length === 0) return undefined
  const skills = await Promise.all(names.map(async (skillName) => ({ name: skillName, files: await readInstalledSkillFiles(root, skillName) })))
  return skillsFingerprint(skills)
}

/**
 * Writes every skill a bundle carries under the scope's own skills root,
 * marked with the bundle that installed it. A skill this bundle installed
 * before that the new version no longer carries is removed, and every skill
 * it still carries lands in a fresh folder so a file the new version drops
 * does not linger; a skill the bundle never installed is never touched.
 */
export async function installBundleSkills(scope: BundleScope, bundle: Bundle, cwd: string, home: string = homedir()): Promise<void> {
  const root = bundleSkillsPath(scope, cwd, home)
  const owner: SkillBundleSource = { source: bundle.source, name: bundle.name, version: bundle.version }
  const keep = new Set((bundle.skills ?? []).map((skill) => skill.name))
  for (const existingName of await bundleSkillNames(root, bundle.source, bundle.name)) {
    if (!keep.has(existingName)) await rm(join(root, existingName), { recursive: true, force: true })
  }
  for (const skill of bundle.skills ?? []) {
    await rm(join(root, skill.name), { recursive: true, force: true })
    await writeBundleSkill(root, skill, owner)
  }
}

/** Removes one bundle's block from the given scope's file, and the skills it installed there alongside it; nothing outside those two is touched, and a bundle with no block or no skills there now does nothing for that part. */
export async function removeBundle(scope: BundleScope, source: string, name: string, cwd: string, home: string = homedir()): Promise<void> {
  const path = bundleFilePath(scope, cwd, home)
  const current = await readOptional(path)
  if (current !== undefined) {
    const { text, removed } = removeBundleText(current, source, name)
    if (removed) await writeFile(path, text, 'utf8')
  }
  const root = bundleSkillsPath(scope, cwd, home)
  for (const skillName of await bundleSkillNames(root, source, name)) {
    await rm(join(root, skillName), { recursive: true, force: true })
  }
}

/** Languages and frameworks this workspace holds, for matching a bundle's target against. */
export type WorkspaceSignals = { languages: ReadonlySet<string>; frameworks: ReadonlySet<string> }

const CSPROJ_REFERENCE = /<PackageReference\s+Include="([^"]+)"/g

/** A language per source file extension the repo map's scan turned up, and every `.csproj` path among them for its package references to be read from next. */
function languagesAndCsprojPaths(files: readonly { path: string }[]): { languages: Set<string>; csprojPaths: string[] } {
  const languages = new Set<string>()
  const csprojPaths: string[] = []
  for (const file of files) {
    const lower = file.path.toLowerCase()
    if (lower.endsWith('.cs') || lower.endsWith('.csproj')) languages.add('csharp')
    if (lower.endsWith('.ts') || lower.endsWith('.tsx')) languages.add('typescript')
    if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) languages.add('javascript')
    if (lower.endsWith('.csproj')) csprojPaths.push(file.path)
  }
  return { languages, csprojPaths }
}

/** The frameworks the root `package.json`'s dependencies name; empty once it has none or cannot be read. */
async function frameworksFromPackageJson(cwd: string): Promise<Set<string>> {
  const frameworks = new Set<string>()
  const pkg = await readOptional(join(cwd, 'package.json'))
  if (!pkg) return frameworks
  try {
    const parsed = JSON.parse(pkg) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> }
    for (const name of [...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})]) frameworks.add(name)
  } catch {
    // An unreadable manifest names no frameworks; it is still a workspace a bundle can be applied to by hand.
  }
  return frameworks
}

/** The frameworks every named `.csproj`'s package references name. */
async function frameworksFromCsproj(cwd: string, csprojPaths: readonly string[]): Promise<Set<string>> {
  const frameworks = new Set<string>()
  for (const path of csprojPaths) {
    const text = await readOptional(join(cwd, ...path.split('/')))
    for (const m of text?.matchAll(CSPROJ_REFERENCE) ?? []) frameworks.add(m[1]!)
  }
  return frameworks
}

/**
 * What the workspace holds: a language from the source files the repo map
 * already walks for, a framework from the root `package.json`'s dependencies
 * and every `.csproj`'s package references, named exactly as those files name
 * them so a bundle's target matches them by that same name.
 */
export async function workspaceSignals(cwd: string): Promise<WorkspaceSignals> {
  const { files } = await scanWorkspace(cwd)
  const { languages, csprojPaths } = languagesAndCsprojPaths(files)
  const frameworks = await frameworksFromPackageJson(cwd)
  for (const name of await frameworksFromCsproj(cwd, csprojPaths)) frameworks.add(name)
  return { languages, frameworks }
}

/** Whether a bundle's target is what this workspace holds; a bundle for nothing in particular always matches. */
export function bundleMatches(target: BundleTarget, holds: WorkspaceSignals): boolean {
  if (target.kind === 'any') return true
  if (target.kind === 'language') return holds.languages.has(target.name)
  return holds.frameworks.has(target.name)
}

/** The catalog narrowed to what this workspace holds, the ones that apply to nothing in particular always among them. */
export function matchingBundles(bundles: readonly Bundle[], holds: WorkspaceSignals): Bundle[] {
  return bundles.filter((bundle) => bundleMatches(bundle.target, holds))
}
