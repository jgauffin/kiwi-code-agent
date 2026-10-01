import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { readOptional } from '../workspace-files'
import { KIWI_DIR } from '../kiwi-dir'
import { applyBundle, type AppliedBundle, type Bundle, type BundleScope, type BundleTarget } from './bundles'

/** The product's own bundle repository: always a source, named nowhere, so a bundle reaches everyone by a pull request against it. */
export const PRODUCT_CATALOG_SOURCE = 'https://github.com/jgauffin/kiwipow-agent-bundles'

/** The file a source repository names its bundles in, at its root. */
export const CATALOG_FILE = 'bundles.json'

/** Every source in force for a workspace: the product's own first, then the person's named ones, then the workspace's — added to the person's, never replacing them. */
export function bundleSources(personSources: readonly string[], workspaceSources: readonly string[]): string[] {
  const seen = new Set<string>()
  return [PRODUCT_CATALOG_SOURCE, ...personSources, ...workspaceSources].filter((source) => (seen.has(source) ? false : (seen.add(source), true)))
}

/**
 * The named sources the person has not accepted yet, by their repository —
 * the product's own needs no acceptance, it ships configured. A source named
 * by the workspace is held to the same gate as one the person named
 * themselves: nothing about where it was named excuses it.
 */
export function pendingSources(sources: readonly string[], accepted: ReadonlySet<string>): string[] {
  return sources.filter((source) => source !== PRODUCT_CATALOG_SOURCE && !accepted.has(source))
}

/** The sources actually fetched: the product's own and every one the person has accepted. */
export function fetchableSources(sources: readonly string[], accepted: ReadonlySet<string>): string[] {
  return sources.filter((source) => source === PRODUCT_CATALOG_SOURCE || accepted.has(source))
}

const targetSchema: z.ZodType<BundleTarget> = z.union([
  z.object({ kind: z.literal('any') }),
  z.object({ kind: z.literal('language'), name: z.string() }),
  z.object({ kind: z.literal('framework'), name: z.string() }),
])

/**
 * A bundle entry as a source repository's catalog may write it. `.passthrough()`
 * lets a command, a tool, a permission or a setting ride along without
 * failing the parse; only `name`, `version`, `target` and `text` are ever
 * read off it, so anything else carried in it is ignored, not acted on.
 */
const catalogEntrySchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    target: targetSchema.default({ kind: 'any' }),
    text: z.string(),
  })
  .passthrough()

const catalogSchema = z.object({
  bundles: z.array(catalogEntrySchema).default([]),
  /** Bundle names this source requires, applied for the project the first time the source is used in a workspace. */
  required: z.array(z.string()).default([]),
})

/** A source's catalog, read off its own repository: its bundles, rule text only, and the names it requires. */
export type SourceCatalog = { bundles: Bundle[]; required: string[] }

/** The catalog a source's `bundles.json` holds; unreadable or malformed text names none rather than failing the fetch. */
export function parseCatalogSource(text: string, source: string): SourceCatalog {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { bundles: [], required: [] }
  }
  const parsed = catalogSchema.safeParse(json)
  if (!parsed.success) return { bundles: [], required: [] }
  return {
    bundles: parsed.data.bundles.map((entry) => ({ source, name: entry.name, version: entry.version, target: entry.target, text: entry.text })),
    required: parsed.data.required,
  }
}

/** Reads a source's catalog with the git already on this machine; `undefined` when the repository cannot be reached, with no sign-in of its own. */
export type GitPort = { fetchCatalogText(repo: string): Promise<string | undefined> }

/** The last successful fetch of a source, kept so an unreachable source still has something to offer. */
export type SourceCachePort = {
  read(source: string): Promise<{ text: string; fetchedAt: string } | undefined>
  write(source: string, text: string, fetchedAt: string): Promise<void>
}

/** A source as it came back from fetching it: its bundles and what it requires, and whether this is this moment's copy or the last one that worked. */
export type FetchedSource = { source: string; bundles: Bundle[]; required: string[]; reachable: boolean; asOf?: string }

/**
 * Fetches one source, falling back to the copy last cached when it cannot be
 * reached right now; a source never fetched before offers nothing. The
 * fallback's bundles carry the fetch's own date, so they are never shown as
 * if they were current.
 */
export async function fetchSource(source: string, git: GitPort, cache: SourceCachePort, now: () => string = () => new Date().toISOString()): Promise<FetchedSource> {
  const text = await git.fetchCatalogText(source)
  if (text !== undefined) {
    const fetchedAt = now()
    await cache.write(source, text, fetchedAt)
    const catalog = parseCatalogSource(text, source)
    return { source, ...catalog, reachable: true }
  }
  const cached = await cache.read(source)
  if (!cached) return { source, bundles: [], required: [], reachable: false }
  const catalog = parseCatalogSource(cached.text, source)
  return { source, bundles: catalog.bundles.map((bundle) => ({ ...bundle, asOf: cached.fetchedAt })), required: catalog.required, reachable: false, asOf: cached.fetchedAt }
}

/** Every bundle every fetched source offers, for browsing and applying. */
export function catalogBundles(fetched: readonly FetchedSource[]): Bundle[] {
  return fetched.flatMap((source) => source.bundles)
}

/** A bundle a source requires, named by the source that requires it. */
export type RequiredBundle = { source: string; name: string }

