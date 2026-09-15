import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildRepoMap, mapIsStale, readSummary } from '../src/agent/repo-map/build-map'
import { listMap, mapRoot, readMapFile } from '../src/agent/repo-map/map-files'

async function withWorkspace<T>(files: Record<string, string>, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'repo-map-build-'))
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

const workspace = {
  'Shop.sln': 'Microsoft Visual Studio Solution File',
  'src/Api/Api.csproj': '<Project/>',
  'src/Api/Endpoint.cs': 'public class Endpoint\n{\n    public int Handle() => 1;\n}\n',
  'src/Core/Core.csproj': '<Project/>',
  'src/Core/Order.cs': 'public class Order\n{\n    public string Id { get; set; }\n}\n',
  'web/package.json': '{ "name": "shop-web" }',
  'web/app.ts': 'export class App {\n  start(): void {}\n}\n',
  'node_modules/dep/package.json': '{ "name": "dep" }',
}

describe('repo map build', () => {
  it('the_build_lists_the_workspaces_projects_with_path_and_kind_and_writes_a_type_index_for_each', () =>
    withWorkspace(workspace, async (dir) => {
      const result = await buildRepoMap(dir)
      expect(result.projects.map((p) => [p.name, p.path, p.kind])).toEqual([
        ['Shop', 'Shop.sln', 'solution'],
        ['Api', 'src/Api/Api.csproj', 'dotnet'],
        ['Core', 'src/Core/Core.csproj', 'dotnet'],
        ['shop-web', 'web/package.json', 'npm'],
      ])
      expect(await listMap(mapRoot(dir))).toEqual([
        'summary.md',
        'types/Api.md',
        'types/Core.md',
        'types/Shop.md',
        'types/shop-web.md',
      ])
      expect(await readSummary(dir)).toBe(result.summary + '\n')
      expect(result.summary).toContain('- Api (dotnet) `src/Api/Api.csproj` — 1 public types, index `.agent/repo-map/types/Api.md`')
      expect(await readMapFile(dir, 'types/Api.md')).toContain('public class Endpoint')
      expect(await readMapFile(dir, 'types/Api.md')).toContain('  public int Handle() => 1')
      expect(await readMapFile(dir, 'types/shop-web.md')).toContain('export class App')
      // A dependency's own manifest is not a project of this workspace.
      expect(result.projects.some((p) => p.name === 'dep')).toBe(false)
    }))

  it('a_workspace_where_no_project_is_recognised_still_gets_a_map_that_states_it_found_none', () =>
    withWorkspace({ 'notes/readme.md': 'no code here' }, async (dir) => {
      const result = await buildRepoMap(dir)
      expect(result.projects).toEqual([])
      expect(result.summary).toContain('No projects were recognised in this workspace')
      expect(await listMap(mapRoot(dir))).toEqual(['summary.md'])
      // The map exists, so the next session start does not rebuild over and over.
      expect(await mapIsStale(dir)).toBe(false)
    }))

  it('the_build_runs_host_side_with_no_engine_no_tokens_and_no_permission_prompt', async () => {
    const root = resolve(import.meta.dirname, '..', 'src', 'agent', 'repo-map')
    const forbidden = /from '.*(vscode|\/session\/|sdk-session|openai-session\/(?!tools\/glob)|permissions|anthropic)/
    for (const file of await readdir(root)) {
      const text = await readFile(join(root, file), 'utf8')
      // The one thing the build borrows from a tool is the list of directories no search descends into.
      const imports = text.split('\n').filter((line) => line.startsWith('import '))
      expect(imports.filter((line) => forbidden.test(line)), `${file} reaches for an engine`).toEqual([])
    }
    // And the build itself takes nothing but a directory: no profile, no engine, no hooks.
    await withWorkspace(workspace, async (dir) => {
      expect((await buildRepoMap(dir)).projects.length).toBe(4)
    })
  })

  it('a_map_older_than_the_newest_source_file_is_stale_and_a_fresh_one_is_not', () =>
    withWorkspace(workspace, async (dir) => {
      await buildRepoMap(dir)
      expect(await mapIsStale(dir)).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 20))
      await writeFile(join(dir, 'src', 'Api', 'Later.cs'), 'public class Later {}\n', 'utf8')
      expect(await mapIsStale(dir)).toBe(true)
    }))
})
