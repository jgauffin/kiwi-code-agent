import { describe, expect, it } from 'vitest'
import { DOCS_MAP_ROOT } from '../src/agent/docs-map/map-files'
import { docsMapContext, withDocsMap, type DocsMapSource } from '../src/agent/docs-map/session-context'
import { blindPlanScope } from '../src/agent/phases/blind-plan'
import { docsMapScope } from '../src/agent/phases/docs-map'
import { ScopeGuard } from '../src/agent/phases/scope-guard'

const BASE = 'You are planning a feature, blind to the code.'
const SUMMARY = '### docs/intent/orders.md\nHow orders work.\n- `#Cancellation`: when an order may be cancelled'

/** A map that never needs building and always reads the same. */
const fixedSource = (summary: string | undefined): DocsMapSource => ({
  isStale: async () => false,
  build: async () => undefined,
  read: async () => summary,
})

describe('the docs map at session start', () => {
  it('a_plan_and_a_docs_session_get_the_map_while_a_chat_or_implement_session_does_not', async () => {
    for (const mode of ['plan', 'docs']) {
      const prompt = await withDocsMap(mode, BASE, fixedSource(SUMMARY))
      expect(prompt.startsWith(BASE), mode).toBe(true)
      expect(prompt, mode).toContain('- `#Cancellation`: when an order may be cancelled')
    }
    for (const mode of ['chat', 'reconcile', 'implement', 'cleanup']) {
      expect(await withDocsMap(mode, BASE, fixedSource(SUMMARY)), mode).toBe(BASE)
    }
  })

  it('the_map_is_named_as_coming_from_the_docs_alone_so_a_blind_session_reading_it_stays_blind', async () => {
    const prompt = await withDocsMap('plan', BASE, fixedSource(SUMMARY))
    expect(prompt).toContain('Nothing in it comes from anywhere but the docs themselves.')
    expect(prompt).toContain('it says nothing the docs do not')
  })

  it('the_maps_root_is_in_no_sessions_read_scope_because_the_map_rides_in_the_prompt_whole', async () => {
    const cwd = process.cwd()
    const use = (guard: ScopeGuard, toolName: string, input: unknown) => guard.preToolUse({ toolName, input, toolUseId: 't' })
    const plan = new ScopeGuard(cwd, blindPlanScope('Order cancellation'))
    const summary = `${DOCS_MAP_ROOT}/summary.md`
    expect(await use(plan, 'Read', { file_path: summary })).toMatchObject({ deny: expect.stringContaining(`Cannot read ${summary}`) })
    expect(await use(plan, 'Glob', { pattern: '**/*.md', path: DOCS_MAP_ROOT })).toMatchObject({ deny: expect.any(String) })
    // Not even the run that writes the entries may read the composed map back.
    const run = new ScopeGuard(cwd, docsMapScope(['docs/intent/orders.md']))
    expect(await use(run, 'Read', { file_path: summary })).toMatchObject({ deny: expect.any(String) })
  })

  it('a_build_that_fails_still_starts_the_session_on_the_map_as_it_last_stood', async () => {
    const broken: DocsMapSource = {
      isStale: async () => true,
      build: async () => {
        throw new Error('the run stopped')
      },
      read: async () => SUMMARY,
    }
    const failed = await docsMapContext(broken)
    expect(failed.summary).toBe(SUMMARY)
    expect(failed.note).toContain('The docs map could not be rebuilt (the run stopped)')
    expect(failed.note).toContain('as it last stood')

    const slow: DocsMapSource = { isStale: async () => true, build: () => new Promise(() => {}), read: async () => undefined }
    const started = await docsMapContext(slow, { timeoutMs: 10 })
    expect(started.note).toContain('the build passed its time bound')
    expect(await withDocsMap('plan', BASE, slow, { timeoutMs: 10 })).toContain('No docs map is available')
  })

  it('a_stale_map_is_built_before_the_first_prompt_with_progress_shown', async () => {
    const seen: string[] = []
    let built = false
    const source: DocsMapSource = {
      isStale: async () => !built,
      build: async (onProgress) => {
        onProgress('Describing docs/intent/orders.md…')
        built = true
      },
      read: async () => (built ? SUMMARY : undefined),
    }
    const prompt = await withDocsMap('plan', BASE, source, { onProgress: (line) => seen.push(line) })
    expect(seen).toEqual(['Building the docs map…', 'Describing docs/intent/orders.md…'])
    expect(prompt).toContain("The docs map was rebuilt at this session's start.")
    expect(await withDocsMap('plan', BASE, source)).toContain("The docs map was current at this session's start.")
  })
})
