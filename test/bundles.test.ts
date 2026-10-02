import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readOptional } from '../src/agent/workspace-files'

vi.mock('node:child_process', () => ({ spawn: vi.fn(), exec: vi.fn() }))
import { exec, spawn } from 'node:child_process'
import {
  appliedBundles,
  appliedBundleText,
  applyBundle,
  applyBundleText,
  bundleFilePath,
  bundleMatches,
  bundleSkillNames,
  bundleSkillsPath,
  hashBundleSkills,
  installBundleSkills,
  installedSkillsHash,
  matchingBundles,
  parseAppliedBundles,
  removeBundle,
  removeBundleText,
  workspaceSignals,
  writeBundleSkill,
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
const skillBundle: Bundle = {
  source: 'product',
  name: 'bug-repro',
  version: '1.0.0',
  target: { kind: 'any' },
  text: '',
  skills: [
    {
      name: 'bug-repro',
      description: 'Reproduce a bug with a failing test before fixing it.',
      files: [
        { path: 'SKILL.md', content: '---\nname: bug-repro\ndescription: Reproduce a bug with a failing test before fixing it.\n---\nWrite the failing test first.' },
        { path: 'scripts/run.sh', content: '#!/bin/sh\necho reproducing\n' },
      ],
    },
  ],
}

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

  it('applied_bundle_text_reads_a_blocks_own_body_without_its_markers', async () => {
    await applyBundle('project', style, cwd, home)
    expect(await appliedBundleText('project', 'product', 'python-style', cwd, home)).toBe(style.text)
    expect(await appliedBundleText('project', 'product', 'never-applied', cwd, home)).toBeUndefined()
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

describe('skills-only bundle', () => {
  it('a_bundle_carrying_no_rule_text_writes_nothing_into_agents_md', async () => {
    await applyBundle('project', skillBundle, cwd, home)
    expect(await readOptional(join(cwd, 'AGENTS.md'))).toBeUndefined()
  })

  it('what_it_is_shows_only_in_the_skills_it_installed', async () => {
    await applyBundle('project', skillBundle, cwd, home)
    expect(await appliedBundles(cwd, home)).toEqual([])
    const root = bundleSkillsPath('project', cwd, home)
    expect(await readFile(join(root, 'bug-repro', 'SKILL.md'), 'utf8')).toContain('Write the failing test first.')
  })
})

describe("the skill's whole folder travels", () => {
  it('a_bundled_skill_lands_with_its_description_and_every_file_it_refers_to_by_relative_path', async () => {
    await installBundleSkills('project', skillBundle, cwd, home)
    const root = bundleSkillsPath('project', cwd, home)
    expect(await readFile(join(root, 'bug-repro', 'SKILL.md'), 'utf8')).toContain('description: Reproduce a bug with a failing test before fixing it.')
    expect(await readFile(join(root, 'bug-repro', 'scripts', 'run.sh'), 'utf8')).toBe('#!/bin/sh\necho reproducing\n')
  })

  it('a_person_scope_skill_lands_under_the_persons_own_profile', async () => {
    await writeBundleSkill(bundleSkillsPath('user', cwd, home), skillBundle.skills![0]!)
    expect(await readFile(join(home, '.kiwi', 'skills', 'bug-repro', 'SKILL.md'), 'utf8')).toContain('Write the failing test first.')
  })
})

describe('bundled skills are told apart from hand-written ones', () => {
  it('installing_a_bundles_skill_marks_it_with_the_bundles_source_name_and_version', async () => {
    await installBundleSkills('project', skillBundle, cwd, home)
    const root = bundleSkillsPath('project', cwd, home)
    const marker = JSON.parse(await readFile(join(root, 'bug-repro', '.bundle.json'), 'utf8'))
    expect(marker).toEqual({ source: 'product', name: 'bug-repro', version: '1.0.0' })
  })

  it('a_skill_written_by_hand_with_writeBundleSkill_carries_no_marker', async () => {
    const root = bundleSkillsPath('project', cwd, home)
    await writeBundleSkill(root, skillBundle.skills![0]!)
    await expect(readFile(join(root, 'bug-repro', '.bundle.json'), 'utf8')).rejects.toThrow()
  })
})

describe('nothing in a bundle runs when it is applied', () => {
  afterEach(() => vi.mocked(spawn).mockClear())

  it('applying_a_bundle_whose_skill_carries_a_script_only_writes_files_and_runs_nothing', async () => {
    await applyBundle('project', skillBundle, cwd, home)
    expect(spawn).not.toHaveBeenCalled()
    expect(exec).not.toHaveBeenCalled()
    const script = await readFile(join(bundleSkillsPath('project', cwd, home), 'bug-repro', 'scripts', 'run.sh'), 'utf8')
    expect(script).toBe('#!/bin/sh\necho reproducing\n')
  })
})

describe("an update replaces a bundle's skills whole", () => {
  it('installing_a_newer_version_drops_a_file_the_new_version_no_longer_carries', async () => {
    await installBundleSkills('project', skillBundle, cwd, home)
    const root = bundleSkillsPath('project', cwd, home)
    await expect(readFile(join(root, 'bug-repro', 'scripts', 'run.sh'), 'utf8')).resolves.toBeDefined()

    const updated: Bundle = { ...skillBundle, version: '2.0.0', skills: [{ name: 'bug-repro', description: skillBundle.skills![0]!.description, files: [skillBundle.skills![0]!.files[0]!] }] }
    await installBundleSkills('project', updated, cwd, home)

    await expect(readFile(join(root, 'bug-repro', 'scripts', 'run.sh'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(root, 'bug-repro', 'SKILL.md'), 'utf8')).toContain('Write the failing test first.')
  })

  it('installing_a_newer_version_removes_a_skill_the_new_version_no_longer_includes', async () => {
    const twoSkills: Bundle = { ...skillBundle, skills: [...skillBundle.skills!, { name: 'second-skill', description: 'Another one.', files: [{ path: 'SKILL.md', content: '# second' }] }] }
    await installBundleSkills('project', twoSkills, cwd, home)
    const root = bundleSkillsPath('project', cwd, home)
    await expect(readFile(join(root, 'second-skill', 'SKILL.md'), 'utf8')).resolves.toBeDefined()

    const droppedSecond: Bundle = { ...twoSkills, version: '2.0.0', skills: [skillBundle.skills![0]!] }
    await installBundleSkills('project', droppedSecond, cwd, home)

    await expect(readFile(join(root, 'second-skill', 'SKILL.md'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(root, 'bug-repro', 'SKILL.md'), 'utf8')).toContain('Write the failing test first.')
  })

  it('updating_a_bundle_never_touches_a_skill_it_did_not_install', async () => {
    const root = bundleSkillsPath('project', cwd, home)
    await writeBundleSkill(root, { name: 'hand-written', description: 'Written by the team.', files: [{ path: 'SKILL.md', content: '# hand written' }] })
    await installBundleSkills('project', skillBundle, cwd, home)

    const updated: Bundle = { ...skillBundle, version: '2.0.0' }
    await installBundleSkills('project', updated, cwd, home)

    expect(await readFile(join(root, 'hand-written', 'SKILL.md'), 'utf8')).toContain('hand written')
  })
})

describe('skill changed by hand', () => {
  it('installed_skill_files_hash_the_same_as_the_bundle_until_a_file_is_edited_by_hand', async () => {
    await installBundleSkills('project', skillBundle, cwd, home)
    const written = hashBundleSkills(skillBundle.skills!)
    expect(await installedSkillsHash('project', skillBundle.source, skillBundle.name, cwd, home)).toBe(written)

    const root = bundleSkillsPath('project', cwd, home)
    await writeFile(join(root, 'bug-repro', 'SKILL.md'), 'Someone changed this by hand.', 'utf8')

    expect(await installedSkillsHash('project', skillBundle.source, skillBundle.name, cwd, home)).not.toBe(written)
  })

  it('a_hand_edited_skill_applied_for_the_person_stays_under_their_own_profile_after_an_update', async () => {
    await installBundleSkills('user', skillBundle, cwd, home)
    const root = bundleSkillsPath('user', cwd, home)
    await writeFile(join(root, 'bug-repro', 'SKILL.md'), 'Someone changed this by hand.', 'utf8')

    await installBundleSkills('user', { ...skillBundle, version: '2.0.0' }, cwd, home)

    expect(await readFile(join(root, 'bug-repro', 'SKILL.md'), 'utf8')).toContain('Write the failing test first.')
    await expect(readFile(join(bundleSkillsPath('project', cwd, home), 'bug-repro', 'SKILL.md'), 'utf8')).rejects.toThrow()
  })
})

describe("removing a bundle takes its skills with it", () => {
  it('removing_a_bundle_removes_the_skills_it_installed', async () => {
    await applyBundle('project', skillBundle, cwd, home)
    const root = bundleSkillsPath('project', cwd, home)
    await expect(readFile(join(root, 'bug-repro', 'SKILL.md'), 'utf8')).resolves.toBeDefined()

    await removeBundle('project', skillBundle.source, skillBundle.name, cwd, home)

    await expect(readFile(join(root, 'bug-repro', 'SKILL.md'), 'utf8')).rejects.toThrow()
    expect(await bundleSkillNames(root, skillBundle.source, skillBundle.name)).toEqual([])
  })

  it('removing_a_bundle_leaves_a_skill_it_did_not_install_in_place', async () => {
    const root = bundleSkillsPath('project', cwd, home)
    await writeBundleSkill(root, { name: 'hand-written', description: 'Written by the team.', files: [{ path: 'SKILL.md', content: '# hand written' }] })
    await applyBundle('project', skillBundle, cwd, home)

    await removeBundle('project', skillBundle.source, skillBundle.name, cwd, home)

    expect(await readFile(join(root, 'hand-written', 'SKILL.md'), 'utf8')).toContain('hand written')
  })

  it('removing_a_bundle_with_rule_text_and_skills_drops_both', async () => {
    const withBoth: Bundle = { ...style, name: 'bug-repro', skills: skillBundle.skills! }
    await applyBundle('project', withBoth, cwd, home)

    await removeBundle('project', withBoth.source, withBoth.name, cwd, home)

    expect(await appliedBundles(cwd, home)).toEqual([])
    const root = bundleSkillsPath('project', cwd, home)
    await expect(readFile(join(root, 'bug-repro', 'SKILL.md'), 'utf8')).rejects.toThrow()
  })
})
