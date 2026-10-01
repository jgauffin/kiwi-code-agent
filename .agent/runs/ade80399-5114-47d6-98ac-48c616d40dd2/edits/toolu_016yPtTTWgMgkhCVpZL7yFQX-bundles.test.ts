import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appliedBundles,
  applyBundle,
  applyBundleText,
  bundleFilePath,
  bundleMatches,
  matchingBundles,
  parseAppliedBundles,
  removeBundle,
  removeBundleText,
  workspaceSignals,
  type Bundle,
} from '../src/agent/instructions/bundles'

let cwd: string
let home: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'bundles-cwd-'))
  home = await mkdtemp(join(tmpdir(), 'bundles-home-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

const style: Bundle = { source: 'product', name: 'python-style', version: '1.0.0', target: { kind: 'any' }, text: 'Reproduce a bug before fixing it.' }
const react: Bundle = { source: 'product', name: 'react-practice', version: '2.1.0', target: { kind: 'framework', name: 'react' }, text: 'Keep components small.' }

describe('bundleFilePath (project or person scope)', () => {
  it('a_project_scope_bundle_is_written_into_the_workspaces_agents_md_never_claude_md', () => {
    expect(bundleFilePath('project', cwd, home)).toBe(join(cwd, 'AGENTS.md'))
  })

  it('a_person_scope_bundle_is_written_into_the_agents_md_of_their_user_profile', () => {
    expect(bundleFilePath('user', cwd, home)).toBe(join(home, 'AGENTS.md'))
  })
})

describe('one marked block per bundle', () => {
  it('applying_a_bundle_writes_one_block_naming_its_source_its_name_and_its_version', () => {
    const text = applyBundleText('', style)
    expect(text).toContain('<!-- bundle source="product" name="python-style" version="1.0.0" -->')
    expect(text).toContain(style.text)
    expect(text).toContain('<!-- /bundle -->')
  })

  it('parsing_reads_every_block_a_file_holds_by_its_marker_line', () => {
    const text = applyBundleText(applyBundleText('', style), react)
    expect(parseAppliedBundles(text, 'project')).toEqual([
      { source: 'product', name: 'python-style', version: '1.0.0', scope: 'project' },
      { source: 'product', name: 'react-practice', version: '2.1.0', scope: 'project' },
    ])
  })

  it('applying_a_bundle_beside_existing_text_changes_nothing_outside_its_own_block', () => {
    const before = '# A project\n\nSome words the team already wrote.\n'
    const after = applyBundleText(before, style)
    expect(after).toContain('# A project')
    expect(after).toContain('Some words the team already wrote.')
    expect(after.indexOf('# A project')).toBeLessThan(after.indexOf('<!-- bundle'))
  })

  it('re_applying_the_same_bundle_replaces_only_its_own_block_in_place', () => {
    const before = applyBundleText('Team notes.\n', style)
    const updated: Bundle = { ...style, version: '1.1.0', text: 'Reproduce it, then write the test that proves it.' }
    const after = applyBundleText(before, updated)
    expect(after).toContain('Team notes.')
    expect(after).toContain('version="1.1.0"')
    expect(after).not.toContain('version="1.0.0"')
    expect(parseAppliedBundles(after, 'project')).toHaveLength(1)
  })

  it('removing_a_bundle_drops_only_its_own_block_and_leaves_the_rest_of_the_file', () => {
    const withBoth = applyBundleText(applyBundleText('Team notes.\n', style), react)
    const { text, removed } = removeBundleText(withBoth, 'product', 'python-style')
    expect(removed).toBe(true)
    expect(text).toContain('Team notes.')
    expect(text).toContain('react-practice')
    expect(text).not.toContain('python-style')
  })

  it('removing_a_bundle_not_applied_leaves_the_text_exactly_as_it_was', () => {
    const before = applyBundleText('Team notes.\n', style)
    const { text, removed } = removeBundleText(before, 'product', 'never-applied')
    expect(removed).toBe(false)
    expect(text).toBe(before)
  })
})

describe('applying, listing and removing a bundle on disk', () => {
  it('a_bundle_applied_for_the_project_lands_in_the_workspaces_agents_md', async () => {
    await applyBundle('project', style, cwd, home)
    const written = await readFile(join(cwd, 'AGENTS.md'), 'utf8')
    expect(written).toContain('python-style')
    await expect(readFile(join(cwd, 'CLAUDE.md'), 'utf8')).rejects.toThrow()
  })

  it('a_bundle_applied_for_the_person_lands_in_their_own_agents_md', async () => {
    await applyBundle('user', style, cwd, home)
    const written = await readFile(join(home, 'AGENTS.md'), 'utf8')
    expect(written).toContain('python-style')
  })

  it('applied_bundles_lists_both_scopes_together', async () => {
    await applyBundle('project', style, cwd, home)
    await applyBundle('user', react, cwd, home)
    const applied = await appliedBundles(cwd, home)
    expect(applied).toEqual([
      { source: 'product', name: 'python-style', version: '1.0.0', scope: 'project' },
      { source: 'product', name: 'react-practice', version: '2.1.0', scope: 'user' },
    ])
  })

  it('removing_a_bundle_drops_its_block_from_the_scopes_file', async () => {
    await applyBundle('project', style, cwd, home)
    await removeBundle('project', 'product', 'python-style', cwd, home)
    expect(await appliedBundles(cwd, home)).toEqual([])
  })
})

describe('matched by what the workspace holds', () => {
  it('a_bundle_for_nothing_in_particular_always_matches', () => {
    expect(bundleMatches({ kind: 'any' }, { languages: new Set(), frameworks: new Set() })).toBe(true)
  })

  it('a_language_bundle_matches_only_a_workspace_holding_that_language', () => {
    const holds = { languages: new Set(['typescript']), frameworks: new Set<string>() }
    expect(bundleMatches({ kind: 'language', name: 'typescript' }, holds)).toBe(true)
    expect(bundleMatches({ kind: 'language', name: 'python' }, holds)).toBe(false)
  })

  it('a_framework_bundle_matches_only_a_workspace_holding_that_framework', () => {
    const holds = { languages: new Set<string>(), frameworks: new Set(['react']) }
    expect(bundleMatches({ kind: 'framework', name: 'react' }, holds)).toBe(true)
    expect(bundleMatches({ kind: 'framework', name: 'vue' }, holds)).toBe(false)
  })

  it('matching_the_catalog_always_keeps_the_ones_that_apply_to_nothing_in_particular', () => {
    const holds = { languages: new Set<string>(), frameworks: new Set<string>() }
    expect(matchingBundles([style, react], holds)).toEqual([style])
  })

  it('workspace_signals_reads_the_language_from_source_files_and_the_framework_from_package_json', async () => {
    await writeFile(join(cwd, 'app.tsx'), 'export const x = 1\n')
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ dependencies: { react: '^18.0.0' } }))
    const holds = await workspaceSignals(cwd)
    expect(holds.languages.has('typescript')).toBe(true)
    expect(holds.frameworks.has('react')).toBe(true)
  })

  it('workspace_signals_reads_a_framework_off_a_csprojs_package_references', async () => {
    await mkdir(join(cwd, 'Api'))
    await writeFile(
      join(cwd, 'Api', 'Api.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Microsoft.AspNetCore.App" /></ItemGroup></Project>',
    )
    const holds = await workspaceSignals(cwd)
    expect(holds.languages.has('csharp')).toBe(true)
    expect(holds.frameworks.has('Microsoft.AspNetCore.App')).toBe(true)
  })
})
