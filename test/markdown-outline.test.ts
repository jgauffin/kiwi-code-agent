import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OUTLINE_THRESHOLD_LINES, OutlineGate } from '../src/agent/openai-session/tools/markdown/outline-gate'
import { formatOutline, parseSections } from '../src/agent/openai-session/tools/markdown/outline'

const DOC = `---
title: Orders
# a YAML comment, not a heading
---
# Orders

Intro.

## Placing an order

Text.

### Reserving stock

Text.

## Cancelling

~~~markdown
## Not a heading
\`\`\`
### Nor this, the fence is still open
~~~

#### Late rules ##
Text.
`

describe('markdown outline', () => {
  it('outline_gives_each_section_its_line_span', () => {
    expect(parseSections(DOC)).toEqual([
      { level: 1, heading: 'Orders', line: 5, endLine: 26 },
      { level: 2, heading: 'Placing an order', line: 9, endLine: 16 },
      { level: 3, heading: 'Reserving stock', line: 13, endLine: 16 },
      { level: 2, heading: 'Cancelling', line: 17, endLine: 26 },
      { level: 4, heading: 'Late rules', line: 25, endLine: 26 },
    ])
  })

  it('headings_inside_fences_or_front_matter_are_not_sections', () => {
    const headings = parseSections(DOC).map((s) => s.heading)
    expect(headings).not.toContain('Not a heading')
    expect(headings).not.toContain('Nor this, the fence is still open')
    expect(headings.join(' ')).not.toContain('YAML')
  })

  it('a_hash_inside_the_heading_text_is_kept', () => {
    expect(parseSections('## Using C#\n')[0]!.heading).toBe('Using C#')
  })

  it('the_rendered_outline_names_the_file_its_length_and_every_span', () => {
    expect(formatOutline('docs/orders.md', DOC)).toBe(
      [
        'docs/orders.md  26 lines',
        '  5-26   # Orders',
        '  9-16     ## Placing an order',
        '  13-16      ### Reserving stock',
        '  17-26    ## Cancelling',
        '  25-26        #### Late rules',
      ].join('\n'),
    )
  })
})

async function withDocs<T>(files: Record<string, string>, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'outline-gate-'))
  try {
    for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text, 'utf8')
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const LONG = `# Guide\n\n## First\n\n${'Line.\n'.repeat(OUTLINE_THRESHOLD_LINES)}\n## Second\n\nEnd.\n`
const SHORT = '# Short\n\n## Only\n\nText.\n'

describe('the outline gate on Read', () => {
  const read = (gate: OutlineGate, input: Record<string, unknown>) => gate.preToolUse({ toolName: 'Read', input, toolUseId: 't' })

  it('first_full_read_of_a_long_doc_returns_its_outline', async () => {
    await withDocs({ 'guide.md': LONG }, async (dir) => {
      const outcome = await read(new OutlineGate(dir), { file_path: 'guide.md' })
      expect(outcome).toMatchObject({ deny: expect.stringContaining('## Second') })
      expect((outcome as { deny: string }).deny).toContain('guide.md  ')
      expect((outcome as { deny: string }).deny).toContain('offset')
      expect((outcome as { deny: string }).deny).not.toContain('Line.')
    })
  })

  it('second_full_read_of_the_same_doc_goes_through', async () => {
    await withDocs({ 'guide.md': LONG }, async (dir) => {
      const gate = new OutlineGate(dir)
      await read(gate, { file_path: 'guide.md' })
      expect(await read(gate, { file_path: join(dir, 'guide.md') })).toBeUndefined()
    })
  })

  it('ranged_read_and_short_docs_are_never_gated', async () => {
    await withDocs({ 'guide.md': LONG, 'short.md': SHORT }, async (dir) => {
      const gate = new OutlineGate(dir)
      expect(await read(gate, { file_path: 'guide.md', offset: 3, limit: 20 })).toBeUndefined()
      expect(await read(gate, { file_path: 'guide.md', limit: 20 })).toBeUndefined()
      expect(await read(gate, { file_path: 'short.md' })).toBeUndefined()
    })
  })

  it('non_markdown_files_and_other_tools_are_never_gated', async () => {
    await withDocs({ 'guide.txt': LONG, 'guide.md': LONG }, async (dir) => {
      const gate = new OutlineGate(dir)
      expect(await read(gate, { file_path: 'guide.txt' })).toBeUndefined()
      expect(await gate.preToolUse({ toolName: 'Edit', input: { file_path: 'guide.md' }, toolUseId: 't' })).toBeUndefined()
    })
  })

  it('a_doc_read_whole_by_design_is_exempt', async () => {
    await withDocs({ 'guide.md': LONG }, async (dir) => {
      expect(await read(new OutlineGate(dir, ['*.md']), { file_path: 'guide.md' })).toBeUndefined()
    })
  })

  it('an_unreadable_doc_is_left_to_read_to_report', async () => {
    await withDocs({}, async (dir) => {
      expect(await read(new OutlineGate(dir), { file_path: 'missing.md' })).toBeUndefined()
    })
  })
})
