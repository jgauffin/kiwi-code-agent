import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { finishDocsMap, planDocsMap, readDocsSummary } from '../src/agent/docs-map/build'
import { diffDocs, readDocsIndex, scanDocs, writeDocsIndex } from '../src/agent/docs-map/doc-index'
import { entryPath, listEntries, readMapFile, writeMapFile } from '../src/agent/docs-map/map-files'

async function withWorkspace<T>(files: Record<string, string>, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'docs-map-'))
  try {
    await write(dir, files)
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function write(dir: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    const full = join(dir, ...path.split('/'))
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, text, 'utf8')
  }
}

const ORDERS = '# Orders\n\n## Cancellation\n\nText.\n'
const ORDERS_ENTRY = '---\ndoc: docs/intent/orders.md\n---\nHow orders work.\n\n- `#Cancellation`: when an order may be cancelled\n'
const README = '# The product\n\n## What it is\n\nText.\n'
const README_ENTRY = '---\ndoc: ReadMe.md\n---\nWhat the product is.\n\n- `#What it is`: the product in its own words\n'

const FILES = { 'docs/intent/orders.md': ORDERS, 'ReadMe.md': README }

/** A build where the model turn already happened: the entries are put on disk by hand. */
async function buildWith(dir: string, entries: Record<string, string>): Promise<void> {
  for (const [doc, text] of Object.entries(entries)) await writeMapFile(dir, entryPath(doc), text)
  await finishDocsMap(dir)
}

