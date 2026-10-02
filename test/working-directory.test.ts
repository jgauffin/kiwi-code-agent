import { describe, expect, it } from 'vitest'
import { workingDirectoryInstruction } from '../src/agent/session/working-directory'
import { implementPrompt } from '../src/agent/phases/implement'

describe('workingDirectoryInstruction', () => {
  it('a_session_is_told_its_directory_and_platform_and_that_a_shell_command_already_starts_there', () => {
    const line = workingDirectoryInstruction('/work/project', 'linux')
    expect(line).toContain('/work/project')
    expect(line).toContain('linux')
    expect(line).toContain('no command needs a cd to reach it')
  })

  it('a_mode_prompt_leaves_the_directory_to_that_one_line_rather_than_saying_it_again', () => {
    expect(implementPrompt('<feature>', '/work/project')).not.toContain('do not cd')
  })
})
