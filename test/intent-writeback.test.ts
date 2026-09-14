import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyToDoc,
  assertAmendable,
  findSection,
  intentFile,
  intentPath,
  markApplied,
  parseAmendments,
  pending,
  readAmendments,
  writeBackIntent,
  type Amendment,
} from '../src/agent/phases/intent-writeback'

const file = `# Intent amendments from plan/order-cancellation.spec.md

## A1 (append) docs/intent/orders.md#Cancellation
- from: F3 (naive)
- why: intent does not say what happens to the reservation.

Cancelling an order releases its reservation immediately.

## A2 (replace) docs/intent/orders.md#Refunds [applied]
- from: F4, ruled for the spec

A refund is issued to the original payment method.

## A3 (new) docs/intent/reservations.md#Expiry

A reservation that is not confirmed within an hour expires.
`

const doc = `# Orders

## Cancellation

An order can be cancelled while it is unpaid.

## Refunds

Refunds are manual.

## Delivery

Delivery is next-day.
`

/** `heading: ''` means the amendment names no heading, which is not the same as leaving it out. */
type Override = Partial<Omit<Amendment, 'heading'>> & { heading?: string }

const amend = (over: Override = {}): Amendment => {
  const { heading = 'Cancellation', ...rest } = over
  return {
    id: 'A1',
    mode: 'append',
    doc: 'docs/intent/orders.md',
    text: 'Cancelling an order releases its reservation.',
    applied: false,
    line: 0,
    ...rest,
    ...(heading ? { heading } : {}),
  }
}

