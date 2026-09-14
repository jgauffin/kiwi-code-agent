import { describe, expect, it } from 'vitest'
import { splitShellCommand } from '../src/agent/permissions/shell-split'

describe('splitShellCommand', () => {
  it('splits_on_control_operators_and_keeps_quoted_operators_as_text', () => {
    const { segments } = splitShellCommand('npm test && echo "a && b" | grep a; ls || true\nrm x & pwd')
    expect(segments.map((s) => s.tokens)).toEqual([
      ['npm', 'test'],
      ['echo', 'a && b'],
      ['grep', 'a'],
      ['ls'],
      ['true'],
      ['rm', 'x'],
      ['pwd'],
    ])
  })

  it('each_segment_keeps_its_text_as_written_without_the_operators_around_it', () => {
    const { segments } = splitShellCommand('npm test 2>&1 && echo "a && b" | grep a;  ls -la > out.txt\nrm x')
    expect(segments.map((s) => s.text)).toEqual(['npm test 2>&1', 'echo "a && b"', 'grep a', 'ls -la > out.txt', 'rm x'])
  })

  it('honours_single_quotes_double_quotes_and_backslash_escapes', () => {
    const { segments } = splitShellCommand(`git commit -m 'it''s done' "x\\"y" a\\ b`)
    expect(segments[0]!.tokens).toEqual(['git', 'commit', '-m', 'its done', 'x"y', 'a b'])
  })

  it('a_redirect_to_a_file_marks_the_segment_as_writing_but_dev_null_and_fd_dups_do_not', () => {
    const [toFile] = splitShellCommand('echo hi > out.txt').segments
    const [toNull] = splitShellCommand('ls 2>/dev/null').segments
    const [dup] = splitShellCommand('npm test 2>&1').segments
    const [append] = splitShellCommand('cat a >> b').segments
    expect(toFile!.writesFile).toBe(true)
    expect(toNull!.writesFile).toBe(false)
    expect(dup!.writesFile).toBe(false)
    expect(append!.writesFile).toBe(true)
    expect(toFile!.tokens).toEqual(['echo', 'hi'])
  })

  it('command_substitution_and_process_substitution_flag_the_whole_command', () => {
    expect(splitShellCommand('echo $(rm -rf x)').substitutes).toBe(true)
    expect(splitShellCommand('echo `rm x`').substitutes).toBe(true)
    expect(splitShellCommand('diff <(ls a) <(ls b)').substitutes).toBe(true)
    expect(splitShellCommand('echo "$(ls)"').substitutes).toBe(true)
    expect(splitShellCommand("echo '$(ls)'").substitutes).toBe(false)
    expect(splitShellCommand('ls').substitutes).toBe(false)
  })
})
