import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoticeOfAnotherHand } from '../src/agent/session/notice-of-another-hand'
import { FileHands } from '../src/agent/session/file-hands'
import type { ToolUse } from '../src/agent/session/hooks'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'notice-'))
})

afterEach(() => rm(dir, { recursive: true, force: true }))

const written = (toolName: string, input: unknown, isError = false) => ({ toolName, input, toolUseId: 't', output: '', isError })

const noticeFor = (sessionId = 's1') => new NoticeOfAnotherHand(dir, new FileHands(dir, sessionId, 'implement', undefined))

/** Bumps the file into the future so its mtime is unmistakably different, whatever the filesystem's resolution. */
async function changeFromAnotherHand(path: string, content: string): Promise<void> {
  await writeFile(path, content)
  const later = new Date(Date.now() + 5000)
  await utimes(path, later, later)
}

describe('NoticeOfAnotherHand', () => {
  it('notice_of_another_hand_is_a_one_line_tail_on_the_next_tool_result', async () => {
    const path = join(dir, 'a.txt')
    await writeFile(path, 'hello')
    const notice = noticeFor()
    await notice.postToolUse(written('Read', { file_path: 'a.txt' }))

    await changeFromAnotherHand(path, 'changed by someone else')

    const result = await notice.postToolUse(written('Bash', { command: 'echo hi' }))
    expect(result?.additionalContext).toContain('a.txt')
    expect(result?.additionalContext?.split('\n')).toHaveLength(1)
  })

  it('one_notice_per_file_is_reported_once_until_the_session_sees_it_again', async () => {
    const path = join(dir, 'a.txt')
    await writeFile(path, 'hello')
    const notice = noticeFor()
    await notice.postToolUse(written('Read', { file_path: 'a.txt' }))
    await changeFromAnotherHand(path, 'changed once')

    const first = await notice.postToolUse(written('Bash', { command: 'echo hi' }))
    expect(first?.additionalContext).toContain('a.txt')

    // Not seen again: the same change is not reported a second time.
    const second = await notice.postToolUse(written('Bash', { command: 'echo hi' }))
    expect(second).toBeUndefined()

    // Seeing the file again clears the notice, so a further change can be reported.
    await notice.postToolUse(written('Read', { file_path: 'a.txt' }))
    await changeFromAnotherHand(path, 'changed again')
    const third = await notice.postToolUse(written('Bash', { command: 'echo hi' }))
    expect(third?.additionalContext).toContain('a.txt')
  })

  it('a_change_sweeping_several_files_names_each_so_only_those_are_read_again', async () => {
    const paths = ['a.txt', 'b.txt', 'c.txt'].map((f) => join(dir, f))
    for (const p of paths) await writeFile(p, 'hello')
    const notice = noticeFor()
    for (const p of paths) await notice.postToolUse(written('Read', { file_path: p }))

    for (const p of paths) await changeFromAnotherHand(p, 'changed by a branch switch')

    const result = await notice.postToolUse(written('Bash', { command: 'echo hi' }))
    expect(result?.additionalContext).toBe(
      [
        'Notice: 3 files changed since you last saw them:',
        '- a.txt: It was changed from outside Kiwipow Agent.',
        '- b.txt: It was changed from outside Kiwipow Agent.',
        '- c.txt: It was changed from outside Kiwipow Agent.',
      ].join('\n'),
    )
  })

  it('a_sweep_past_five_files_names_five_and_counts_the_rest', async () => {
    const paths = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((f) => join(dir, `${f}.txt`))
    for (const p of paths) await writeFile(p, 'hello')
    const notice = noticeFor()
    for (const p of paths) await notice.postToolUse(written('Read', { file_path: p }))
    for (const p of paths) await changeFromAnotherHand(p, 'changed')

    const lines = (await notice.postToolUse(written('Bash', { command: 'echo hi' })))!.additionalContext!.split('\n')
    expect(lines[0]).toBe('Notice: 7 files changed since you last saw them:')
    expect(lines.filter((l) => l.startsWith('- ') && l.includes('.txt'))).toHaveLength(5)
    expect(lines.at(-1)).toBe('- and 2 more.')
  })

  it('says_who_changed_it_when_another_kiwiagent_session_made_the_change', async () => {
    const path = join(dir, 'a.txt')
    await writeFile(path, 'hello')
    const mine = noticeFor('s1')
    await mine.postToolUse(written('Read', { file_path: 'a.txt' }))

    const other = new FileHands(dir, 's2', 'plan', 'Order cancellation')
    await changeFromAnotherHand(path, 'changed by the other session')
    const { stat } = await import('node:fs/promises')
    await other.recordWrite(path, (await stat(path)).mtimeMs)

    const result = await mine.postToolUse(written('Bash', { command: 'echo hi' }))
    expect(result?.additionalContext).toContain('a Kiwipow Agent plan session on "Order cancellation"')
  })
})
