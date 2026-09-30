import { describe, expect, it } from 'vitest'
import { ScopeGuard } from '../src/agent/phases/scope-guard'
import { CLEANUP_TOOLS, MOVES_FILE, cleanupKickoff, cleanupPrompt, cleanupScope } from '../src/agent/phases/cleanup'
import { ASK_USER_TOOL } from '../src/agent/openai-session/tools/ask-user'
import { progressLine } from '../src/agent/phases/reconcile'

const cwd = process.platform === 'win32' ? 'D:\\work\\repo' : '/work/repo'
const guard = new ScopeGuard(cwd, cleanupScope(['src/orders/cancel.ts', 'src/orders/ship.ts', 'top.ts']))
const use = (toolName: string, input: unknown) => guard.preToolUse({ toolName, input, toolUseId: 't' })

describe('ScopeGuard for a cleanup run', () => {
  it('the_flagged_files_and_new_files_beside_them_are_writable_without_a_prompt', async () => {
    expect(await use('Edit', { file_path: 'src/orders/cancel.ts' })).toEqual({ allow: true })
    expect(await use('Write', { file_path: 'src/orders/cancel-reasons.ts' })).toEqual({ allow: true })
    expect(await use('Write', { file_path: 'top-helpers.ts' })).toEqual({ allow: true })
  })

  it('files_further_away_the_spec_and_the_docs_are_read_only', async () => {
    expect(await use('Edit', { file_path: 'src/orders/sub/deep.ts' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Edit', { file_path: 'src/billing/invoice.ts' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Edit', { file_path: 'plan/orders.spec.md' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Edit', { file_path: 'docs/intent/orders.md' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Read', { file_path: 'src/billing/invoice.ts' })).toBeUndefined()
    expect(await use('Grep', { pattern: 'cancel', path: 'src' })).toBeUndefined()
  })

  it('code_that_belongs_further_away_is_recorded_in_the_moves_file_rather_than_moved', async () => {
    expect(await use('Edit', { file_path: MOVES_FILE })).toEqual({ allow: true })
    expect(await use('Write', { file_path: MOVES_FILE })).toEqual({ allow: true })
    expect(CLEANUP_TOOLS).not.toContain('Move')
  })

  it('an_unclear_intent_is_asked_rather_than_guessed', () => {
    expect(CLEANUP_TOOLS).toContain(ASK_USER_TOOL)
  })

  it('bash_is_denied_because_the_tests_run_for_the_cleanup_once_it_stops', async () => {
    expect(await use('Bash', { command: 'npm test' })).toMatchObject({ deny: expect.any(String) })
    expect(CLEANUP_TOOLS).not.toContain('Bash')
  })

  it('the_scope_lists_each_folder_once', () => {
    expect(cleanupScope(['src/a.ts', 'src/b.ts']).writable).toEqual(['src/a.ts', 'src/*', 'src/b.ts', MOVES_FILE])
  })
})

describe('cleanup prompt', () => {
  it('names_the_limits_the_scope_and_that_behaviour_stays', () => {
    const off = { functionLines: 0, typeLines: 0, fileLines: 0 }
    const prompt = cleanupPrompt('Order cancellation', cwd, { source: { functionLines: 25, typeLines: 200, fileLines: 0 }, tests: off, testGlobs: [] })
    expect(prompt).not.toContain('a file 0')
    expect(prompt).toContain('(a function 25 code lines, a type 200)')
    expect(prompt).toContain('Edit only the files listed, new files in their folders')
    expect(prompt).toContain('Keep behaviour')
    expect(prompt).toContain('the tests are run for you')
    expect(prompt).toContain(MOVES_FILE)
    expect(prompt).toContain(ASK_USER_TOOL)
  })

  it('tests_get_their_own_limits_and_stay_one_file_per_tested_file', () => {
    const prompt = cleanupPrompt('Order cancellation', cwd, {
      source: { functionLines: 25, typeLines: 0, fileLines: 400 },
      tests: { functionLines: 60, typeLines: 0, fileLines: 1200 },
      testGlobs: ['**/*.test.*'],
    })
    expect(prompt).toContain('(a function 25 code lines, a file 400; in tests a function 60 code lines, a file 1200)')
    expect(prompt).toContain('A test file stays one file per tested file')
  })

  it('the_kickoff_carries_the_report', () => {
    expect(cleanupKickoff('src/a.ts:1 a (function, 30 lines, limit 25)', false)).toContain('src/a.ts:1 a (function, 30 lines, limit 25)')
  })

  it('a_run_continuing_the_implementer_is_told_it_wrote_the_files', () => {
    const report = 'src/a.ts:1 a (function, 30 lines, limit 25)'
    const continued = cleanupKickoff(report, true)
    expect(continued).toContain(report)
    expect(continued).toContain('you wrote')
    expect(cleanupKickoff(report, false)).not.toContain('you wrote')
  })

  it('a_failure_line_is_labelled_for_the_run_it_belongs_to', () => {
    expect(progressLine({ type: 'error', message: 'boom', fatal: false }, 'Cleanup')).toBe('Cleanup failed: boom')
  })
})
