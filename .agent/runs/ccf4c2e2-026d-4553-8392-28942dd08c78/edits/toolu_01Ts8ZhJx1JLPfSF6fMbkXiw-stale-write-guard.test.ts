import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StaleWriteGuard } from '../src/agent/session/stale-write-guard'
import { FileHands } from '../src/agent/session/file-hands'
import type { ToolUse } from '../src/agent/session/hooks'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'stale-write-'))
})

afterEach(() => rm(dir, { recursive: true, force: true }))

const use = (toolName: string, input: unknown): ToolUse => ({ toolName, input, toolUseId: 't' })
const written = (toolName: string, input: unknown, isError = false) => ({ toolName, input, toolUseId: 't', output: '', isError })

const guardFor = (mode: 'plan' | 'implement' = 'implement', feature: string | undefined = undefined, sessionId = 's1') =>
  new StaleWriteGuard(dir, new FileHands(dir, sessionId, mode, feature))

describe('StaleWriteGuard', () => {
  it('unread_file_refused', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello')
    const guard = guardFor()
    const result = await guard.preToolUse(use('Edit', { file_path: 'a.txt', old_string: 'hello', new_string: 'bye' }))
    expect(result).toMatchObject({ deny: expect.stringContaining('not been read') })
  })

  it('a_new_file_needs_no_read', async () => {
    const guard = guardFor()
    const result = await guard.preToolUse(use('Write', { file_path: 'new.txt', content: 'x' }))
    expect(result).toBeUndefined()
  })

  it('stale_write_refused_when_the_file_changed_on_disk_since_it_was_read', async () => {
    const path = join(dir, 'a.txt')
    await writeFile(path, 'hello')
    const guard = guardFor()
    await guard.postToolUse(written('Read', { file_path: 'a.txt' }))
    await writeFile(path, 'hello world')
    const later = new Date(Date.now() + 5000)
    await utimes(path, later, later)
    const result = await guard.preToolUse(use('Edit', { file_path: 'a.txt', old_string: 'hello', new_string: 'bye' }))
    expect(result).toMatchObject({ deny: expect.stringContaining('changed on disk') })
  })

  it('own_writes_are_seeing_so_two_edits_in_a_row_are_never_refused', async () => {
    const path = join(dir, 'a.txt')
    await writeFile(path, 'hello')
    const guard = guardFor()
    await guard.postToolUse(written('Read', { file_path: 'a.txt' }))
    expect(await guard.preToolUse(use('Edit', { file_path: 'a.txt', old_string: 'hello', new_string: 'bye' }))).toBeUndefined()
    await guard.postToolUse(written('Edit', { file_path: 'a.txt', old_string: 'hello', new_string: 'bye' }))
    const again = await guard.preToolUse(use('Edit', { file_path: 'a.txt', old_string: 'bye', new_string: 'later' }))
    expect(again).toBeUndefined()
  })

  it('who_changed_it_names_the_other_kiwiagent_session_and_its_feature', async () => {
    const path = join(dir, 'a.txt')
    await writeFile(path, 'hello')
    const mine = guardFor('implement')
    await mine.postToolUse(written('Read', { file_path: 'a.txt' }))

    const other = guardFor('plan', 'Order cancellation')
    await other.postToolUse(written('Read', { file_path: 'a.txt' }))
    await writeFile(path, 'changed by the other session')
    const later = new Date(Date.now() + 5000)
    await utimes(path, later, later)
    await other.postToolUse(written('Write', { file_path: 'a.txt', content: 'changed by the other session' }))

    const result = await mine.preToolUse(use('Edit', { file_path: 'a.txt', old_string: 'changed', new_string: 'x' }))
    expect(result).toMatchObject({ deny: expect.stringContaining('a KiwiAgent plan session on "Order cancellation"') })
  })

  it('who_changed_it_says_outside_kiwiagent_when_no_session_wrote_it', async () => {
    const path = join(dir, 'a.txt')
    await writeFile(path, 'hello')
    const guard = guardFor()
    await guard.postToolUse(written('Read', { file_path: 'a.txt' }))
    await writeFile(path, 'edited by the ide')
    const later = new Date(Date.now() + 5000)
    await utimes(path, later, later)
    const result = await guard.preToolUse(use('Edit', { file_path: 'a.txt', old_string: 'x', new_string: 'y' }))
    expect(result).toMatchObject({ deny: expect.stringContaining('changed from outside KiwiAgent') })
  })
})
