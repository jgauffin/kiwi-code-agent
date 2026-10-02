import { homedir } from 'node:os'
import { appliedBundles, appliedBundleText, applyBundle, hashBundleSkills, installedSkillsHash, matchingBundles, removeBundle, workspaceSignals, type BundleScope } from '../agent/instructions/bundles'
import {
  applyRequiredBundles,
  bundleSources,
  bundleUpdates,
  fetchableSources,
  fetchSource,
  fileSourceCache,
  gitPort,
  hashBundleText,
  pendingSources,
  type FetchedSource,
  type GitPort,
  type HandEditCheck,
  type SourceCachePort,
} from '../agent/instructions/bundle-sources'
import type { BundlePort, ConfigPort } from './settings-store'

export type BundleUpkeepDeps = {
  /** The `kiwiAgent` keys naming bundle sources and remembering the person's answers about them; read fresh each time, written back under the same key. */
  config: ConfigPort
  /** Puts a question to the person; the answer is one of `choices`, or undefined when dismissed. */
  ask(text: string, ...choices: string[]): Promise<string | undefined>
  log(line: string): void
  workspaceRoot: string
  home?: string
  git?: GitPort
  cache?: SourceCachePort
}

const hashKey = (scope: BundleScope, source: string, name: string): string => `${scope}|${source}|${name}`

/**
 * The bundles a workspace carries, kept in step with their sources: what the
 * settings page browses, applies and removes, and the upkeep once per
 * activation that accepts new sources, keeps required bundles applied and
 * puts newer versions to the person.
 */
export class BundleUpkeep {
  readonly port: BundlePort
  private readonly home: string
  private readonly git: GitPort
  private readonly cache: SourceCachePort

  constructor(private readonly deps: BundleUpkeepDeps) {
    this.home = deps.home ?? homedir()
    this.git = deps.git ?? gitPort
    this.cache = deps.cache ?? fileSourceCache(this.home)
    const { workspaceRoot } = deps
    this.port = {
      available: async () => (await this.fetchAll()).flatMap((source) => source.bundles),
      matching: async () => matchingBundles(await this.port.available(), await workspaceSignals(workspaceRoot)),
      applied: () => appliedBundles(workspaceRoot, this.home),
      apply: async (scope, bundle) => {
        await applyBundle(scope, bundle, workspaceRoot, this.home)
        // A skills-only bundle writes no block, so there is no text to hash against a later hand edit.
        if (bundle.text.trim() !== '') await this.recordHash(scope, bundle.source, bundle.name, hashBundleText(bundle.text))
        if ((bundle.skills?.length ?? 0) > 0) await this.recordSkillHash(scope, bundle.source, bundle.name, hashBundleSkills(bundle.skills!))
      },
      remove: async (scope, source, name) => {
        await removeBundle(scope, source, name, workspaceRoot, this.home)
        await this.clearHash(scope, source, name)
        await this.clearSkillHash(scope, source, name)
      },
    }
  }

  /** A source newly named is offered for acceptance, a source's required bundles are kept applied, and a newer version is put to the person; only with a real project open. */
  async onActivate(): Promise<void> {
    if (!this.deps.config.hasWorkspace()) return
    await this.acceptNewSources()
    const fetched = await this.fetchAll()
    await this.keepRequiredApplied(fetched)
    await this.offerUpdates(fetched)
  }

  private named(): string[] {
    const { config } = this.deps
    return bundleSources(config.get<string[]>('bundleSources', []), config.get<string[]>('projectBundleSources', []))
  }

  private accepted(): string[] {
    return this.deps.config.get<string[]>('bundleSources.accepted', [])
  }

  private hashes(): Record<string, string> {
    return this.deps.config.get<Record<string, string>>('bundleHashes', {})
  }

  private skillHashes(): Record<string, string> {
    return this.deps.config.get<Record<string, string>>('bundleSkillHashes', {})
  }

  private fetchAll(): Promise<FetchedSource[]> {
    return Promise.all(fetchableSources(this.named(), new Set(this.accepted())).map((source) => fetchSource(source, this.git, this.cache)))
  }

  /** A bundle's block was last written with this text; kept per workspace so a later hand edit can be told from an update before it replaces it. */
  private async recordHash(scope: BundleScope, source: string, name: string, hash: string): Promise<void> {
    if (!this.deps.config.hasWorkspace()) return
    await this.deps.config.update('bundleHashes', { ...this.hashes(), [hashKey(scope, source, name)]: hash }, 'workspace')
  }

