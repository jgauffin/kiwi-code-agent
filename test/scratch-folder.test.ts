import { describe, expect, it } from 'vitest'
import { scratchDir } from '../src/agent/scratch/scratch-folder'

describe('scratchDir', () => {
  it('a_session_s_scratch_folder_is_short_enough_to_write_out_in_every_command', () => {
    expect(scratchDir('a09d1305-7f34-40b5-8538-dcbf45c963f2')).toBe('.kiwi/scratch/a09d1305')
  })
})
