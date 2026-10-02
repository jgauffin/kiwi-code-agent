import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appliedBundles, appliedBundleText, bundleFilePath, bundleSkillsPath, type Bundle } from '../src/agent/instructions/bundles'
import { PRODUCT_CATALOG_SOURCE, hashBundleText, type GitPort, type SourceCachePort } from '../src/agent/instructions/bundle-sources'
import { BundleUpkeep } from '../src/settings/bundle-upkeep'
import type { SettingsTarget } from '../src/settings/protocol'
import type { ConfigPort } from '../src/settings/settings-store'

const COMPANY = 'https://example.com/company-bundles'

let cwd: string
let home: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'upkeep-cwd-'))
  home = await mkdtemp(join(tmpdir(), 'upkeep-home-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

function fakeConfig(initial: Record<string, unknown> = {}, workspace = true) {
  const values = new Map<string, unknown>(Object.entries(initial))
  const writes: { key: string; value: unknown; target: SettingsTarget }[] = []
  const port: ConfigPort = {
    get: <T>(key: string, fallback: T): T => (values.has(key) ? (values.get(key) as T) : fallback),
    update: async (key, value, target) => {
      values.set(key, value)
      writes.push({ key, value, target })
    },
    hasWorkspace: () => workspace,
  }
  return { port, values, writes }
}

function fakeGit(catalogs: Record<string, object>): GitPort & { fetched: string[] } {
  const fetched: string[] = []
  return {
    fetched,
    fetchCatalogText: async (repo) => {
      fetched.push(repo)
      return catalogs[repo] === undefined ? undefined : JSON.stringify(catalogs[repo])
    },
  }
}

function memoryCache(): SourceCachePort {
  const store = new Map<string, { text: string; fetchedAt: string }>()
  return {
    read: async (source) => store.get(source),
    write: async (source, text, fetchedAt) => {
      store.set(source, { text, fetchedAt })
    },
  }
}

const styleV1 = { name: 'style', version: '1.0.0', text: 'Reproduce a bug before fixing it.' }
const styleV2 = { name: 'style', version: '2.0.0', text: 'Reproduce a bug before fixing it, with a test.' }
const skill = { name: 'bug-repro', description: 'Reproduce first.', files: [{ path: 'SKILL.md', content: '# Bug repro' }] }
const styleV1WithSkill = { ...styleV1, skills: [skill] }
const styleV2WithSkill = { ...styleV2, skills: [skill] }

function upkeep(config: ConfigPort, git: GitPort, answers: (string | undefined)[] = []) {
  const asked: string[] = []
  const logged: string[] = []
  const subject = new BundleUpkeep({
    config,
    ask: async (text) => {
      asked.push(text)
      return answers.shift()
    },
    log: (line) => logged.push(line),
    workspaceRoot: cwd,
    home,
    git,
    cache: memoryCache(),
  })
  return { subject, asked, logged }
}

describe('BundleUpkeep.onActivate', () => {
  it('a_source_named_but_not_accepted_is_put_to_the_person_and_an_acceptance_is_kept_for_the_person', async () => {
    const config = fakeConfig({ bundleSources: [COMPANY] })
    const git = fakeGit({ [PRODUCT_CATALOG_SOURCE]: { bundles: [] }, [COMPANY]: { bundles: [] } })
    const { subject, asked } = upkeep(config.port, git, ['Accept'])

    await subject.onActivate()

    expect(asked).toEqual([`accept "${COMPANY}" as a bundle source?`])
    expect(config.writes).toContainEqual({ key: 'bundleSources.accepted', value: [COMPANY], target: 'user' })
    expect(git.fetched).toContain(COMPANY)
  })

  it('a_source_not_accepted_is_never_fetched', async () => {
    const config = fakeConfig({ bundleSources: [COMPANY] })
    const git = fakeGit({ [PRODUCT_CATALOG_SOURCE]: { bundles: [] }, [COMPANY]: { bundles: [] } })
    const { subject } = upkeep(config.port, git, ['Not now'])

    await subject.onActivate()

    expect(git.fetched).toEqual([PRODUCT_CATALOG_SOURCE])
    expect(config.values.has('bundleSources.accepted')).toBe(false)
  })

  it('a_required_bundle_is_applied_for_the_project_and_the_text_it_was_written_with_is_recorded', async () => {
    const config = fakeConfig()
    const git = fakeGit({ [PRODUCT_CATALOG_SOURCE]: { bundles: [styleV1], required: ['style'] } })
    const { subject, logged } = upkeep(config.port, git)

    await subject.onActivate()

    expect(await appliedBundles(cwd, home)).toEqual([{ source: PRODUCT_CATALOG_SOURCE, name: 'style', version: '1.0.0', scope: 'project' }])
    const text = await appliedBundleText('project', PRODUCT_CATALOG_SOURCE, 'style', cwd, home)
    expect(config.values.get('bundleHashes')).toEqual({ [`project|${PRODUCT_CATALOG_SOURCE}|style`]: hashBundleText(text!) })
    expect(logged).toEqual(['bundles: applied 1 required bundle (style)'])
  })

  it('a_newer_version_the_person_takes_replaces_the_applied_one', async () => {
    const config = fakeConfig()
    const { subject: before } = upkeep(config.port, fakeGit({}))
    await before.port.apply('project', { ...styleV1, source: PRODUCT_CATALOG_SOURCE, target: { kind: 'any' } } satisfies Bundle)
    const { subject, asked } = upkeep(config.port, fakeGit({ [PRODUCT_CATALOG_SOURCE]: { bundles: [styleV2] } }), ['Update'])

    await subject.onActivate()

    expect(asked).toEqual(['"style" has a newer version (1.0.0 → 2.0.0).'])
    expect((await appliedBundles(cwd, home)).map((b) => b.version)).toEqual(['2.0.0'])
  })

  it('a_version_the_person_keeps_is_remembered_and_the_applied_one_stays', async () => {
    const config = fakeConfig()
    const { subject: before } = upkeep(config.port, fakeGit({}))
    await before.port.apply('project', { ...styleV1, source: PRODUCT_CATALOG_SOURCE, target: { kind: 'any' } } satisfies Bundle)
    const { subject } = upkeep(config.port, fakeGit({ [PRODUCT_CATALOG_SOURCE]: { bundles: [styleV2] } }), ['Keep this version'])

    await subject.onActivate()

    expect(config.values.get('bundleUpdatesDismissed')).toEqual({ [`project|${PRODUCT_CATALOG_SOURCE}|style`]: '2.0.0' })
    expect((await appliedBundles(cwd, home)).map((b) => b.version)).toEqual(['1.0.0'])
  })

  it('an_update_to_a_block_edited_by_hand_says_so', async () => {
    const config = fakeConfig()
    const { subject: before } = upkeep(config.port, fakeGit({}))
    await before.port.apply('project', { ...styleV1, source: PRODUCT_CATALOG_SOURCE, target: { kind: 'any' } } satisfies Bundle)
    const path = bundleFilePath('project', cwd, home)
    await writeFile(path, (await readFile(path, 'utf8')).replace(styleV1.text, 'Our own wording.'), 'utf8')
    const { subject, asked } = upkeep(config.port, fakeGit({ [PRODUCT_CATALOG_SOURCE]: { bundles: [styleV2] } }), [undefined])

    await subject.onActivate()

    expect(asked).toEqual(['"style" has a newer version (1.0.0 → 2.0.0). Its block was edited by hand since it was applied.'])
  })

  it('a_skill_file_edited_by_hand_since_it_was_installed_says_so_before_an_update_replaces_it', async () => {
    const config = fakeConfig()
    const { subject: before } = upkeep(config.port, fakeGit({}))
    await before.port.apply('project', { ...styleV1WithSkill, source: PRODUCT_CATALOG_SOURCE, target: { kind: 'any' } } satisfies Bundle)
    const skillPath = join(bundleSkillsPath('project', cwd, home), 'bug-repro', 'SKILL.md')
    await writeFile(skillPath, 'Someone changed this by hand.', 'utf8')
    const { subject, asked } = upkeep(config.port, fakeGit({ [PRODUCT_CATALOG_SOURCE]: { bundles: [styleV2WithSkill] } }), [undefined])

    await subject.onActivate()

    expect(asked).toEqual(['"style" has a newer version (1.0.0 → 2.0.0). A skill file was edited by hand since it was installed.'])
  })

  it('an_unreachable_source_never_removes_or_disables_an_installed_skill', async () => {
    const config = fakeConfig()
    const { subject: before } = upkeep(config.port, fakeGit({ [PRODUCT_CATALOG_SOURCE]: { bundles: [styleV1WithSkill] } }))
    await before.port.apply('project', { ...styleV1WithSkill, source: PRODUCT_CATALOG_SOURCE, target: { kind: 'any' } } satisfies Bundle)
    const skillPath = join(bundleSkillsPath('project', cwd, home), 'bug-repro', 'SKILL.md')
    expect(await readFile(skillPath, 'utf8')).toContain('Bug repro')

    // A fresh cache with nothing in it and a git that answers nothing: the source cannot be reached and never was.
    const { subject } = upkeep(config.port, fakeGit({}))
    await subject.onActivate()

    expect(await readFile(skillPath, 'utf8')).toContain('Bug repro')
  })

  it('without_a_project_open_nothing_is_asked_fetched_or_written', async () => {
    const config = fakeConfig({ bundleSources: [COMPANY] }, false)
    const git = fakeGit({ [PRODUCT_CATALOG_SOURCE]: { bundles: [styleV1], required: ['style'] } })
    const { subject, asked } = upkeep(config.port, git, ['Accept'])

    await subject.onActivate()

    expect(asked).toEqual([])
    expect(git.fetched).toEqual([])
    expect(config.writes).toEqual([])
    expect(await appliedBundles(cwd, home)).toEqual([])
  })
})

describe('BundleUpkeep.port', () => {
  it('removing_a_bundle_forgets_the_text_it_was_written_with', async () => {
    const config = fakeConfig()
    const { subject } = upkeep(config.port, fakeGit({}))
    await subject.port.apply('project', { ...styleV1, source: PRODUCT_CATALOG_SOURCE, target: { kind: 'any' } } satisfies Bundle)

    await subject.port.remove('project', PRODUCT_CATALOG_SOURCE, 'style')

    expect(config.values.get('bundleHashes')).toEqual({})
    expect(await appliedBundles(cwd, home)).toEqual([])
  })
})