  private async clearHash(scope: BundleScope, source: string, name: string): Promise<void> {
    if (!this.deps.config.hasWorkspace()) return
    const rest = { ...this.hashes() }
    delete rest[hashKey(scope, source, name)]
    await this.deps.config.update('bundleHashes', rest, 'workspace')
  }

  /** A bundle's skills were last written to match this hash; kept per workspace so a later hand edit to one of their files can be told from an update before it replaces them. */
  private async recordSkillHash(scope: BundleScope, source: string, name: string, hash: string): Promise<void> {
    if (!this.deps.config.hasWorkspace()) return
    await this.deps.config.update('bundleSkillHashes', { ...this.skillHashes(), [hashKey(scope, source, name)]: hash }, 'workspace')
  }

  private async clearSkillHash(scope: BundleScope, source: string, name: string): Promise<void> {
    if (!this.deps.config.hasWorkspace()) return
    const rest = { ...this.skillHashes() }
    delete rest[hashKey(scope, source, name)]
    await this.deps.config.update('bundleSkillHashes', rest, 'workspace')
  }

  private async acceptNewSources(): Promise<void> {
    for (const repo of pendingSources(this.named(), new Set(this.accepted()))) {
      const choice = await this.deps.ask(`accept "${repo}" as a bundle source?`, 'Accept', 'Not now')
      if (choice === 'Accept') await this.deps.config.update('bundleSources.accepted', [...this.accepted(), repo], 'user')
    }
  }

  private async keepRequiredApplied(fetched: FetchedSource[]): Promise<void> {
    const { workspaceRoot } = this.deps
    const newlyRequired = await applyRequiredBundles(fetched, await appliedBundles(workspaceRoot, this.home), workspaceRoot, this.home)
    for (const bundle of newlyRequired) {
      const text = await appliedBundleText(bundle.scope, bundle.source, bundle.name, workspaceRoot, this.home)
      if (text !== undefined) await this.recordHash(bundle.scope, bundle.source, bundle.name, hashBundleText(text))
      const full = fetched.find((source) => source.source === bundle.source)?.bundles.find((b) => b.name === bundle.name)
      if (full?.skills?.length) await this.recordSkillHash(bundle.scope, bundle.source, bundle.name, hashBundleSkills(full.skills))
    }
    if (newlyRequired.length > 0) {
      this.deps.log(`bundles: applied ${newlyRequired.length} required bundle${newlyRequired.length === 1 ? '' : 's'} (${newlyRequired.map((b) => b.name).join(', ')})`)
    }
  }

  private async offerUpdates(fetched: FetchedSource[]): Promise<void> {
    const { config, workspaceRoot } = this.deps
    const applied = await appliedBundles(workspaceRoot, this.home)
    const checks: HandEditCheck[] = await Promise.all(
      applied.map(async (a) => ({
        scope: a.scope,
        source: a.source,
        name: a.name,
        writtenHash: this.hashes()[hashKey(a.scope, a.source, a.name)],
        currentText: await appliedBundleText(a.scope, a.source, a.name, workspaceRoot, this.home),
        writtenSkillsHash: this.skillHashes()[hashKey(a.scope, a.source, a.name)],
        currentSkillsHash: await installedSkillsHash(a.scope, a.source, a.name, workspaceRoot, this.home),
      })),
    )
    const dismissed = new Map(Object.entries(config.get<Record<string, string>>('bundleUpdatesDismissed', {})))
    for (const update of bundleUpdates(fetched, applied, checks, dismissed)) {
      const notes: string[] = []
      if (update.handEdited) notes.push(' Its block was edited by hand since it was applied.')
      if (update.skillHandEdited) notes.push(' A skill file was edited by hand since it was installed.')
      const choice = await this.deps.ask(`"${update.name}" has a newer version (${update.from} → ${update.to}).${notes.join('')}`, 'Update', 'Keep this version')
      if (choice === 'Update') {
        const candidate = fetched.find((source) => source.source === update.source)?.bundles.find((b) => b.name === update.name)
        if (candidate) await this.port.apply(update.scope, candidate)
      } else if (choice === 'Keep this version') {
        const kept = config.get<Record<string, string>>('bundleUpdatesDismissed', {})
        await config.update('bundleUpdatesDismissed', { ...kept, [hashKey(update.scope, update.source, update.name)]: update.to }, 'workspace')
      }
    }
  }
}
