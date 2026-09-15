import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseGitignore, scanWorkspace } from '../src/agent/repo-map/workspace-scan'

async function withWorkspace<T>(files: Record<string, string>, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'repo-map-scan-'))
  try {
    for (const [path, text] of Object.entries(files)) {
      const full = join(dir, ...path.split('/'))
      await mkdir(join(full, '..'), { recursive: true })
      await writeFile(full, text, 'utf8')
    }
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const tree = {
  'src/Api/Endpoint.cs': 'public class Endpoint {}',
  'src/web/app.ts': 'export const a = 1',
  'src/Api/Api.csproj': '<Project/>',
  'package.json': '{}',
  'ReadMe.md': 'not source',
  'node_modules/dep/index.ts': 'export const dep = 1',
  'bin/Debug/Built.cs': 'public class Built {}',
  '.agent/repo-map/summary.md': 'generated',
  '.agent/runs/s/notes.ts': 'generated',
  'generated/Model.cs': 'public class Model {}',
  'src/web/app.generated.ts': 'export const gen = 1',
}

describe('workspace scan', () => {
  it('only_source_and_project_files_are_scanned_skipping_search_skips_the_agent_folder_and_what_gitignore_names', () =>
    withWorkspace({ ...tree, '.gitignore': '# build output\ngenerated/\n*.generated.ts\n' }, async (dir) => {
      const scan = await scanWorkspace(dir)
      expect(scan.files.map((f) => f.path)).toEqual(['package.json', 'src/Api/Api.csproj', 'src/Api/Endpoint.cs', 'src/web/app.ts'])
    }))

  it('the_newest_source_mtime_is_measured_over_the_scanned_set_alone', () =>
    withWorkspace({ ...tree, '.gitignore': 'generated/\n' }, async (dir) => {
      const old = new Date('2020-01-01T00:00:00Z')
      const recent = new Date('2024-06-01T00:00:00Z')
      const future = new Date('2030-01-01T00:00:00Z')
      for (const path of ['package.json', 'src/Api/Api.csproj', 'src/Api/Endpoint.cs', 'src/web/app.generated.ts']) {
        await utimes(join(dir, ...path.split('/')), old, old)
      }
      await utimes(join(dir, 'src', 'web', 'app.ts'), recent, recent)
      // Skipped locations do not make the map stale, however new they are.
      await utimes(join(dir, 'node_modules', 'dep', 'index.ts'), future, future)
      await utimes(join(dir, 'generated', 'Model.cs'), future, future)
      expect((await scanWorkspace(dir)).newest).toBe(recent.getTime())
    }))

  it('a_workspace_with_no_gitignore_or_an_unreadable_one_scans_on_the_built_in_skips_alone', async () => {
    const expected = ['package.json', 'generated/Model.cs', 'src/Api/Api.csproj', 'src/Api/Endpoint.cs', 'src/web/app.generated.ts', 'src/web/app.ts'].sort()
    await withWorkspace(tree, async (dir) => {
      expect((await scanWorkspace(dir)).files.map((f) => f.path)).toEqual(expected)
    })
    await withWorkspace(tree, async (dir) => {
      // A directory where the file should be: readable it is not.
      await mkdir(join(dir, '.gitignore'), { recursive: true })
      expect((await scanWorkspace(dir)).files.map((f) => f.path)).toEqual(expected)
    })
  })

  it('gitignore_rules_cover_rooted_bare_and_negated_patterns', () => {
    const ignored = parseGitignore(['dist/', '/out', '*.log', 'src/**/temp', '!keep.log'].join('\n'))
    expect(ignored('dist', true)).toBe(true)
    expect(ignored('src/dist', true)).toBe(true)
    expect(ignored('dist', false)).toBe(false)
    expect(ignored('out', true)).toBe(true)
    expect(ignored('src/out', true)).toBe(false)
    expect(ignored('src/a.log', false)).toBe(true)
    expect(ignored('src/keep.log', false)).toBe(false)
    expect(ignored('src/web/temp', true)).toBe(true)
    expect(ignored('src/web/app.ts', false)).toBe(false)
  })
})
