import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DocsMapContract } from '../src/agent/docs-map/entry'
import { entryFile } from '../src/agent/docs-map/map-files'
import { DOCS_MAP_TOOLS, docsMapKickoff, docsMapPrompt, docsMapScope } from '../src/agent/phases/docs-map'
import { ScopeGuard } from '../src/agent/phases/scope-guard'

const cwd = process.platform === 'win32' ? 'D:\\work\\repo' : '/work/repo'
const guard = new ScopeGuard(cwd, docsMapScope(['docs/intent/orders.md', 'ReadMe.md']))
const use = (toolName: string, input: unknown) => guard.preToolUse({ toolName, input, toolUseId: 't' })

async function withWorkspace<T>(files: Record<string, string>, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'docs-map-run-'))
  try {
    for (const [path, text] of Object.entries(files)) {
      const full = join(dir, ...path.split('/'))
      await mkdir(join(full, '..'), { recursive: true })
      await writeFile(full, text, 'utf8')
    }
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const ORDERS = '# Orders\n\n## Cancellation\n\nText.\n'

describe('what a docs map run may touch', () => {
  it('only_the_docs_of_this_build_are_readable_so_an_unchanged_doc_costs_nothing', async () => {
    expect(await use('Read', { file_path: 'docs/intent/orders.md' })).toBeUndefined()
    expect(await use('Read', { file_path: 'ReadMe.md' })).toBeUndefined()
    expect(await use('Read', { file_path: 'docs/settings.md' })).toMatchObject({ deny: expect.any(String) })
  })

  it('the_code_is_denied_so_the_map_a_blind_planner_reads_has_seen_none_of_it', async () => {
    expect(await use('Read', { file_path: 'src/orders/cancel.ts' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Grep', { pattern: 'cancel', path: 'src' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Bash', { command: 'ls' })).toMatchObject({ deny: expect.stringContaining('not available in this phase') })
  })

  it('an_entry_is_written_without_a_prompt_and_nothing_else_is_writable', async () => {
    expect(await use('Write', { file_path: entryFile('docs/intent/orders.md') })).toEqual({ allow: true })
    expect(await use('Write', { file_path: entryFile('ReadMe.md') })).toEqual({ allow: true })
    // The run describes the docs; it never changes one, and it never composes the map.
    expect(await use('Write', { file_path: 'docs/intent/orders.md' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Write', { file_path: '.agent/docs-map/summary.md' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Write', { file_path: '.agent/docs-map/index.json' })).toMatchObject({ deny: expect.any(String) })
  })

  it('the_run_gets_no_tool_it_has_no_use_for', () => {
    expect(DOCS_MAP_TOOLS).toEqual(['Read', 'Write'])
  })
})

describe('what a docs map run is told', () => {
  it('the_kickoff_names_each_doc_and_the_entry_it_goes_in', () => {
    const kickoff = docsMapKickoff(['docs/intent/orders.md', 'ReadMe.md'])
    expect(kickoff).toContain('`docs/intent/orders.md` → `.agent/docs-map/entries/docs/intent/orders.md`')
    expect(kickoff).toContain('`ReadMe.md` → `.agent/docs-map/entries/ReadMe.md`')
  })

  it('the_prompt_says_a_heading_is_an_anchor_and_that_nothing_is_judged', () => {
    const prompt = docsMapPrompt(cwd)
    expect(prompt).toContain('copied **exactly**')
    expect(prompt).toContain('a citation that leads nowhere')
    expect(prompt).toContain('fenced code block is an example')
    expect(prompt).toContain('You judge nothing')
  })
})

describe('the entry contract answers on the write that broke it', () => {
  it('an_invented_heading_comes_back_on_the_same_tool_result', async () =>
    withWorkspace(
      {
        'docs/intent/orders.md': ORDERS,
        '.agent/docs-map/entries/docs/intent/orders.md': '---\ndoc: docs/intent/orders.md\n---\nHow orders work.\n\n- `#Refunds`: invented\n',
      },
      async (dir) => {
        const outcome = await new DocsMapContract(dir).postToolUse({
          toolName: 'Write',
          input: { file_path: entryFile('docs/intent/orders.md') },
          toolUseId: 't',
          output: '',
          isError: false,
        })
        expect(outcome?.additionalContext).toContain('is off contract')
        expect(outcome?.additionalContext).toContain('`#Refunds` is not a heading of the doc')
        expect(outcome?.additionalContext).toContain('`#Cancellation` is a heading of the doc with no line')
      },
    ))

  it('an_entry_on_contract_is_answered_with_nothing', async () =>
    withWorkspace(
      {
        'docs/intent/orders.md': ORDERS,
        '.agent/docs-map/entries/docs/intent/orders.md':
          '---\ndoc: docs/intent/orders.md\n---\nHow orders work.\n\n- `#Cancellation`: when an order may be cancelled\n',
      },
      async (dir) => {
        const contract = new DocsMapContract(dir)
        const write = (file_path: string) => contract.postToolUse({ toolName: 'Write', input: { file_path }, toolUseId: 't', output: '', isError: false })
        expect(await write(entryFile('docs/intent/orders.md'))).toBeUndefined()
        // A write anywhere else is none of the contract's business.
        expect(await write('docs/intent/orders.md')).toBeUndefined()
      },
    ))

  it('an_entry_written_at_the_wrong_docs_path_is_reported', async () =>
    withWorkspace(
      {
        'docs/intent/orders.md': ORDERS,
        '.agent/docs-map/entries/docs/intent/orders.md': '---\ndoc: docs/settings.md\n---\nHow orders work.\n\n- `#Cancellation`: when\n',
      },
      async (dir) => {
        const outcome = await new DocsMapContract(dir).postToolUse({
          toolName: 'Write',
          input: { file_path: entryFile('docs/intent/orders.md') },
          toolUseId: 't',
          output: '',
          isError: false,
        })
        expect(outcome?.additionalContext).toContain('the `doc:` line says `docs/settings.md`')
      },
    ))
})
