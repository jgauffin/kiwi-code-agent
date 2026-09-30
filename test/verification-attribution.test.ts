import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { classifyFailure, failureFiles, narrowToFunction } from '../src/agent/phases/verification-attribution'
import { FileHands } from '../src/agent/session/file-hands'
import type { VerificationFailure } from '../src/agent/phases/verification'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'verify-attr-'))
})

afterEach(() => rm(dir, { recursive: true, force: true }))

/** Bumps the file into the future so its mtime is unmistakably different, whatever the filesystem's resolution. */
async function changeFromAnotherHand(path: string, content: string): Promise<void> {
  await writeFile(path, content)
  const later = new Date(Date.now() + 5000)
  await utimes(path, later, later)
}

describe('failureFiles', () => {
  it('reads_vitests_fail_summary_and_stack_frame_and_dotnets_stack_frame', () => {
    const output = ['FAIL test/orders.test.ts', '❯ test/orders.test.ts:12:3', 'at Object.run (src/orders.ts:5:1)', 'in /repo/Order.cs:line 9'].join('\n')
    const refs = failureFiles(output, '/repo')
    expect(refs).toEqual(
      expect.arrayContaining([
        { path: resolve('/repo', 'test/orders.test.ts'), line: 12 },
        { path: resolve('/repo', 'src/orders.ts'), line: 5 },
        { path: '/repo/Order.cs', line: 9 },
      ]),
    )
  })

  it('a_run_whose_output_names_no_file_gives_nothing_to_attribute', () => {
    expect(failureFiles('exit code 1', '/repo')).toEqual([])
  })
})

describe('narrowToFunction', () => {
  const text = (bBody: string) => ['function a() {', '  return 1', '}', '', 'function b() {', `  ${bBody}`, '}', ''].join('\n')

  it('the_same_function_reads_the_same_even_though_another_function_in_the_file_moved_on', () => {
    const own = text('return 2')
    const current = text('return 3')
    expect(narrowToFunction('a.ts', current, own, 2)).toBe(true)
  })

  it('the_changed_functions_own_line_reads_differently', () => {
    const own = text('return 2')
    const current = text('return 3')
    expect(narrowToFunction('a.ts', current, own, 6)).toBe(false)
  })
})

describe('classifyFailure', () => {
  const failureAt = (path: string, line: number): VerificationFailure => ({ command: 'npm test', cwd: dir, output: `❯ ${path}:${line}:1` })

  it('foreign_failure_a_file_no_session_of_this_feature_wrote_and_another_hand_changed_since_is_foreign', async () => {
    const path = join(dir, 'a.ts')
    await writeFile(path, 'function a() {\n  return 1\n}\n')
    const hands = new FileHands(dir, 'verify-1', 'implement', 'Order cancellation')
    const first = await stat(path)
    // This feature's own last known content of the file: recorded at its own, older, mtime.
    await hands.recordWrite(path, first.mtimeMs, 'function a() {\n  return 1\n}\n')

    await changeFromAnotherHand(path, 'function a() {\n  return 2\n}\n')

    const classification = await classifyFailure(failureAt(path, 2), hands, 'Order cancellation', dir)
    expect(classification.foreign).toBe(true)
    expect(classification.hand).toContain('outside KiwiAgent')
  })

  it('narrowed_to_the_function_a_failing_test_whose_own_function_another_hand_changed_is_foreign_even_though_this_feature_wrote_the_rest', async () => {
    const path = join(dir, 'a.ts')
    const own = 'function a() {\n  return 1\n}\n\nfunction b() {\n  return 2\n}\n'
    await writeFile(path, own)
    const hands = new FileHands(dir, 'verify-1', 'implement', 'Order cancellation')
    const first = await stat(path)
    await hands.recordWrite(path, first.mtimeMs, own)

    // Another hand touches only b(); a() reads exactly as this feature left it.
    await changeFromAnotherHand(path, 'function a() {\n  return 1\n}\n\nfunction b() {\n  return 3\n}\n')

    const onA = await classifyFailure(failureAt(path, 2), hands, 'Order cancellation', dir)
    expect(onA.foreign).toBe(false)

    const onB = await classifyFailure(failureAt(path, 6), hands, 'Order cancellation', dir)
    expect(onB.foreign).toBe(true)
  })

  it('no_other_hand_no_excuse_nothing_changed_since_this_features_own_write_so_the_failure_is_the_features', async () => {
    const path = join(dir, 'a.ts')
    await writeFile(path, 'function a() {\n  return 1\n}\n')
    const hands = new FileHands(dir, 'verify-1', 'implement', 'Order cancellation')
    const current = await stat(path)
    await hands.recordWrite(path, current.mtimeMs, 'function a() {\n  return 1\n}\n')

    const classification = await classifyFailure(failureAt(path, 2), hands, 'Order cancellation', dir)
    expect(classification.foreign).toBe(false)
  })

  it('a_file_the_output_names_but_nothing_tracked_is_never_called_foreign', async () => {
    const path = join(dir, 'untracked.ts')
    await writeFile(path, 'function a() {\n  return 1\n}\n')
    const hands = new FileHands(dir, 'verify-1', 'implement', 'Order cancellation')
    const classification = await classifyFailure(failureAt(path, 2), hands, 'Order cancellation', dir)
    expect(classification.foreign).toBe(false)
  })
})
