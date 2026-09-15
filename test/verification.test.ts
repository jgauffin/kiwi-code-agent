import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commandsFor, findUpward, runVerification, verificationHandoffPrompt, type VerifyRule } from '../src/agent/phases/verification'
import { parseTasks } from '../src/agent/phases/tasks-file'

let dir: string
const runs: { command: string; cwd: string }[] = []
let outcome: { ok: boolean; output: string } = { ok: true, output: '' }

const rules: VerifyRule[] = [
  { match: '**/*.cs', project: '*.csproj', command: 'dotnet test "{project}"' },
  { match: 'src/**/*.ts', project: 'package.json', command: 'npm test' },
]

const run = async (command: string, cwd: string) => {
  runs.push({ command, cwd })
  return outcome
}

const board = (...lines: string[]) => writeFile(join(dir, 'plan', 'order-cancellation.tasks.md'), `# Tasks\n\n${lines.join('\n')}\n`)

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'verify-'))
  await mkdir(join(dir, 'src', 'Api', 'Orders'), { recursive: true })
  await mkdir(join(dir, 'plan'))
  await writeFile(join(dir, 'src', 'Api', 'Api.csproj'), '<Project/>')
  await writeFile(join(dir, 'src', 'Api', 'Orders', 'Order.cs'), 'class Order {}')
  await writeFile(join(dir, 'package.json'), '{}')
  runs.length = 0
  outcome = { ok: true, output: '' }
})

afterEach(() => rm(dir, { recursive: true, force: true }))

describe('commandsFor', () => {
  it('a_touched_file_runs_the_command_of_its_nearest_project_in_that_directory', () => {
    expect(commandsFor(['src/Api/Orders/Order.cs'], rules, dir)).toEqual([
      { command: `dotnet test "${join(dir, 'src', 'Api', 'Api.csproj')}"`, cwd: join(dir, 'src', 'Api') },
    ])
  })

  it('a_backend_and_a_frontend_file_run_each_suite_once', () => {
    const files = ['src/Api/Orders/Order.cs', 'src/Api/Other.cs', 'src/app/orders.ts', 'src/app/orders.test.ts']
    expect(commandsFor(files, rules, dir)).toEqual([
      { command: `dotnet test "${join(dir, 'src', 'Api', 'Api.csproj')}"`, cwd: join(dir, 'src', 'Api') },
      { command: 'npm test', cwd: dir },
    ])
  })

  it('a_file_no_rule_matches_runs_nothing', () => {
    expect(commandsFor(['docs/intent/orders.md'], rules, dir)).toEqual([])
  })

  it('rules_without_a_project_run_in_the_workspace_root', () => {
    expect(commandsFor(['src/thing.ts'], [{ match: '**/*.ts', command: 'npm run typecheck' }], dir)).toEqual([
      { command: 'npm run typecheck', cwd: dir },
    ])
  })
})

describe('findUpward', () => {
  it('finds_the_nearest_matching_file_and_stops_at_the_root', () => {
    expect(findUpward(join(dir, 'src', 'Api', 'Orders'), '*.csproj', dir)).toBe(join(dir, 'src', 'Api', 'Api.csproj'))
    expect(findUpward(join(dir, 'src'), '*.csproj', dir)).toBeUndefined()
  })
})

describe('runVerification', () => {
  it('runs_the_suites_the_tasks_files_select_and_records_a_pass_on_the_board', async () => {
    await board('- **T1**: a [tested]', '  - files: src/Api/Orders/Order.cs', '- **T2**: b [tested]', '  - files: src/app/orders.ts (new)')
    const result = await runVerification({ cwd: dir, feature: 'Order cancellation', rules, run, now: '2026-09-14T10:00:00Z' })
    expect(runs).toHaveLength(2)
    expect(result.failures).toEqual([])
    const tasks = parseTasks(await readFile(join(dir, 'plan', 'order-cancellation.tasks.md'), 'utf8'))
    expect(tasks.verification).toMatchObject({ at: '2026-09-14T10:00:00Z', ok: true })
    expect(tasks.verification?.text).toContain('`npm test` in .')
  })

  it('a_removed_tasks_files_do_not_select_a_suite', async () => {
    await board('- **T1**: a [tested]', '  - files: src/app/orders.ts', '- **T2**: gone [removed]', '  - files: src/Api/Orders/Order.cs')
    await runVerification({ cwd: dir, feature: 'Order cancellation', rules, run })
    expect(runs).toEqual([{ command: 'npm test', cwd: dir }])
  })

  it('records_a_failure_naming_the_command_and_hands_the_output_tail_to_the_implementer', async () => {
    outcome = { ok: false, output: 'x'.repeat(100) + 'THE ERROR' }
    await board('- **T1**: a [tested]', '  - files: src/app/orders.ts')
    const result = await runVerification({ cwd: dir, feature: 'Order cancellation', rules, run, maxOutputChars: 20 })
    expect(result.record.ok).toBe(false)
    expect(result.record.text).toBe('`npm test` in .')
    expect(result.failures[0]?.output).toBe('[...]\n' + 'x'.repeat(11) + 'THE ERROR')
    const prompt = verificationHandoffPrompt('Order cancellation', result.failures, dir)
    expect(prompt).toContain('plan/order-cancellation.tasks.md')
    expect(prompt).toContain('`npm test` in .')
    expect(prompt).toContain('THE ERROR')
    expect(prompt).toContain('[in progress]')
  })

  it('nothing_to_run_is_recorded_as_such_rather_than_leaving_the_board_stuck', async () => {
    await board('- **T1**: a [tested]', '  - files: docs/intent/orders.md')
    const result = await runVerification({ cwd: dir, feature: 'Order cancellation', rules, run })
    expect(runs).toEqual([])
    expect(result.record).toMatchObject({ ok: true, text: 'nothing to run' })
  })

  it('refuses_without_a_tasks_file', async () => {
    await expect(runVerification({ cwd: dir, feature: 'Order cancellation', rules, run })).rejects.toThrow(/no tasks file/i)
  })
})
