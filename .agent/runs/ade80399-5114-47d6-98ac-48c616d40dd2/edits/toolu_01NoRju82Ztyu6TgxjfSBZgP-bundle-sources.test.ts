import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appliedBundles, removeBundle, type AppliedBundle } from '../src/agent/instructions/bundles'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

const { spawn } = await import('node:child_process')
const {
  PRODUCT_CATALOG_SOURCE,
  bundleSources,
  pendingSources,
  fetchableSources,
  parseCatalogSource,
  fetchSource,
  requiredBundles,
  missingRequiredBundles,
  applyRequiredBundles,
  isNewerVersion,
  bundleUpdates,
  hashBundleText,
  gitPort,
  type FetchedSource,
  type GitPort,
  type SourceCachePort,
} = await import('../src/agent/instructions/bundle-sources')

function fakeGit(responses: Record<string, string | undefined>): GitPort {
  return { fetchCatalogText: async (repo) => responses[repo] }
}

function fakeCache(): SourceCachePort {
  const store = new Map<string, { text: string; fetchedAt: string }>()
  return {
    read: async (source) => store.get(source),
    write: async (source, text, fetchedAt) => {
      store.set(source, { text, fetchedAt })
    },
  }
}

const catalogText = JSON.stringify({
  bundles: [{ name: 'python-style', version: '1.0.0', target: { kind: 'any' }, text: 'Reproduce a bug before fixing it.' }],
  required: [],
})

describe("the product's catalog is a source without being configured", () => {
  it('is always among the sources with nothing named in settings', () => {
    expect(bundleSources([], [])).toEqual([PRODUCT_CATALOG_SOURCE])
  })
})

describe('further sources are git repositories named in settings', () => {
  it('a source named in the workspaces settings is added to the persons rather than replacing them', () => {
    expect(bundleSources(['https://person/repo.git'], ['https://workspace/repo.git'])).toEqual([
      PRODUCT_CATALOG_SOURCE,
      'https://person/repo.git',
      'https://workspace/repo.git',
    ])
  })
})

describe('fetched with the git access the person already has', () => {
  afterEach(() => vi.mocked(spawn).mockReset())

  it('fetching a source clones it with the git already on this machine and no credentials of its own', async () => {
    vi.mocked(spawn).mockImplementation((..._args: unknown[]) => {
      const child = new EventEmitter() as EventEmitter & { stdio?: unknown }
      queueMicrotask(() => child.emit('close', 1))
      return child as never
    })
    await gitPort.fetchCatalogText('https://example.com/company/bundles.git')
    expect(spawn).toHaveBeenCalledTimes(1)
    const [command, args, options] = vi.mocked(spawn).mock.calls[0]! as [string, string[], Record<string, unknown>]
    expect(command).toBe('git')
    expect(args[0]).toBe('clone')
    expect(args).toContain('https://example.com/company/bundles.git')
    // No token, header or env of its own: whatever git already has configured is all it uses.
    expect(options.env).toBeUndefined()
  })
})

describe('a source is accepted before it is fetched', () => {
  it('a source the person has not accepted is not among the ones fetched, named by its repository', () => {
    const sources = bundleSources(['https://company/repo.git'], [])
    expect(pendingSources(sources, new Set())).toEqual(['https://company/repo.git'])
    expect(fetchableSources(sources, new Set())).toEqual([PRODUCT_CATALOG_SOURCE])
  })

  it('accepting a source makes it one of the ones fetched', () => {
    const sources = bundleSources(['https://company/repo.git'], [])
    const accepted = new Set(['https://company/repo.git'])
    expect(pendingSources(sources, accepted)).toEqual([])
    expect(fetchableSources(sources, accepted)).toEqual([PRODUCT_CATALOG_SOURCE, 'https://company/repo.git'])
  })
})

describe('source that arrived with the workspace', () => {
  it('a source named only by the workspace is pending acceptance the same as one the person named themselves', () => {
    const sources = bundleSources([], ['https://workspace/repo.git'])
    expect(pendingSources(sources, new Set())).toEqual(['https://workspace/repo.git'])
  })
})

describe('unreachable source falls back to the last fetch', () => {
  it('a source fetched once and then unreachable offers the bundles last fetched, dated to that fetch', async () => {
    const cache = fakeCache()
    const stamps = ['2024-01-01T00:00:00.000Z']
    let i = 0
    const now = () => stamps[i++]!
    const first = await fetchSource('repo', fakeGit({ repo: catalogText }), cache, now)
    expect(first.reachable).toBe(true)
    expect(first.asOf).toBeUndefined()

    const second = await fetchSource('repo', fakeGit({ repo: undefined }), cache, now)
    expect(second.reachable).toBe(false)
    expect(second.asOf).toBe('2024-01-01T00:00:00.000Z')
    expect(second.bundles).toEqual([
      { source: 'repo', name: 'python-style', version: '1.0.0', target: { kind: 'any' }, text: 'Reproduce a bug before fixing it.', asOf: '2024-01-01T00:00:00.000Z' },
    ])
  })

  it('a source never fetched offers nothing', async () => {
    const result = await fetchSource('repo', fakeGit({ repo: undefined }), fakeCache())
    expect(result).toEqual({ source: 'repo', bundles: [], required: [], reachable: false })
  })
})

