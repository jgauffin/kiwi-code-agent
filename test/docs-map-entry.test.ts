import { describe, expect, it } from 'vitest'
import { checkEntry, docHeadings, docOfEntry, parseEntry } from '../src/agent/docs-map/entry'

const DOC = `# Orders

Prose.

## Placing an order

Text.

### Reserving stock

Text.

## Cancelling: the rules

\`\`\`markdown
## Not a heading
### Nor this
\`\`\`

#### Too deep to map
`

const ENTRY = `---
doc: docs/intent/orders.md
---
How an order is placed, changed and cancelled.

- \`#Placing an order\`: what the customer gives and what is reserved
- \`#Reserving stock\`: how long a reservation is held
- \`#Cancelling: the rules\`: when an order may still be cancelled
`

describe('the headings a docs map entry may cite', () => {
  it('only_the_second_and_third_level_headings_outside_a_fence_are_anchors', () => {
    expect(docHeadings(DOC)).toEqual(['Placing an order', 'Reserving stock', 'Cancelling: the rules'])
  })

  it('a_heading_inside_a_fenced_block_is_an_example_and_never_becomes_an_anchor', () => {
    // Several docs here quote the spec contract as fenced markdown; every `##` in it
    // would otherwise become an anchor a citation could not reach.
    expect(docHeadings(DOC)).not.toContain('Not a heading')
    expect(docHeadings(DOC)).not.toContain('Nor this')
  })

  it('a_trailing_hash_run_is_not_part_of_the_heading_text', () => {
    expect(docHeadings('## Closed heading ##\n')).toEqual(['Closed heading'])
  })
})

describe('the docs map entry contract', () => {
  it('an_entry_parses_into_the_doc_its_line_and_one_line_per_heading', () => {
    const entry = parseEntry(ENTRY)
    expect(entry.problems).toEqual([])
    expect(entry.doc).toBe('docs/intent/orders.md')
    expect(entry.summary).toBe('How an order is placed, changed and cancelled.')
    expect(entry.headings.map((h) => h.heading)).toEqual(['Placing an order', 'Reserving stock', 'Cancelling: the rules'])
    expect(entry.headings[0]!.line).toBe('what the customer gives and what is reserved')
  })

  it('a_heading_holding_a_colon_keeps_its_whole_text_so_the_citation_still_matches', () => {
    const entry = parseEntry(ENTRY)
    expect(entry.headings[2]!.heading).toBe('Cancelling: the rules')
    expect(entry.headings[2]!.line).toBe('when an order may still be cancelled')
    expect(checkEntry(entry, docHeadings(DOC))).toEqual([])
  })

  it('an_entry_without_front_matter_or_without_the_docs_own_line_is_reported', () => {
    expect(parseEntry('- `#A`: b\n').problems.join(' ')).toContain('no front matter')
    expect(parseEntry('---\ndoc: a.md\n---\n- `#A`: b\n').problems.join(' ')).toContain("doc's own line is missing")
    expect(parseEntry('---\nwhat: a.md\n---\nline\n').problems.join(' ')).toContain('`doc:` line')
  })

  it('a_line_off_the_grammar_is_reported_rather_than_dropped', () => {
    const entry = parseEntry('---\ndoc: a.md\n---\nThe doc.\n\n- #A: missing its backticks\n')
    expect(entry.headings).toEqual([])
    expect(entry.problems.join(' ')).toContain('not a heading line')
  })

  it('a_heading_the_doc_does_not_have_is_reported_so_no_citation_leads_nowhere', () => {
    const entry = parseEntry('---\ndoc: docs/intent/orders.md\n---\nThe doc.\n\n- `#Refunds`: invented\n')
    expect(checkEntry(entry, docHeadings(DOC)).join(' ')).toContain('`#Refunds` is not a heading of the doc')
  })

  it('a_heading_of_the_doc_with_no_line_is_reported_so_the_map_is_never_quietly_partial', () => {
    const entry = parseEntry('---\ndoc: docs/intent/orders.md\n---\nThe doc.\n\n- `#Placing an order`: what is reserved\n')
    const problems = checkEntry(entry, docHeadings(DOC))
    expect(problems.join(' ')).toContain('`#Reserving stock` is a heading of the doc with no line')
    expect(problems.join(' ')).toContain('`#Cancelling: the rules` is a heading of the doc with no line')
  })

  it('lines_out_of_the_docs_order_are_reported_so_the_map_reads_as_the_doc_does', () => {
    const entry = parseEntry(
      '---\ndoc: docs/intent/orders.md\n---\nThe doc.\n\n- `#Reserving stock`: a\n- `#Placing an order`: b\n- `#Cancelling: the rules`: c\n',
    )
    expect(checkEntry(entry, docHeadings(DOC)).join(' ')).toContain('not in the order')
  })
})

describe('where an entry belongs', () => {
  it('the_doc_an_entry_describes_is_read_off_the_path_it_sits_at', () => {
    expect(docOfEntry('.agent/docs-map/entries/docs/intent/orders.md')).toBe('docs/intent/orders.md')
    expect(docOfEntry('.agent/docs-map/entries/ReadMe.md')).toBe('ReadMe.md')
    expect(docOfEntry('.agent/docs-map/summary.md')).toBeUndefined()
    expect(docOfEntry('docs/intent/orders.md')).toBeUndefined()
  })
})
