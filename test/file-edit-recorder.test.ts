import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileEditRecorder } from '../src/agent/edits/file-edit-recorder'
import type { SessionEvent } from '../src/agent/session/code-session'

const lines = (...text: string[]) => text.join('\n') + '\n'

async function workspace(): Promise<{ cwd: string; runDir: string; recorder: FileEditRecorder; clean: () => Promise<void> }> {
  const cwd = await mkdtemp(join(tmpdir(), 'edits-'))
  const runDir = join(cwd, '.agent', 'runs', 'session-1')
  return {
    cwd,
    runDir,
    recorder: new FileEditRecorder({ cwd, runDir }),
    clean: () => rm(cwd, { recursive: true, force: true }),
  }
}

const result = (toolUseId: string, isError = false): SessionEvent => ({
  type: 'tool_result',
  toolUseId,
  text: 'done',
  isError,
})

const request = (requestId: string, toolName: string, input: unknown): SessionEvent => ({
  type: 'permission_request',
  requestId,
  toolName,
  input,
})

const edit = (event: SessionEvent) => (event.type === 'tool_result' || event.type === 'permission_request' ? event.edit : undefined)

describe('FileEditRecorder', () => {
  it('an_edit_step_carries_the_diff_of_what_it_changed', async () => {
    const w = await workspace()
    try {
      await writeFile(join(w.cwd, 'a.ts'), lines('one', 'two', 'three'), 'utf8')
      const input = { file_path: 'a.ts', old_string: 'two', new_string: 'TWO' }
      await w.recorder.preToolUse({ toolName: 'Edit', input, toolUseId: 'call-1' })
      await writeFile(join(w.cwd, 'a.ts'), lines('one', 'TWO', 'three'), 'utf8')
      const change = edit(await w.recorder.decorate(result('call-1')))
      expect(change?.label).toBe('a.ts')
      expect(change?.diffs).toEqual(['@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three'])
      expect(change?.line).toBe(2)
      expect(change?.added).toBe(1)
    } finally {
      await w.clean()
    }
  })

  it('the_diff_comes_from_content_the_host_captured_so_an_auto_approved_edit_gets_one_too', async () => {
    const w = await workspace()
    try {
      // No permission card at all: the capture is the hook at the start of the call.
      await w.recorder.preToolUse({ toolName: 'Write', input: { file_path: 'new.ts', content: 'x' }, toolUseId: 'call-1' })
      await writeFile(join(w.cwd, 'new.ts'), lines('x'), 'utf8')
      const change = edit(await w.recorder.decorate(result('call-1')))
      expect(change?.diffs).toEqual(['@@ -0,0 +1,1 @@\n+x'])
      expect(change?.removed).toBe(0)
    } finally {
      await w.clean()
    }
  })

  it('a_permission_card_shows_the_diff_of_the_change_it_is_asking_about', async () => {
    const w = await workspace()
    try {
      await writeFile(join(w.cwd, 'a.ts'), lines('one', 'two'), 'utf8')
      const input = { file_path: 'a.ts', old_string: 'two', new_string: 'TWO' }
      await w.recorder.preToolUse({ toolName: 'Edit', input, toolUseId: 'call-1' })
      const change = edit(await w.recorder.decorate(request('call-1', 'Edit', input)))
      expect(change?.diffs).toEqual(['@@ -1,2 +1,2 @@\n one\n-two\n+TWO'])
      // The file itself is untouched: the card shows what would happen.
      expect(await readFile(join(w.cwd, 'a.ts'), 'utf8')).toBe(lines('one', 'two'))
    } finally {
      await w.clean()
    }
  })

  it('the_pre_edit_content_is_kept_as_a_snapshot_under_the_run_directory_the_event_carries_only_a_reference', async () => {
    const w = await workspace()
    try {
      await writeFile(join(w.cwd, 'a.ts'), lines('one', 'two'), 'utf8')
      await w.recorder.preToolUse({
        toolName: 'Write',
        input: { file_path: 'a.ts', content: lines('one', 'three') },
        toolUseId: 'call-1',
      })
      await writeFile(join(w.cwd, 'a.ts'), lines('one', 'three'), 'utf8')
      const change = edit(await w.recorder.decorate(result('call-1')))
      expect(change?.snapshot).toBeDefined()
      expect(change!.snapshot!.startsWith(join(w.runDir, 'edits'))).toBe(true)
      expect(await readFile(change!.snapshot!, 'utf8')).toBe(lines('one', 'two'))
      // What rides on the event is the capped diff, not the file.
      expect(JSON.stringify(change)).not.toContain('"one\\ntwo')
    } finally {
      await w.clean()
    }
  })

  it('a_failed_or_denied_edit_leaves_the_step_without_a_diff', async () => {
    const w = await workspace()
    try {
      await writeFile(join(w.cwd, 'a.ts'), lines('one'), 'utf8')
      const input = { file_path: 'a.ts', old_string: 'one', new_string: 'ONE' }
      await w.recorder.preToolUse({ toolName: 'Edit', input, toolUseId: 'call-1' })
      expect(edit(await w.recorder.decorate(result('call-1', true)))).toBeUndefined()
    } finally {
      await w.clean()
    }
  })

  it('each_edit_gets_its_own_diff_against_the_file_as_it_stood_before_that_edit', async () => {
    const w = await workspace()
    try {
      const path = join(w.cwd, 'a.ts')
      await writeFile(path, lines('one', 'two'), 'utf8')

      await w.recorder.preToolUse({ toolName: 'Edit', input: { file_path: 'a.ts', old_string: 'one', new_string: 'ONE' }, toolUseId: 'call-1' })
      await writeFile(path, lines('ONE', 'two'), 'utf8')
      const first = edit(await w.recorder.decorate(result('call-1')))

      await w.recorder.preToolUse({ toolName: 'Edit', input: { file_path: 'a.ts', old_string: 'two', new_string: 'TWO' }, toolUseId: 'call-2' })
      await writeFile(path, lines('ONE', 'TWO'), 'utf8')
      const second = edit(await w.recorder.decorate(result('call-2')))

      // Each diff shows its own edit; the other edit is context at most.
      expect(first?.diffs.join()).toContain('-one')
      expect(first?.diffs.join()).not.toContain('+TWO')
      expect(second?.diffs.join()).toContain('-two')
      expect(second?.diffs.join()).not.toContain('+ONE')
      expect(await readFile(second!.snapshot!, 'utf8')).toBe(lines('ONE', 'two'))
    } finally {
      await w.clean()
    }
  })

  it('a_step_with_several_edits_shows_one_diff_per_edit', async () => {
    const w = await workspace()
    try {
      const path = join(w.cwd, 'a.ts')
      await writeFile(path, lines('one', 'two', 'three'), 'utf8')
      const input = {
        file_path: 'a.ts',
        edits: [
          { old_string: 'one', new_string: 'ONE' },
          { old_string: 'three', new_string: 'THREE' },
        ],
      }
      await w.recorder.preToolUse({ toolName: 'MultiEdit', input, toolUseId: 'call-1' })
      await writeFile(path, lines('ONE', 'two', 'THREE'), 'utf8')
      const change = edit(await w.recorder.decorate(result('call-1')))
      expect(change?.diffs).toHaveLength(2)
      expect(change!.diffs[0]).toContain('-one')
      expect(change!.diffs[1]).toContain('-three')
    } finally {
      await w.clean()
    }
  })

  it('a_write_of_the_content_already_on_disk_says_so_instead_of_showing_a_diff', async () => {
    const w = await workspace()
    try {
      const path = join(w.cwd, 'a.ts')
      await writeFile(path, lines('same'), 'utf8')
      await w.recorder.preToolUse({ toolName: 'Write', input: { file_path: 'a.ts', content: lines('same') }, toolUseId: 'call-1' })
      await writeFile(path, lines('same'), 'utf8')
      const change = edit(await w.recorder.decorate(result('call-1')))
      expect(change?.diffs).toEqual([])
      expect(change?.summary).toBe('a.ts: no change')
    } finally {
      await w.clean()
    }
  })

  it('content_that_is_not_text_is_reported_in_summary_form_with_no_diff_and_no_link', async () => {
    const w = await workspace()
    try {
      await writeFile(join(w.cwd, 'a.bin'), Buffer.from([0x41, 0x00, 0x42]))
      await w.recorder.preToolUse({ toolName: 'Write', input: { file_path: 'a.bin', content: 'x' }, toolUseId: 'call-1' })
      const change = edit(await w.recorder.decorate(result('call-1')))
      expect(change).toMatchObject({ label: 'a.bin', diffs: [], summary: 'a.bin: binary file' })
      expect(change?.snapshot).toBeUndefined()

      // A notebook cell is not a text diff either.
      await mkdir(join(w.cwd, 'nb'), { recursive: true })
      await writeFile(join(w.cwd, 'nb', 'n.ipynb'), '{"cells":[]}', 'utf8')
      await w.recorder.preToolUse({ toolName: 'NotebookEdit', input: { notebook_path: 'nb/n.ipynb' }, toolUseId: 'call-2' })
      const notebook = edit(await w.recorder.decorate(result('call-2')))
      expect(notebook).toMatchObject({ diffs: [], summary: 'nb/n.ipynb: notebook cell edited' })
    } finally {
      await w.clean()
    }
  })

  it('steps_that_do_not_write_a_file_pass_through_untouched', async () => {
    const w = await workspace()
    try {
      await w.recorder.preToolUse({ toolName: 'Read', input: { file_path: 'a.ts' }, toolUseId: 'call-1' })
      expect(edit(await w.recorder.decorate(result('call-1')))).toBeUndefined()
      const other: SessionEvent = { type: 'user_message', text: 'hi' }
      expect(await w.recorder.decorate(other)).toBe(other)
    } finally {
      await w.clean()
    }
  })
})
