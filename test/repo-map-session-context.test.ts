import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { blindPlanScope } from '../src/agent/phases/blind-plan'
import { reconcileScope } from '../src/agent/phases/reconcile'
import { ScopeGuard } from '../src/agent/phases/scope-guard'
import { MAP_ROOT, listMap, mapRoot } from '../src/agent/repo-map/map-files'
import { repoMapContext, withRepoMap, workspaceRepoMap, type RepoMapSource } from '../src/agent/repo-map/session-context'

const BASE = 'You are implementing a feature.'

/** A map that never needs building and always reads the same. */
function fixedSource(summary: string | undefined): RepoMapSource {
  return {
    isStale: async () => false,
    build: async () => undefined,
    read: async () => summary,
  }
}

async function withWorkspace<T>(files: Record<string, string>, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'repo-map-session-'))
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

describe('repo map at session start', () => {
  it('a_reconcile_run_and_an_implement_session_get_the_summary_while_a_chat_or_plan_session_does_not', async () => {
    const source = fixedSource('- Core (dotnet) `src/Core/Core.csproj` — 7 public types, index `.agent/repo-map/types/Core.md`')
    for (const mode of ['reconcile', 'implement']) {
      const prompt = await withRepoMap(mode, BASE, source)
      expect(prompt.startsWith(BASE), mode).toBe(true)
      expect(prompt, mode).toContain('index `.agent/repo-map/types/Core.md`')
    }
    for (const mode of ['chat', 'plan', 'cleanup']) {
      expect(await withRepoMap(mode, BASE, source), mode).toBe(BASE)
    }
  })

  it('the_maps_root_is_in_no_plan_sessions_read_scope_while_the_reconcile_scope_names_it', async () => {
    const cwd = process.cwd()
    const index = `${MAP_ROOT}/types/Core.md`
    const use = (guard: ScopeGuard, toolName: string, input: unknown) => guard.preToolUse({ toolName, input, toolUseId: 't' })
    const plan = new ScopeGuard(cwd, blindPlanScope('Repo map'))
    expect(await use(plan, 'Read', { file_path: index })).toMatchObject({ deny: expect.stringContaining(`Cannot read ${index}`) })
    expect(await use(plan, 'Glob', { pattern: '**/*.md', path: MAP_ROOT })).toMatchObject({ deny: expect.stringContaining('Cannot search') })
    expect(await use(plan, 'Grep', { pattern: 'class', path: MAP_ROOT })).toMatchObject({ deny: expect.any(String) })
    // The same guard on the run that is given the map lets it through (F1).
    const reconcile = new ScopeGuard(cwd, reconcileScope('Repo map'))
    expect(await use(reconcile, 'Read', { file_path: index })).toBeUndefined()
  })

  it('a_missing_or_stale_map_is_built_before_the_first_prompt_with_progress_shown', async () =>
    withWorkspace({ 'src/Core/Core.csproj': '<Project/>', 'src/Core/Order.cs': 'public class Order\n{\n    public string Id { get; set; }\n}\n' }, async (dir) => {
      const seen: string[] = []
      // No map on disk yet: the prompt is not produced until the build has written one.
      const prompt = await withRepoMap('implement', BASE, workspaceRepoMap(dir), { onProgress: (line) => seen.push(line) })
      expect(await listMap(mapRoot(dir))).toEqual(['summary.md', 'types/Core.md'])
      expect(prompt).toContain('- Core (dotnet) `src/Core/Core.csproj` — 1 public types')
      expect(prompt).toContain("The repo map was rebuilt at this session's start.")
      expect(seen.length).toBeGreaterThan(0)
      // Current now, so the next start builds nothing and says so.
      const again = await withRepoMap('implement', BASE, workspaceRepoMap(dir))
      expect(again).toContain("The repo map was current at this session's start.")
    }))

  it('a_build_that_fails_or_passes_its_time_bound_still_starts_the_session_saying_which_map_it_has', async () => {
    const previous = '- Core (dotnet) `src/Core/Core.csproj` — 7 public types, index `.agent/repo-map/types/Core.md`'
    const broken: RepoMapSource = {
      isStale: async () => true,
      build: async () => {
        throw new Error('disk full')
      },
      read: async () => previous,
    }
    const failed = await repoMapContext(broken)
    expect(failed.summary).toBe(previous)
    expect(failed.note).toContain('could not be rebuilt (disk full)')
    expect(failed.note).toContain('as it last stood')

    const slow: RepoMapSource = {
      isStale: async () => true,
      build: () => new Promise(() => {}),
      read: async () => undefined,
    }
    const started = await repoMapContext(slow, { timeoutMs: 10 })
    expect(started.summary).toBeUndefined()
    expect(started.note).toContain('the build passed its time bound')
    expect(started.note).toContain('No repo map is available')
    // The start went through either way: a prompt came back, with the note in it.
    expect(await withRepoMap('reconcile', BASE, slow, { timeoutMs: 10 })).toContain('No repo map is available')
  })

  it('the_summary_a_session_starts_with_is_held_for_its_life_and_a_fresh_start_takes_a_new_one', async () => {
    let onDisk = '- Core (dotnet) `src/Core/Core.csproj` — 7 public types, index `.agent/repo-map/types/Core.md`'
    const source: RepoMapSource = {
      isStale: async () => false,
      build: async () => undefined,
      read: async () => onDisk,
    }
    const started = await withRepoMap('implement', BASE, source)
    expect(started).toContain('7 public types')
    // Another session's build, or the command, rewrites the map underneath.
    onDisk = '- Core (dotnet) `src/Core/Core.csproj` — 99 public types, index `.agent/repo-map/types/Core.md`'
    expect(started).toContain('7 public types')
    expect(started).not.toContain('99 public types')
    // A session set up afresh after its engine stopped is a start: it takes the map as it then stands.
    const restarted = await withRepoMap('implement', BASE, source)
    expect(restarted).toContain('99 public types')
  })
})
