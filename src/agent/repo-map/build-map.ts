import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { findConventions } from './conventions'
import { SUMMARY_FILE, byPath, mapPath, sharedBuild, summaryPath, writeMap, type MapFile } from './map-files'
import { indexPathFor, renderSummary, type MappedProject, type ProjectKind } from './summary'
import { buildTypeIndex, renderTypeIndex, type SourceFile } from './type-index'
import { isSourceFile, scanWorkspace, type ScannedFile } from './workspace-scan'

/**
 * The whole build, host-side and mechanical: walk the workspace, find the
 * projects, scan each one's source for its public surface, read the folder
 * conventions off the tree, and put the lot on disk in one replace. No engine
 * is asked anything — no model call, no tokens, no permission prompt — so a
 * session start can wait on it and the command can run it at any time.
 */

export type BuildResult = {
  /** The injected part, as it was written to `summary.md`. */
  summary: string
  projects: MappedProject[]
  /** Newest source mtime the build saw: what the next staleness check compares against. */
  newest: number
}

/** A file bigger than this is data or generated, not a public surface worth scanning. */
const MAX_FILE_BYTES = 1_000_000

type Seed = { path: string; dir: string; kind: ProjectKind; name: string }

/** Builds the map and replaces the files on disk. Two callers asking at once share one build. */
export function buildRepoMap(cwd: string, onProgress: (line: string) => void = () => {}): Promise<BuildResult> {
  return sharedBuild(cwd, () => build(cwd, onProgress))
}

async function build(cwd: string, onProgress: (line: string) => void): Promise<BuildResult> {
  onProgress('Walking the workspace…')
  const scan = await scanWorkspace(cwd)
  const seeds = await findProjects(cwd, scan.files)
  const sources = scan.files.filter((f) => isSourceFile(f.path))
  const files: MapFile[] = []
  const projects: MappedProject[] = []
  for (const seed of seeds) {
    onProgress(`Indexing ${seed.name}…`)
    const index = buildTypeIndex(await readSources(cwd, filesOf(seed, seeds, sources)))
    files.push({ path: `types/${seed.name}.md`, text: renderTypeIndex(seed.name, index) })
    projects.push({ name: seed.name, path: seed.path, kind: seed.kind, index: indexPathFor(seed.name), publicTypes: index.types.length })
  }
  const summary = renderSummary({ projects, conventions: findConventions(scan.files.map((f) => f.path)) })
  onProgress('Writing the map…')
  await writeMap(cwd, [{ path: SUMMARY_FILE, text: summary }, ...files])
  return { summary, projects, newest: scan.newest }
}

/** The map is stale when it is missing, or older than the newest file the scan measures. */
export async function mapIsStale(cwd: string): Promise<boolean> {
  const written = await stat(summaryPath(cwd))
    .then((info) => info.mtimeMs)
    .catch(() => undefined)
  if (written === undefined) return true
  return (await scanWorkspace(cwd)).newest > written
}

/** The summary as it stands on disk, or undefined when no map has been built. */
export async function readSummary(cwd: string): Promise<string | undefined> {
  try {
    return await readFile(summaryPath(cwd), 'utf8')
  } catch {
    return undefined
  }
}

/** The summary's path as a session would open it. */
export const summaryMapPath = (): string => mapPath(SUMMARY_FILE)

const dirOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

const kindOf = (path: string): ProjectKind | undefined => {
  const lower = path.toLowerCase()
  if (lower.endsWith('.sln') || lower.endsWith('.slnx')) return 'solution'
  if (/\.(cs|fs|vb)proj$/.test(lower)) return 'dotnet'
  if (lower === 'package.json' || lower.endsWith('/package.json')) return 'npm'
  return undefined
}

/** Solutions, project files and package manifests, each with the folder it owns and a name its index file can carry. */
async function findProjects(cwd: string, files: ScannedFile[]): Promise<Seed[]> {
  const seeds: Seed[] = []
  const taken = new Set<string>()
  for (const file of files) {
    const kind = kindOf(file.path)
    if (kind === undefined) continue
    const name = uniqueName(await nameOf(cwd, file.path, kind), taken)
    seeds.push({ path: file.path, dir: dirOf(file.path), kind, name })
  }
  return seeds.sort((a, b) => byPath(a.path, b.path))
}

async function nameOf(cwd: string, path: string, kind: ProjectKind): Promise<string> {
  const base = path.split('/').slice(-1)[0]!
  if (kind !== 'npm') return base.replace(/\.[^.]+$/, '')
  const declared = await readFile(join(cwd, ...path.split('/')), 'utf8')
    .then((text) => {
      const value: unknown = JSON.parse(text)
      const name = typeof value === 'object' && value !== null ? (value as { name?: unknown }).name : undefined
      return typeof name === 'string' && name.length > 0 ? name : undefined
    })
    .catch(() => undefined)
  return declared ?? dirOf(path).split('/').slice(-1)[0] ?? 'workspace'
}

/** Index file names are paths: a name is made safe and, where two projects share one, made unique. */
function uniqueName(name: string, taken: Set<string>): string {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
  let unique = safe
  for (let n = 2; taken.has(unique); n++) unique = `${safe}-${n}`
  taken.add(unique)
  return unique
}

/**
 * The source a project owns: the files under its folder that no project nested
 * deeper owns. A solution owns none — its projects do.
 */
function filesOf(seed: Seed, seeds: Seed[], sources: ScannedFile[]): string[] {
  if (seed.kind === 'solution') return []
  const nested = seeds.filter((s) => s.kind !== 'solution' && s !== seed && under(s.dir, seed.dir))
  return sources.filter((f) => under(f.path, seed.dir) && !nested.some((s) => under(f.path, s.dir))).map((f) => f.path)
}

const under = (path: string, dir: string): boolean => dir === '' || path === dir || path.startsWith(`${dir}/`)

/** Reads what the scan will parse; a file that is gone or too big is left to the index's skipped list. */
async function readSources(cwd: string, paths: string[]): Promise<SourceFile[]> {
  const sources: SourceFile[] = []
  for (const path of paths) {
    const full = join(cwd, ...path.split('/'))
    const info = await stat(full).catch(() => undefined)
    if (!info) continue
    if (info.size > MAX_FILE_BYTES) {
      sources.push({ path, text: '\u0000' })
      continue
    }
    const text = await readFile(full, 'utf8').catch(() => undefined)
    sources.push({ path, text: text ?? '\u0000' })
  }
  return sources
}
