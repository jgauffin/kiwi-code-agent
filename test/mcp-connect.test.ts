import { describe, expect, it } from 'vitest'
import { mcpToolOutput } from '../src/agent/mcp/mcp-connect'

describe('mcpToolOutput', () => {
  it('an_image_in_a_tool_result_is_kept_whole_beside_the_text', () => {
    const output = mcpToolOutput({
      content: [
        { type: 'text', text: 'Crafter' },
        { type: 'image', data: 'iVBORw0K', mimeType: 'image/png' },
      ],
    })
    expect(output).toEqual({ text: 'Crafter\n[image]', isError: false, images: [{ mediaType: 'image/png', data: 'iVBORw0K' }] })
  })

  it('a_text_only_result_carries_no_images', () => {
    expect(mcpToolOutput({ content: [{ type: 'text', text: 'ok' }], isError: true })).toEqual({ text: 'ok', isError: true })
  })

  it('an_image_part_missing_its_data_is_not_passed_on', () => {
    expect(mcpToolOutput({ content: [{ type: 'image', mimeType: 'image/png' }] })).toEqual({ text: '[image]', isError: false })
  })
})
