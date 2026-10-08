import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InPlaceEditGate } from '../src/agent/script/in-place-edit'

const bash = (command: string) => ({ toolName: 'Bash', input: { command }, toolUseId: 'b' })
const denied = (outcome: unknown): string => (outcome && typeof outcome === 'object' && 'deny' in outcome ? String(outcome.deny) : '')

let cwd: string
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'in-place-edit-'))
  await writeFile(join(cwd, 'Invoice.cs'), ['class Invoice', '{', '  decimal Total = 2560m;', '  decimal Vat = 640m;', '}', ''].join('\n'))
  await writeFile(join(cwd, 'Ledger.cs'), ['class Ledger', '{', '  int A = 1;', '  int B = 1;', '  int C = 1;', '}', ''].join('\n'))
  await writeFile(join(cwd, 'notes.txt'), 'call(one)\ncall(two)\n')
})
afterEach(() => rm(cwd, { recursive: true, force: true }))

describe('the in-place edit gate', () => {
  it('a_substitution_touching_one_or_two_lines_is_pointed_at_Edit_with_where_they_are', async () => {
    const reason = denied(await new InPlaceEditGate(cwd).preToolUse(bash("sed -i 's/2560m/3060m/g' Invoice.cs")))
    expect(reason).toContain('Edit')
    expect(reason).not.toContain('RunScript')
    expect(reason).toContain('Invoice.cs: Invoice')
    expect(reason).toContain('3: decimal Total = 2560m;')
  })

  it('a_substitution_touching_more_lines_is_pointed_at_RunScript_replace', async () => {
    const reason = denied(await new InPlaceEditGate(cwd).preToolUse(bash("sed -i -e 's/= 1;/= 2;/' Ledger.cs")))
    expect(reason).toContain('RunScript')
    expect(reason).toContain('3 lines')
  })

  it('lines_are_counted_across_every_file_the_command_names', async () => {
    const reason = denied(await new InPlaceEditGate(cwd).preToolUse(bash("sed -i 's/decimal\\|int/long/' Invoice.cs Ledger.cs")))
    expect(reason).toContain('5 lines')
  })

  it('a_basic_regex_reads_parentheses_as_literal_text', async () => {
    const reason = denied(await new InPlaceEditGate(cwd).preToolUse(bash("sed -i 's/call(one)/call(1)/' notes.txt")))
    expect(reason).toContain('1 line')
    expect(reason).toContain('Edit')
  })

  it('an_extended_regex_reads_parentheses_as_a_group', async () => {
    const reason = denied(await new InPlaceEditGate(cwd).preToolUse(bash("sed -E -i 's/call\\((one|two)\\)/x/' notes.txt")))
    expect(reason).toContain('2 lines')
  })

  it('a_substitution_matching_nothing_says_so', async () => {
    const reason = denied(await new InPlaceEditGate(cwd).preToolUse(bash("sed -i 's/9999m/1m/' Invoice.cs")))
    expect(reason).toContain('matches no line')
  })

  it('a_script_that_is_not_one_substitution_is_still_refused', async () => {
    const reason = denied(await new InPlaceEditGate(cwd).preToolUse(bash("sed -i '/Vat/d' Invoice.cs")))
    expect(reason).toContain('Edit')
    expect(reason).toContain('RunScript')
  })

  it('the_same_command_again_is_refused_again', async () => {
    const gate = new InPlaceEditGate(cwd)
    const command = "sed -i 's/2560m/3060m/' Invoice.cs"
    expect(denied(await gate.preToolUse(bash(command)))).not.toBe('')
    expect(denied(await gate.preToolUse(bash(command)))).not.toBe('')
  })

  it.each([
    ["awk -i inplace '{ gsub(/2560m/, \"3060m\") } 1' Invoice.cs"],
    ["gawk -i inplace '{ print }' Invoice.cs"],
    ["awk --include=inplace '{ print }' Invoice.cs"],
  ])('an_awk_that_edits_in_place_is_refused: %s', async (command) => {
    const reason = denied(await new InPlaceEditGate(cwd).preToolUse(bash(command)))
    expect(reason).toContain('Edit')
    expect(reason).toContain('RunScript')
  })

  it.each([
    ["awk '{ gsub(/x/, \"y\") } 1' Invoice.cs > Invoice.tmp && mv Invoice.tmp Invoice.cs"],
    ['cat Invoice.cs | tr a b > /tmp/out; mv -f /tmp/out ./Invoice.cs'],
    ['grep -v Vat Invoice.cs > Invoice.new && cp Invoice.new Invoice.cs && rm Invoice.new'],
  ])('a_file_rewritten_through_a_temporary_file_moved_back_is_refused: %s', async (command) => {
    const reason = denied(await new InPlaceEditGate(cwd).preToolUse(bash(command)))
    expect(reason).toContain('temporary file')
    expect(reason).toContain('RunScript')
  })

  it('a_sed_rewriting_through_a_temporary_file_is_told_which_lines_it_changes', async () => {
    const reason = denied(await new InPlaceEditGate(cwd).preToolUse(bash("sed 's/2560m/3060m/' Invoice.cs > Invoice.tmp && mv Invoice.tmp Invoice.cs")))
    expect(reason).toContain('temporary file')
    expect(reason).toContain('3: decimal Total = 2560m;')
  })

  it.each([
    ["sed -n 's/2560m/3060m/p' Invoice.cs"],
    ['sed -n 3p Invoice.cs'],
    ['grep -n 2560m Invoice.cs'],
    ['dotnet test'],
    ["awk '{ print $1 }' Invoice.cs"],
    ['npm run build > build.log && mv build.log logs/build.log'],
    ['dotnet test > out.txt; mv out.txt results.txt'],
  ])(
    'a_command_that_rewrites_no_file_it_reads_goes_through: %s',
    async (command) => {
      expect(await new InPlaceEditGate(cwd).preToolUse(bash(command))).toBeUndefined()
    },
  )
})