describe('intent amendments', () => {
  it('parses_id_mode_target_and_prose', () => {
    const amendments = parseAmendments(file)
    expect(amendments.map((a) => a.id)).toEqual(['A1', 'A2', 'A3'])
    expect(amendments[0]).toMatchObject({
      mode: 'append',
      doc: 'docs/intent/orders.md',
      heading: 'Cancellation',
      from: 'F3 (naive)',
      why: 'intent does not say what happens to the reservation.',
      text: 'Cancelling an order releases its reservation immediately.',
      applied: false,
    })
    expect(amendments[1]).toMatchObject({ mode: 'replace', heading: 'Refunds', applied: true })
    expect(amendments[2]).toMatchObject({ mode: 'new', doc: 'docs/intent/reservations.md', heading: 'Expiry' })
  })

  it('leaves_out_an_amendment_whose_mode_is_not_one_of_the_three', () => {
    const amendments = parseAmendments('## A1 (rewrite) docs/intent/orders.md#Cancellation\n\ntext\n')
    expect(amendments).toEqual([])
  })

  it('counts_only_the_unapplied_ones_as_pending', () => {
    expect(pending(parseAmendments(file)).map((a) => a.id)).toEqual(['A1', 'A3'])
  })

  it('takes_a_why_line_inside_the_prose_as_prose', () => {
    const [amendment] = parseAmendments('## A1 (append) docs/intent/x.md#H\n\nA rule.\n- why: it is not metadata here.\n')
    expect(amendment!.why).toBeUndefined()
    expect(amendment!.text).toBe('A rule.\n- why: it is not metadata here.')
  })

  it('finds_a_section_and_stops_at_the_next_heading_of_the_same_rank', () => {
    const lines = doc.split('\n')
    const section = findSection(lines, 'cancellation')
    expect(lines[section!.heading]).toBe('## Cancellation')
    expect(lines.slice(section!.heading + 1, section!.end).join('\n').trim()).toBe(
      'An order can be cancelled while it is unpaid.',
    )
  })

  it('appends_to_the_named_section_and_leaves_the_rest_alone', () => {
    const after = applyToDoc(doc, amend())
    expect(after).toContain('An order can be cancelled while it is unpaid.\n\nCancelling an order releases its reservation.')
    expect(after).toContain('## Refunds\n\nRefunds are manual.')
    expect(after).toContain('## Delivery')
  })

  it('replaces_only_the_named_sections_body', () => {
    const after = applyToDoc(doc, amend({ mode: 'replace', heading: 'Refunds', text: 'Refunds go to the payment method.' }))
    expect(after).toContain('## Refunds\n\nRefunds go to the payment method.\n\n## Delivery')
    expect(after).not.toContain('Refunds are manual.')
    expect(after).toContain('An order can be cancelled while it is unpaid.')
  })

  it('adds_a_new_section_at_the_end', () => {
    const after = applyToDoc(doc, amend({ mode: 'new', heading: 'Expiry', text: 'A reservation expires after an hour.' }))
    expect(after.trimEnd().endsWith('## Expiry\n\nA reservation expires after an hour.')).toBe(true)
  })

  it('refuses_a_new_section_that_is_already_there', () => {
    expect(() => applyToDoc(doc, amend({ mode: 'new', heading: 'Refunds' }))).toThrow(/already exists/)
  })

  it('refuses_a_heading_the_document_does_not_have', () => {
    expect(() => applyToDoc(doc, amend({ heading: 'Returns' }))).toThrow(/no heading "Returns"/)
  })

  it('refuses_a_replace_without_a_heading', () => {
    expect(() => applyToDoc(doc, amend({ mode: 'replace', heading: '' }))).toThrow(/needs a heading/)
  })

  it('marks_applied_without_touching_the_prose', () => {
    const marked = markApplied(file, ['A1'])
    expect(marked).toContain('## A1 (append) docs/intent/orders.md#Cancellation [applied]')
    expect(marked).toContain('## A3 (new) docs/intent/reservations.md#Expiry\n')
    expect(marked).toContain('Cancelling an order releases its reservation immediately.')
    expect(parseAmendments(marked).filter((a) => a.applied).map((a) => a.id)).toEqual(['A1', 'A2'])
  })

  it('amends_intent_from_a_settled_plan_only', () => {
    expect(() => assertAmendable({ exists: false })).toThrow(/nothing to write back/)
    expect(() => assertAmendable({ exists: true, status: 'draft', body: '' })).toThrow(/draft/)
    expect(() => assertAmendable({ exists: true, status: 'approved', body: '' })).not.toThrow()
  })

  it('names_the_files_the_way_the_prompts_and_scopes_do', () => {
    expect(intentFile('Order cancellation')).toBe('plan/order-cancellation.intent.md')
    expect(intentPath('/w', 'Order cancellation')).toBe(join('/w', 'plan', 'order-cancellation.intent.md'))
  })

  describe('write-back', () => {
    const inWorkspace = async (run: (dir: string) => Promise<void>): Promise<void> => {
      const dir = await mkdtemp(join(tmpdir(), 'intent-'))
      try {
        await mkdir(join(dir, 'plan'), { recursive: true })
        await mkdir(join(dir, 'docs', 'intent'), { recursive: true })
        await writeFile(join(dir, 'docs', 'intent', 'orders.md'), doc, 'utf8')
        await run(dir)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }

    it('writes_pending_amendments_into_the_docs_and_marks_them', async () => {
      await inWorkspace(async (dir) => {
        await writeFile(intentPath(dir, 'Order cancellation'), file, 'utf8')
        const result = await writeBackIntent({ cwd: dir, feature: 'Order cancellation' })

        expect(result.applied.map((a) => a.id)).toEqual(['A1', 'A3'])
        expect(result.failed).toEqual([])
        expect(result.docs).toEqual(['docs/intent/orders.md', 'docs/intent/reservations.md'])

        const orders = await readFile(join(dir, 'docs', 'intent', 'orders.md'), 'utf8')
        expect(orders).toContain('Cancelling an order releases its reservation immediately.')
        // A2 was already applied, so the section it names is untouched.
        expect(orders).toContain('Refunds are manual.')
        const reservations = await readFile(join(dir, 'docs', 'intent', 'reservations.md'), 'utf8')
        expect(reservations).toContain('## Expiry')

        // Idempotent: a second run has nothing left to do.
        const again = await writeBackIntent({ cwd: dir, feature: 'Order cancellation' })
        expect(again.applied).toEqual([])
        expect(await readFile(join(dir, 'docs', 'intent', 'orders.md'), 'utf8')).toBe(orders)
      })
    })

    it('reports_the_one_that_failed_and_still_writes_the_rest', async () => {
      await inWorkspace(async (dir) => {
        const text = `## A1 (append) docs/intent/orders.md#Returns\n\nReturns are free.\n\n## A2 (append) docs/intent/orders.md#Cancellation\n\nA cancelled order is final.\n`
        await writeFile(intentPath(dir, 'Order cancellation'), text, 'utf8')
        const result = await writeBackIntent({ cwd: dir, feature: 'Order cancellation' })

        expect(result.applied.map((a) => a.id)).toEqual(['A2'])
        expect(result.failed[0]!.amendment.id).toBe('A1')
        expect(result.failed[0]!.reason).toMatch(/no heading "Returns"/)
        // The failed one stays pending so it can be fixed and applied later.
        expect(pending(await readAmendments(intentPath(dir, 'Order cancellation'))).map((a) => a.id)).toEqual(['A1'])
      })
    })

    it('refuses_to_write_outside_the_docs_tree', async () => {
      await inWorkspace(async (dir) => {
        const text = `## A1 (append) src/agent/rules.md#Rules\n\nno.\n\n## A2 (new) ../escape.md\n\nno.\n`
        await writeFile(intentPath(dir, 'Order cancellation'), text, 'utf8')
        const result = await writeBackIntent({ cwd: dir, feature: 'Order cancellation' })

        expect(result.applied).toEqual([])
        expect(result.failed.map((f) => f.reason)).toEqual([
          expect.stringMatching(/not an intent document/),
          expect.stringMatching(/outside the workspace/),
        ])
      })
    })

    it('is_a_no_op_when_the_feature_has_no_amendment_file', async () => {
      await inWorkspace(async (dir) => {
        const result = await writeBackIntent({ cwd: dir, feature: 'Order cancellation' })
        expect(result).toEqual({ applied: [], failed: [], docs: [] })
      })
    })
  })
})