/** Every bundle any fetched source names as required. */
export function requiredBundles(fetched: readonly FetchedSource[]): RequiredBundle[] {
  return fetched.flatMap((source) => source.required.map((name) => ({ source: source.source, name })))
}

/** Required bundles with no block in the project's file right now: missing the first time a source is used, or because the block was later removed by hand. */
export function missingRequiredBundles(required: readonly RequiredBundle[], applied: readonly AppliedBundle[]): RequiredBundle[] {
  return required.filter((bundle) => !applied.some((a) => a.scope === 'project' && a.source === bundle.source && a.name === bundle.name))
}

/** A required bundle's own text, the source that requires it named on its own line so the block says where it will come back from if removed. */
export function requiredBundleText(source: string, text: string): string {
  return `_Required by the \`${source}\` bundle source._\n\n${text}`
}

/**
 * Applies every required bundle missing its block in the project's file —
 * the first time its source is used in this workspace, or again should the
 * block later be removed by hand — and reports what it applied.
 */
export async function applyRequiredBundles(fetched: readonly FetchedSource[], applied: readonly AppliedBundle[], cwd: string, home?: string): Promise<AppliedBundle[]> {
  const missing = missingRequiredBundles(requiredBundles(fetched), applied)
  const newlyApplied: AppliedBundle[] = []
  for (const required of missing) {
    const bundle = fetched.find((source) => source.source === required.source)?.bundles.find((b) => b.name === required.name)
    if (!bundle) continue
    await applyBundle('project', { ...bundle, text: requiredBundleText(required.source, bundle.text) }, cwd, home)
    newlyApplied.push({ source: required.source, name: required.name, version: bundle.version, scope: 'project' })
  }
  return newlyApplied
}

/** Whether `candidate` is a newer version than `current`, comparing dot-separated parts numerically; a part that is not a number sorts as 0. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parts = (version: string) => version.split('.').map((part) => (Number.isNaN(parseInt(part, 10)) ? 0 : parseInt(part, 10)))
  const a = parts(candidate)
  const b = parts(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

/** The text a block was last written with hashes to this, so a hand edit is told from an update by comparing it against the file's text now. */
export function hashBundleText(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex')
}

/** What is known about one applied bundle's block, for telling a hand edit from an untouched one before an update would replace it. */
export type HandEditCheck = { scope: BundleScope; source: string; name: string; writtenHash?: string | undefined; currentText?: string | undefined }

/** A newer version a source holds for a bundle already applied, with whether its block was edited by hand since it was written. */
export type BundleUpdate = { source: string; name: string; scope: BundleScope; from: string; to: string; handEdited: boolean }

const dismissKey = (scope: BundleScope, source: string, name: string): string => `${scope}|${source}|${name}`

/**
 * Every applied bundle a source now holds a newer version of, skipping one
 * whose person answered "keep this version" for that exact candidate — a
 * later version past the one they kept still raises its own notice.
 */
export function bundleUpdates(
  fetched: readonly FetchedSource[],
  applied: readonly AppliedBundle[],
  checks: readonly HandEditCheck[],
  dismissedVersions: ReadonlyMap<string, string>,
): BundleUpdate[] {
  const updates: BundleUpdate[] = []
  for (const a of applied) {
    const candidate = fetched.find((source) => source.source === a.source)?.bundles.find((b) => b.name === a.name)
    if (!candidate || !isNewerVersion(candidate.version, a.version)) continue
    if (dismissedVersions.get(dismissKey(a.scope, a.source, a.name)) === candidate.version) continue
    const check = checks.find((c) => c.scope === a.scope && c.source === a.source && c.name === a.name)
    const handEdited = check?.writtenHash !== undefined && check.currentText !== undefined && hashBundleText(check.currentText) !== check.writtenHash
    updates.push({ source: a.source, name: a.name, scope: a.scope, from: a.version, to: candidate.version, handEdited })
  }
  return updates
}

/**
 * Reads a source's catalog with the git already on this machine: a plain
 * `git clone`, under whatever credentials and config git itself already has
 * set up, so a private company repository needs no sign-in of the
 * extension's own. `undefined` when it cannot be reached.
 */
export const gitPort: GitPort = {
  async fetchCatalogText(repo) {
    const dir = await mkdtemp(join(tmpdir(), 'kiwi-bundle-source-'))
    try {
      const code = await new Promise<number>((resolve) => {
        const child = spawn('git', ['clone', '--depth', '1', '--quiet', repo, dir], { stdio: 'ignore', windowsHide: true })
        child.on('error', () => resolve(1))
        child.on('close', (exitCode) => resolve(exitCode ?? 1))
      })
      if (code !== 0) return undefined
      return await readOptional(join(dir, CATALOG_FILE))
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  },
}

function cacheFile(home: string, source: string): string {
  return join(home, KIWI_DIR, 'bundle-sources', `${createHash('sha256').update(source).digest('hex')}.json`)
}

/** The last fetch of each source, one file per source under the person's own `.kiwi`, so it survives this one fetch failing. */
export function fileSourceCache(home: string): SourceCachePort {
  return {
    async read(source) {
      const text = await readOptional(cacheFile(home, source))
      if (text === undefined) return undefined
      try {
        return JSON.parse(text) as { text: string; fetchedAt: string }
      } catch {
        return undefined
      }
    },
    async write(source, text, fetchedAt) {
      const path = cacheFile(home, source)
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, JSON.stringify({ text, fetchedAt }), 'utf8')
    },
  }
}