describe('what a docs map build has to do', () => {
  it('the_first_build_has_to_describe_every_doc_and_the_readme_counts_as_one', async () =>
    withWorkspace(FILES, async (dir) => {
      const plan = await planDocsMap(dir)
      expect(plan.current).toBe(false)
      expect(plan.changed).toEqual(['ReadMe.md', 'docs/intent/orders.md'])
      expect(plan.removed).toEqual([])
    }))

  it('only_the_docs_whose_content_changed_are_handed_to_the_next_run', async () =>
    withWorkspace(FILES, async (dir) => {
      await buildWith(dir, { 'docs/intent/orders.md': ORDERS_ENTRY, 'ReadMe.md': README_ENTRY })
      expect((await planDocsMap(dir)).current).toBe(true)

      await write(dir, { 'docs/intent/orders.md': `${ORDERS}\n## Refunds\n\nText.\n` })
      const plan = await planDocsMap(dir)
      expect(plan.changed).toEqual(['docs/intent/orders.md'])
      expect(plan.removed).toEqual([])
    }))

  it('a_touch_that_changed_nothing_and_an_edit_that_was_reverted_cost_no_re_read', async () =>
    withWorkspace(FILES, async (dir) => {
      await buildWith(dir, { 'docs/intent/orders.md': ORDERS_ENTRY, 'ReadMe.md': README_ENTRY })
      // Describing a doc is a model turn, so the key is what the doc says, not when it was written.
      await write(dir, { 'docs/intent/orders.md': `${ORDERS}\n## Refunds\n` })
      expect((await planDocsMap(dir)).changed).toEqual(['docs/intent/orders.md'])
      await write(dir, { 'docs/intent/orders.md': ORDERS })
      expect((await planDocsMap(dir)).current).toBe(true)
    }))

  it('a_line_ending_change_alone_is_not_a_change_to_describe', async () =>
    withWorkspace(FILES, async (dir) => {
      await buildWith(dir, { 'docs/intent/orders.md': ORDERS_ENTRY, 'ReadMe.md': README_ENTRY })
      await write(dir, { 'docs/intent/orders.md': ORDERS.replace(/\n/g, '\r\n') })
      expect((await planDocsMap(dir)).current).toBe(true)
    }))

  it('a_deleted_doc_drops_its_entry_and_a_new_doc_gets_one', async () =>
    withWorkspace(FILES, async (dir) => {
      await buildWith(dir, { 'docs/intent/orders.md': ORDERS_ENTRY, 'ReadMe.md': README_ENTRY })
      await rm(join(dir, 'docs', 'intent', 'orders.md'))
      await write(dir, { 'docs/settings.md': '# Settings\n\n## Keys\n\nText.\n' })

      const plan = await planDocsMap(dir)
      expect(plan.changed).toEqual(['docs/settings.md'])
      expect(plan.removed).toEqual(['docs/intent/orders.md'])

      await finishDocsMap(dir)
      expect(await listEntries(dir)).toEqual(['ReadMe.md'])
      expect(await readDocsIndex(dir)).toEqual({ 'ReadMe.md': expect.any(String) })
    }))

  it('a_doc_the_plan_ignore_setting_hides_is_never_described', async () =>
    withWorkspace({ ...FILES, 'docs/api/generated.md': '# Generated\n\n## Types\n' }, async (dir) => {
      // The planner is denied the doc, so a map the planner reads must not carry it either.
      const scanned = await scanDocs(dir, ['docs/api/**'])
      expect(scanned.map((d) => d.path)).toEqual(['ReadMe.md', 'docs/intent/orders.md'])
      expect((await planDocsMap(dir, ['docs/api/**'])).changed).not.toContain('docs/api/generated.md')
    }))

  it('only_a_doc_whose_entry_is_on_contract_is_stamped_so_a_run_that_stopped_halfway_is_retried', async () =>
    withWorkspace(FILES, async (dir) => {
      // The run wrote one good entry and one that names a heading the doc does not have.
      await buildWith(dir, {
        'docs/intent/orders.md': ORDERS_ENTRY,
        'ReadMe.md': '---\ndoc: ReadMe.md\n---\nWhat the product is.\n\n- `#Invented`: nothing\n',
      })
      expect(Object.keys(await readDocsIndex(dir))).toEqual(['docs/intent/orders.md'])
      expect((await planDocsMap(dir)).changed).toEqual(['ReadMe.md'])
    }))

  it('the_summary_carries_every_described_doc_and_names_the_ones_still_to_do', async () =>
    withWorkspace(FILES, async (dir) => {
      await buildWith(dir, { 'docs/intent/orders.md': ORDERS_ENTRY })
      const summary = (await readDocsSummary(dir))!
      expect(summary).toContain('### docs/intent/orders.md')
      expect(summary).toContain('- `#Cancellation`: when an order may be cancelled')
      expect(summary).toContain('Not described yet, so read them if the map does not answer: ReadMe.md.')
    }))

  it('a_corrupt_index_costs_a_full_re_read_rather_than_a_wrong_map', async () =>
    withWorkspace(FILES, async (dir) => {
      await buildWith(dir, { 'docs/intent/orders.md': ORDERS_ENTRY, 'ReadMe.md': README_ENTRY })
      await writeMapFile(dir, 'index.json', '{ not json')
      expect(await readDocsIndex(dir)).toEqual({})
      expect((await planDocsMap(dir)).changed).toEqual(['ReadMe.md', 'docs/intent/orders.md'])
    }))

  it('the_index_is_written_as_sorted_json_a_person_can_read', async () =>
    withWorkspace(FILES, async (dir) => {
      await writeDocsIndex(dir, { 'docs/intent/orders.md': 'bbb', 'ReadMe.md': 'aaa' })
      expect(await readMapFile(dir, 'index.json')).toBe('{\n  "docs": {\n    "ReadMe.md": "aaa",\n    "docs/intent/orders.md": "bbb"\n  }\n}\n')
    }))

  it('a_doc_that_changed_is_stale_and_one_that_did_not_is_not', async () =>
    withWorkspace(FILES, async (dir) => {
      expect(diffDocs(await scanDocs(dir), {}).changed.length).toBe(2)
      await buildWith(dir, { 'docs/intent/orders.md': ORDERS_ENTRY, 'ReadMe.md': README_ENTRY })
      expect(diffDocs(await scanDocs(dir), await readDocsIndex(dir))).toEqual({ changed: [], removed: [] })
    }))
})
