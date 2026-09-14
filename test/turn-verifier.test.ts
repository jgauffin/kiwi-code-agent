import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TurnVerifier, findUpward, type VerifyRule } from '../src/agent/verify/turn-verifier'

let dir: string
const runs: { command: string; cwd: string }[] = []
let outcome: { ok: boolean; output: string } = { ok: true, output: '' }

const rules: VerifyRule[] = [
  { match: '**/*.cs', project: '*.csproj', command: 'dotnet build "{project}"' },
  { match: '**/*.ts', command: 'npm run typecheck' },
]

function verifier(budget = 3, enabled = true): TurnVerifier {
  const v = new TurnVerifier({
    cwd: dir,
    rules,
    failureBudget: budget,
    run: async (command, cwd) => {
      runs.push({ command, cwd })
      return outcome
    },
  })
  v.enabled = enabled
  return v
}

const edited = (verifierInstance: TurnVerifier, file: string, tool = 'Edit') =>
  verifierInstance.postToolUse({ toolName: tool, input: { file_path: file }, toolUseId: 't', output: 'ok', isError: false })

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'verify-'))
  await mkdir(join(dir, 'src', 'Api', 'Orders'), { recursive: true })
  await writeFile(join(dir, 'src', 'Api', 'Api.csproj'), '<Project/>')
  await writeFile(join(dir, 'src', 'Api', 'Orders', 'Order.cs'), 'class Order {}')
  runs.length = 0
  outcome = { ok: true, output: '' }
})

afterEach(() => rm(dir, { recursive: true, force: true }))

describe('TurnVerifier', () => {
  it('is_off_by_default_so_chatting_about_a_plan_costs_no_builds', async () => {
    const v = new TurnVerifier({ cwd: dir, rules, run: async () => outcome })
    await edited(v, join(dir, 'src', 'Api', 'Orders', 'Order.cs'))
    expect(await v.stop()).toBeUndefined()
    expect(runs).toEqual([])
  })

  it('edits_made_while_off_are_verified_once_it_is_turned_on', async () => {
    const v = verifier(3, false)
    await edited(v, join(dir, 'src', 'Api', 'Orders', 'Order.cs'))
    await v.stop()
    v.enabled = true
    await v.stop()
    expect(runs).toHaveLength(1)
  })

  it('nothing_edited_means_no_verification_and_no_block', async () => {
    const v = verifier()
    await edited(v, join(dir, 'src', 'Api', 'Orders', 'Order.cs'), 'Read')
    expect(await v.stop()).toBeUndefined()
    expect(runs).toEqual([])
  })

  it('edited_cs_file_runs_the_build_of_its_nearest_project_in_that_directory', async () => {
    const v = verifier()
    await edited(v, join(dir, 'src', 'Api', 'Orders', 'Order.cs'))
    const result = await v.stop()
    expect(runs).toEqual([{ command: `dotnet build "${join(dir, 'src', 'Api', 'Api.csproj')}"`, cwd: join(dir, 'src', 'Api') }])
    expect(result).toEqual({ verifications: [{ command: runs[0]!.command, cwd: runs[0]!.cwd, ok: true, output: '' }] })
  })

  it('several_files_in_one_project_run_its_command_once_and_touched_files_are_forgotten', async () => {
    const v = verifier()
    await edited(v, join(dir, 'src', 'Api', 'Orders', 'Order.cs'))
    await edited(v, join(dir, 'src', 'Api', 'Other.cs'), 'Write')
    await v.stop()
    expect(runs).toHaveLength(1)
    expect(await v.stop()).toBeUndefined()
  })

  it('failed_verification_blocks_the_stop_with_the_output_and_a_fix_instruction', async () => {
    outcome = { ok: false, output: 'Order.cs(3,5): error CS1002: ; expected' }
    const v = verifier()
    await edited(v, join(dir, 'src', 'Api', 'Orders', 'Order.cs'))
    const result = await v.stop()
    expect(result?.block).toContain('error CS1002')
    expect(result?.block).toContain('(1/3)')
    expect(result?.block).toContain('Do not stop')
  })

  it('after_the_failure_budget_the_model_may_stop_and_the_count_resets', async () => {
    outcome = { ok: false, output: 'boom' }
    const v = verifier(2)
    for (let i = 0; i < 2; i++) {
      await edited(v, join(dir, 'src', 'Api', 'Orders', 'Order.cs'))
      expect((await v.stop())?.block).toBeDefined()
    }
    await edited(v, join(dir, 'src', 'Api', 'Orders', 'Order.cs'))
    const third = await v.stop()
    expect(third?.block).toBeUndefined()
    expect(third?.verifications?.[0]?.ok).toBe(false)
    await edited(v, join(dir, 'src', 'Api', 'Orders', 'Order.cs'))
    expect((await v.stop())?.block).toContain('(1/2)')
  })

  it('a_success_resets_the_failure_count', async () => {
    const v = verifier(2)
    outcome = { ok: false, output: 'x' }
    await edited(v, join(dir, 'src', 'Api', 'Orders', 'Order.cs'))
    await v.stop()
    outcome = { ok: true, output: '' }
    await edited(v, join(dir, 'src', 'Api', 'Orders', 'Order.cs'))
    await v.stop()
    outcome = { ok: false, output: 'x' }
    await edited(v, join(dir, 'src', 'Api', 'Orders', 'Order.cs'))
    expect((await v.stop())?.block).toContain('(1/2)')
  })

  it('rules_without_a_project_run_in_the_workspace_root', async () => {
    const v = verifier()
    await edited(v, 'src/thing.ts')
    await v.stop()
    expect(runs).toEqual([{ command: 'npm run typecheck', cwd: dir }])
  })

  it('long_output_keeps_the_tail_where_the_errors_are', async () => {
    outcome = { ok: false, output: 'x'.repeat(100) + 'THE ERROR' }
    const v = new TurnVerifier({ cwd: dir, rules, run: async () => outcome, maxOutputChars: 20 })
    v.enabled = true
    await edited(v, 'src/thing.ts')
    const result = await v.stop()
    expect(result?.verifications?.[0]?.output).toBe('[...]\n' + 'x'.repeat(11) + 'THE ERROR')
  })

  it('failed_tool_calls_do_not_count_as_edits', async () => {
    const v = verifier()
    await v.postToolUse({ toolName: 'Edit', input: { file_path: 'src/thing.ts' }, toolUseId: 't', output: 'nope', isError: true })
    expect(await v.stop()).toBeUndefined()
  })
})

describe('findUpward', () => {
  it('finds_the_nearest_matching_file_and_stops_at_the_root', async () => {
    expect(findUpward(join(dir, 'src', 'Api', 'Orders'), '*.csproj', dir)).toBe(join(dir, 'src', 'Api', 'Api.csproj'))
    expect(findUpward(join(dir, 'src'), '*.csproj', dir)).toBeUndefined()
  })
})
