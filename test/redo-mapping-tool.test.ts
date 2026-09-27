import { describe, expect, it } from 'vitest'
import { REDO_MAPPING_TOOL, redoMappingTool } from '../src/agent/openai-session/tools/redo-mapping'

const ctx = { cwd: '.', signal: new AbortController().signal, files: { read: () => {} } } as never

describe('redoMappingTool', () => {
  it('acknowledges_the_redo_with_the_note_it_was_given', async () => {
    const withNote = await redoMappingTool.execute({ note: 'keep findings to one short sentence' }, ctx)
    expect(withNote).toEqual({ text: 'Redoing the mapping: keep findings to one short sentence', isError: false })

    const withoutNote = await redoMappingTool.execute({}, ctx)
    expect(withoutNote).toEqual({ text: 'Redoing the mapping.', isError: false })
  })

  it('writes_nothing_itself_so_it_needs_no_permission_of_its_own', () => {
    expect(redoMappingTool.readOnly).toBe(true)
    expect(redoMappingTool.name).toBe(REDO_MAPPING_TOOL)
  })
})
