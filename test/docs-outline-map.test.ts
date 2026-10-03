import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OPENING_LIMIT, outlineEntry, renderOutlineMap } from '../src/agent/docs-map/outline-map'
import { withDocsMap, type DocsMapSource } from '../src/agent/docs-map/session-context'

const ORDERS = [
  '---',
  'owner: sales',
  '---',
  '# Orders',
  '',
  'How an order is placed',
  'and cancelled.',
  '',
  'A second paragraph.',
  '',
  '## Placing',
  '',
  'Text.',
  '',
  '### Payment',
  '',
  'Text.',
  '',
  '## Cancellation',
  '',
  'Text.',
].join('\n')

describe('the outline docs map', () => {
  it('every_section_is_listed_with_its_line_range_so_a_planner_can_read_just_that_section', () => {
    expect(outlineEntry('docs/intent/orders.md', ORDERS)).toBe(
      [
        '### docs/intent/orders.md (21 lines)',
        'How an order is placed and cancelled.',
        '- `#Placing` (11-18)',
        '- `#Payment` (15-18)',
        '- `#Cancellation` (19-21)',
      ].join('\n'),
    )
  })

  it('the_opening_is_prose_not_the_front_matter_the_title_or_a_quoted_example', () => {
    const text = '# Title\n\n```markdown\n## Not a heading\nquoted\n```\n\nThe real opening.\n\n## Section\n'
    expect(outlineEntry('docs/a.md', text)).toBe('### docs/a.md (10 lines)\nThe real opening.\n- `#Section` (10-10)')
  })

  it('a_long_opening_is_clipped_so_one_doc_cannot_crowd_the_prompt', () => {
    const opening = outlineEntry('docs/a.md', `# Title\n\n${'word '.repeat(400)}\n`).split('\n')[1]!
    expect(opening.length).toBe(OPENING_LIMIT)
    expect(opening.endsWith('…')).toBe(true)
  })

  it('a_doc_with_no_prose_and_no_sections_is_still_listed_so_the_planner_knows_it_exists', () => {
    expect(outlineEntry('docs/empty.md', '# Empty\n')).toBe('### docs/empty.md (1 line)')
  })

  it('the_map_covers_the_readme_and_the_docs_but_not_what_plan_ignore_hides', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'outline-map-'))
    try {
      for (const [path, text] of Object.entries({
        'ReadMe.md': '# Product\n\nWhat it is.\n',
        'docs/intent/orders.md': ORDERS,
        'docs/api/generated.md': '# Generated\n\n## Types\n',
      })) {
        await mkdir(join(dir, ...path.split('/').slice(0, -1)), { recursive: true })
        await writeFile(join(dir, ...path.split('/')), text, 'utf8')
      }
      const map = await renderOutlineMap(dir, ['docs/api/**'])
      expect(map).toMatch(/### ReadMe\.md \(\d+ lines?\)\nWhat it is\./)
      expect(map).toContain('### docs/intent/orders.md (')
      expect(map).not.toContain('generated')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('the_prompt_says_what_an_outline_map_holds_and_that_a_range_is_for_a_ranged_read', async () => {
    const source: DocsMapSource = { isStale: async () => false, build: async () => undefined, read: async () => '### docs/a.md' }
    const prompt = await withDocsMap('plan', 'Base.', source, { style: 'outline' })
    expect(prompt).toContain('its opening paragraph')
    expect(prompt).toContain('offset and limit')
    expect(prompt).not.toContain('one line per section')
  })
})
