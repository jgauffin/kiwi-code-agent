import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listMap, mapPath, mapRoot, mapText, readMapFile, sharedBuild, summaryPath, writeMap } from '../src/agent/repo-map/map-files'

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'repo-map-files-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const bytes = async (dir: string): Promise<Record<string, string>> => {
  const out: Record<string, string> = {}
  for (const path of await listMap(mapRoot(dir))) out[path] = await readFile(join(mapRoot(dir), ...path.split('/')), 'utf8')
  return out
}

describe('repo map files', () => {
  it('two_builds_over_an_unchanged_tree_write_byte_identical_files', () =>
    withTempDir(async (dir) => {
      const files = [
        { path: 'summary.md', text: '# Map\r\nprojects: 2' },
        { path: 'types/web.md', text: 'class A' },
        { path: 'types/core.md', text: 'class B' },
      ]
      await writeMap(dir, files)
      const first = await bytes(dir)
      // Same content produced in another enumeration order is the same map.
      await writeMap(dir, [files[2]!, files[0]!, files[1]!])
      expect(await bytes(dir)).toEqual(first)
      expect(Object.keys(first)).toEqual(['summary.md', 'types/core.md', 'types/web.md'])
      expect(first['summary.md']).toBe('# Map\nprojects: 2\n')
    }))

  it('a_build_replaces_the_map_wholesale_so_an_edit_into_it_is_lost', () =>
    withTempDir(async (dir) => {
      await writeMap(dir, [
        { path: 'summary.md', text: 'first' },
        { path: 'types/gone.md', text: 'a project that went away' },
      ])
      await writeFile(summaryPath(dir), 'a session wrote this', 'utf8')
      await writeMap(dir, [{ path: 'summary.md', text: 'second' }])
      expect(await readMapFile(dir, 'summary.md')).toBe('second\n')
      expect(await readMapFile(dir, 'types/gone.md')).toBeUndefined()
      expect(await listMap(mapRoot(dir))).toEqual(['summary.md'])
    }))

  it('a_reader_during_a_build_sees_a_whole_file_never_a_partly_written_one', () =>
    withTempDir(async (dir) => {
      const before = mapText('old '.repeat(100_000))
      const after = mapText('new '.repeat(100_000))
      await writeMap(dir, [{ path: 'summary.md', text: before }])
      const bulk = Array.from({ length: 40 }, (_, i) => ({ path: `types/p${i}.md`, text: 'x '.repeat(20_000) }))
      let running = true
      const build = writeMap(dir, [...bulk, { path: 'summary.md', text: after }]).finally(() => {
        running = false
      })
      let reads = 0
      while (running) {
        const text = await readFile(summaryPath(dir), 'utf8')
        expect(text === before || text === after).toBe(true)
        reads++
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
      await build
      expect(reads).toBeGreaterThan(0)
      expect(await readMapFile(dir, 'summary.md')).toBe(after)
    }))

  it('two_builds_asked_for_at_once_resolve_to_a_single_build', async () => {
    let runs = 0
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = sharedBuild('ws', async () => {
      runs++
      await gate
      return 'built'
    })
    const second = sharedBuild('ws', async () => {
      runs++
      return 'a second build'
    })
    release()
    expect(await first).toBe('built')
    expect(await second).toBe('built')
    expect(runs).toBe(1)
    // Once it has ended the next caller builds again.
    expect(await sharedBuild('ws', async () => 'later')).toBe('later')
    expect(runs).toBe(1)
  })

  it('map_paths_are_workspace_relative_under_the_agent_folder', () =>
    withTempDir(async (dir) => {
      expect(mapPath('types/web.md')).toBe('.agent/repo-map/types/web.md')
      expect(mapRoot(dir)).toBe(join(dir, '.agent', 'repo-map'))
    }))
})