describe('rule text only', () => {
  it('a bundle entry carrying a command, a tool, a permission or a setting contributes only its rule text', () => {
    const text = JSON.stringify({
      bundles: [
        {
          name: 'tests-first',
          version: '1.0.0',
          target: { kind: 'any' },
          text: 'Write the test before the fix.',
          command: 'rm -rf /',
          tool: 'Bash',
          permissions: { allow: ['*'] },
          settings: { traceEngine: true },
        },
      ],
      required: [],
    })
    expect(parseCatalogSource(text, 'company').bundles).toEqual([
      { source: 'company', name: 'tests-first', version: '1.0.0', target: { kind: 'any' }, text: 'Write the test before the fix.' },
    ])
  })
})

let cwd: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'bundle-sources-cwd-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

const requiredSource = (version = '1.0.0'): FetchedSource => ({
  source: 'company',
  bundles: [{ source: 'company', name: 'tests-first', version, target: { kind: 'any' }, text: 'Write the test before the fix.' }],
  required: ['tests-first'],
  reachable: true,
})

describe('a source may require bundles', () => {
  it('a required bundle is applied for the project the first time its source is used in a workspace', async () => {
    const applied = await applyRequiredBundles([requiredSource()], [], cwd)
    expect(applied).toEqual([{ source: 'company', name: 'tests-first', version: '1.0.0', scope: 'project' }])
    const written = await readFile(join(cwd, 'AGENTS.md'), 'utf8')
    expect(written).toContain('tests-first')
  })

  it('missingRequiredBundles finds nothing once the required bundle is already applied', () => {
    const already: AppliedBundle[] = [{ source: 'company', name: 'tests-first', version: '1.0.0', scope: 'project' }]
    expect(missingRequiredBundles(requiredBundles([requiredSource()]), already)).toEqual([])
  })
})

describe('a required bundle comes back', () => {
  it('a required bundle whose block was removed is applied again, with a line naming the source that requires it', async () => {
    await applyRequiredBundles([requiredSource()], [], cwd)
    await removeBundle('project', 'company', 'tests-first', cwd)
    expect(await appliedBundles(cwd)).toEqual([])

    const reapplied = await applyRequiredBundles([requiredSource()], [], cwd)
    expect(reapplied).toEqual([{ source: 'company', name: 'tests-first', version: '1.0.0', scope: 'project' }])
    const written = await readFile(join(cwd, 'AGENTS.md'), 'utf8')
    expect(written).toContain('Required by the `company` bundle source')
  })
})

describe('updates are never silent', () => {
  const applied: AppliedBundle[] = [{ source: 's', name: 'b', version: '1.0.0', scope: 'project' }]

  it('a newer version a source holds for an applied bundle is surfaced as an update', () => {
    const fetched: FetchedSource[] = [{ source: 's', bundles: [{ source: 's', name: 'b', version: '2.0.0', target: { kind: 'any' }, text: 't' }], required: [], reachable: true }]
    expect(bundleUpdates(fetched, applied, [], new Map())).toEqual([{ source: 's', name: 'b', scope: 'project', from: '1.0.0', to: '2.0.0', handEdited: false }])
  })

  it('keeping a version silences it, but a later version past it still raises its own notice', () => {
    const keptAtV2 = new Map([['project|s|b', '2.0.0']])
    const stillV2: FetchedSource[] = [{ source: 's', bundles: [{ source: 's', name: 'b', version: '2.0.0', target: { kind: 'any' }, text: 't' }], required: [], reachable: true }]
    expect(bundleUpdates(stillV2, applied, [], keptAtV2)).toEqual([])

    const nowV3: FetchedSource[] = [{ source: 's', bundles: [{ source: 's', name: 'b', version: '3.0.0', target: { kind: 'any' }, text: 't' }], required: [], reachable: true }]
    expect(bundleUpdates(nowV3, applied, [], keptAtV2)).toEqual([{ source: 's', name: 'b', scope: 'project', from: '1.0.0', to: '3.0.0', handEdited: false }])
  })

  it('isNewerVersion compares dot-separated parts numerically', () => {
    expect(isNewerVersion('1.2.0', '1.10.0')).toBe(false)
    expect(isNewerVersion('1.10.0', '1.2.0')).toBe(true)
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
  })
})

describe('block changed by hand', () => {
  it('a block edited by hand since it was written is said before an update would replace it', () => {
    const fetched: FetchedSource[] = [{ source: 's', bundles: [{ source: 's', name: 'b', version: '2.0.0', target: { kind: 'any' }, text: 't' }], required: [], reachable: true }]
    const applied: AppliedBundle[] = [{ source: 's', name: 'b', version: '1.0.0', scope: 'project' }]
    const checks = [{ scope: 'project' as const, source: 's', name: 'b', writtenHash: hashBundleText('Original text.'), currentText: 'Someone changed this by hand.' }]
    const updates = bundleUpdates(fetched, applied, checks, new Map())
    expect(updates[0]!.handEdited).toBe(true)
  })

  it('a block left exactly as it was written is not said to be edited by hand', () => {
    const fetched: FetchedSource[] = [{ source: 's', bundles: [{ source: 's', name: 'b', version: '2.0.0', target: { kind: 'any' }, text: 't' }], required: [], reachable: true }]
    const applied: AppliedBundle[] = [{ source: 's', name: 'b', version: '1.0.0', scope: 'project' }]
    const checks = [{ scope: 'project' as const, source: 's', name: 'b', writtenHash: hashBundleText('Original text.'), currentText: 'Original text.' }]
    const updates = bundleUpdates(fetched, applied, checks, new Map())
    expect(updates[0]!.handEdited).toBe(false)
  })
})
