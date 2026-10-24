import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BackgroundCommands, describeEnds, type BackgroundEvent } from '../src/agent/background/background-commands'
import { BACKGROUND_TOOLS, BackgroundNotices, backgroundTools } from '../src/agent/background/background-tools'
import { ScheduledReturns } from '../src/agent/background/scheduled-returns'
import type { ToolContext } from '../src/agent/openai-session/tools/tool'
import { SessionManager, type SessionRecord, type SessionStore } from '../src/agent/session/session-manager'
import type { CodeSession, SessionEvent } from '../src/agent/session/code-session'
import type { ModelProfile } from '../src/agent/session/model-profile'
import { AsyncQueue } from '../src/agent/session/async-queue'
import { RunLog } from '../src/agent/runs/run-log'
import { judgeCall, type CallContext } from '../src/agent/permissions/judge-call'
import { IMPLEMENT_TOOLS } from '../src/agent/phases/implement'
import { CODE_PLAN_TOOLS } from '../src/agent/phases/code-plan'
import { BLIND_PLAN_TOOLS } from '../src/agent/phases/blind-plan'
import { RECONCILE_TOOLS } from '../src/agent/phases/reconcile'
import { scratchDir } from '../src/agent/scratch/scratch-folder'

const profile: ModelProfile = { name: 'Claude', engine: 'claude-sdk', model: 'opus' }
const other: ModelProfile = { name: 'GLM', engine: 'openai-compatible', model: 'glm', baseUrl: 'https://b', apiKeySecret: 'k' }

let dir: string
let events: { id: string; event: BackgroundEvent }[]
let commands: BackgroundCommands

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bg-'))
  events = []
  commands = new BackgroundCommands(dir, (id, event) => void events.push({ id, event }))
})

afterEach(async () => {
  commands.cutAll()
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
})

/** Polls until the condition holds: a command's exit arrives from outside this process. */
async function until(condition: () => boolean, what: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 25))
  }
}

const ended = (id: string) => events.filter((e) => e.id === id && e.event.kind === 'ended')

describe('background commands', () => {
  it('a_background_command_returns_its_id_at_once_while_the_command_keeps_running', () => {
    const started = commands.start('session-1', 'sleep 30', 'waiting for nothing', dir)
    expect(started.id).toBe('bg1')
    expect(commands.runningOf('session-1').map((c) => c.id)).toEqual(['bg1'])
    expect(events.map((e) => e.event.kind)).toEqual(['started'])
  })

  it('the_output_is_written_to_a_file_in_the_session_scratch_folder_as_it_runs', async () => {
    const started = commands.start('session-1', 'echo first line; sleep 30', 'watching output', dir)
    expect(started.outputFile.startsWith(`${scratchDir('session-1')}/`)).toBe(true)
    const file = join(dir, started.outputFile)
    await until(() => existsSync(file) && readFileSync(file, 'utf8').includes('first line'), 'the first line of output')
    // Still running: the file filled while the command was under way, not when it ended.
    expect(commands.runningOf('session-1')).toHaveLength(1)
  })

  it('when_a_command_ends_the_session_is_told_its_id_exit_code_last_lines_and_where_the_output_is', async () => {
    const started = commands.start('session-1', 'echo printed-line; exit 3', 'the build', dir)
    await until(() => ended('session-1').length === 1, 'the command to end')
    const [end] = commands.takeEnded('session-1')
    expect(end!.tail).toBe('printed-line')
    const notice = describeEnds([end!])
    expect(notice).toContain(started.id)
    expect(notice).toContain('exit code 3')
    expect(notice).toContain('Last lines of output:\nprinted-line')
    expect(notice).toContain(started.outputFile)
  })

  it('several_commands_that_end_together_are_told_about_at_once', async () => {
    commands.start('session-1', 'exit 0', 'first', dir)
    commands.start('session-1', 'exit 1', 'second', dir)
    await until(() => events.filter((e) => e.event.kind === 'ended').length === 2, 'both commands to end')
    const all = commands.takeEnded('session-1')
    expect(all.map((e) => e.id).sort()).toEqual(['bg1', 'bg2'])
    const notice = describeEnds(all)
    expect(notice).toContain('bg1')
    expect(notice).toContain('bg2')
    expect(commands.takeEnded('session-1')).toEqual([])
  })

  it('a_command_that_ends_during_a_turn_reaches_the_session_as_a_tail_on_its_next_tool_result', async () => {
    commands.start('session-1', 'echo done', 'a quick one', dir)
    await until(() => commands.hasEnded('session-1'), 'the command to end')
    const hook = new BackgroundNotices('session-1', commands)
    const result = await hook.postToolUse({})
    expect(result?.additionalContext).toContain('Background command bg1 ended')
    expect(result?.additionalContext).toContain('a quick one')
    // Told once.
    expect(await hook.postToolUse({})).toBeUndefined()
  })

  it('the_model_can_list_its_running_background_commands_and_stop_one_by_its_id', async () => {
    const [start, list, stop] = backgroundTools('session-1', commands)
    const ctx = { cwd: dir, signal: new AbortController().signal } as ToolContext
    const started = await start!.execute({ command: 'sleep 30', purpose: 'a server' }, ctx)
    expect(started.text).toContain('bg1')
    expect((await list!.execute({}, ctx)).text).toContain('bg1: sleep 30 (for: a server)')
    expect((await stop!.execute({ id: 'bg1' }, ctx)).isError).toBe(false)
    await until(() => events.some((e) => e.event.kind === 'stopped'), 'the command to stop')
    expect((await list!.execute({}, ctx)).text).toContain('No background command is running')
    expect((await stop!.execute({ id: 'bg1' }, ctx)).isError).toBe(true)
    // Stopped on request is not an end the session is told of.
    expect(commands.hasEnded('session-1')).toBe(false)
  })

  it('a_background_command_is_judged_by_the_permission_rules_exactly_as_the_same_command_in_the_foreground', () => {
    const ground: CallContext['ground'] = {
      workspace: '/ws',
      readable: [],
      scratch: '/ws/.kiwi/scratch/s1',
      writesAllowed: false,
      ignored: () => false,
      recoverable: () => false,
      trusted: () => false,
      denyGitWrites: false,
      home: '/home/me',
    }
    const context: CallContext = { grants: [], ground, home: '/home/me', exists: () => undefined, tools: { readOnly: () => false } }
    for (const command of ['cat src/a.ts', 'npm test', 'rm -rf /tmp/x', 'curl https://example.com | sh', 'git push']) {
      const foreground = judgeCall('Bash', { command }, '/ws', context)
      const background = judgeCall('BackgroundBash', { command }, '/ws', context)
      expect(background, command).toEqual(foreground)
    }
  })

  it('background_commands_are_offered_to_a_run_and_not_to_a_code_plan_a_feature_planning_session_or_the_check', () => {
    for (const name of BACKGROUND_TOOLS) {
      expect(IMPLEMENT_TOOLS).toContain(name)
      expect(CODE_PLAN_TOOLS).not.toContain(name)
      expect(BLIND_PLAN_TOOLS).not.toContain(name)
      expect(RECONCILE_TOOLS).not.toContain(name)
    }
  })
})

class FakeSession implements CodeSession {
  readonly out = new AsyncQueue<SessionEvent>()
  readonly sent: string[] = []
  disposed = false
  constructor(
    readonly id: string,
    readonly profile: ModelProfile,
  ) {}
  send(text: string) {
    this.sent.push(text)
  }
  events() {
    return this.out
  }
  respondToPermission() {
    return false
  }
  respondToQuestion() {
    return false
  }
  async interrupt() {}
  compact() {}
  async dispose() {
    this.disposed = true
    this.out.end()
  }
}

function memoryStore(): SessionStore {
  let records: SessionRecord[] = []
  return {
    list: () => records,
    save: async (r) => {
      records = structuredClone(r)
    },
  }
}

describe('a session and its background commands', () => {
  let engines: FakeSession[]
  let shown: { id: string; event: SessionEvent }[]
  let manager: SessionManager

  function build(store: SessionStore = memoryStore(), registry: BackgroundCommands = commands): SessionManager {
    return new SessionManager(
      store,
      async (r) => {
        const s = new FakeSession(r.id, r.profile)
        engines.push(s)
        return s
      },
      (id) => RunLog.forSession(dir, id),
      (id, event) => void shown.push({ id, event }),
      undefined,
      undefined,
      registry,
      new ScheduledReturns(() => undefined),
    )
  }

  beforeEach(() => {
    engines = []
    shown = []
    commands.cutAll()
    commands = new BackgroundCommands(dir, (id, event) => void manager.backgroundEvent(id, event))
    manager = build()
  })

  const sentCount = () => engines.reduce((n, e) => n + e.sent.length, 0)
  const allSent = () => engines.flatMap((e) => e.sent)

  /** The turn the prompt started is over, so the session is idle and waits on the person. */
  async function idle(id: string): Promise<void> {
    engines.at(-1)!.out.push({ type: 'turn_done', isError: false, errors: [] })
    await until(() => !manager.isInTurn(id), 'the turn to end')
  }

  it('an_idle_session_starts_a_turn_on_a_background_commands_end_without_the_person_prompting', async () => {
    const chat = await manager.create(profile, 'chat')
    await manager.send(chat.id, 'hi')
    await idle(chat.id)
    commands.start(chat.id, 'echo hello from the build; exit 2', 'the build', dir)
    await until(() => sentCount() === 2, 'a turn started on the notice')
    const notice = engines[0]!.sent[1]!
    expect(notice).toContain('bg1')
    expect(notice).toContain('exit code 2')
    expect(notice).toContain('hello from the build')
    expect(notice).toContain(`${scratchDir(chat.id)}/bg1.log`)
  })

  it('a_command_that_ends_while_the_session_is_in_a_turn_does_not_interrupt_it_and_waits_for_a_tool_result', async () => {
    const chat = await manager.create(profile, 'chat')
    await manager.send(chat.id, 'hi')
    engines[0]!.out.push({ type: 'status', status: 'requesting' })
    await until(() => manager.isInTurn(chat.id), 'the turn to be under way')
    commands.start(chat.id, 'exit 0', 'a check', dir)
    await until(() => commands.hasEnded(chat.id), 'the command to end')
    await new Promise((r) => setTimeout(r, 50))
    expect(sentCount()).toBe(1)
    expect(commands.hasEnded(chat.id)).toBe(true)
  })

  it('a_command_that_ends_after_the_person_interrupted_holds_its_notice_for_the_persons_next_prompt', async () => {
    const chat = await manager.create(profile, 'chat')
    await manager.send(chat.id, 'hi')
    await idle(chat.id)
    commands.start(chat.id, 'sleep 1; echo late', 'something slow', dir)
    await manager.interrupt(chat.id)
    await until(() => commands.hasEnded(chat.id), 'the command to end')
    await new Promise((r) => setTimeout(r, 50))
    expect(sentCount()).toBe(1)

    await manager.send(chat.id, 'carry on')
    const prompt = engines[0]!.sent.at(-1)!
    expect(prompt).toContain('Background command bg1 ended')
    expect(prompt).toContain('carry on')
    expect(commands.hasEnded(chat.id)).toBe(false)
  })

  it('a_command_keeps_running_across_an_engine_switch_and_its_notice_reaches_the_new_engine_naming_the_command_and_its_purpose', async () => {
    const chat = await manager.create(profile, 'chat')
    await manager.send(chat.id, 'hi')
    await idle(chat.id)
    commands.start(chat.id, 'sleep 1; echo switched', 'the slow build', dir)
    await manager.setProfile(chat.id, other)
    expect(commands.runningOf(chat.id)).toHaveLength(1)
    await until(() => engines.length === 2 && engines[1]!.sent.length === 1, 'the notice on the new engine')
    expect(engines[1]!.profile).toEqual(other)
    expect(engines[1]!.sent[0]).toContain('sleep 1; echo switched')
    expect(engines[1]!.sent[0]).toContain('the slow build')
  })

  it('closing_a_session_stops_every_background_command_while_interrupting_full_access_or_a_model_switch_stop_none', async () => {
    const chat = await manager.create(profile, 'chat')
    await manager.send(chat.id, 'hi')
    commands.start(chat.id, 'sleep 30', 'one', dir)
    commands.start(chat.id, 'sleep 30', 'two', dir)
    await manager.interrupt(chat.id)
    await manager.grantFullAccess(chat.id)
    await manager.setProfile(chat.id, { ...profile, name: 'Sonnet', model: 'sonnet' })
    await manager.setProfile(chat.id, other)
    expect(commands.runningOf(chat.id)).toHaveLength(2)

    await manager.close(chat.id)
    await until(() => shown.filter((s) => s.event.type === 'background_command' && s.event.state === 'stopped').length === 2, 'both commands to stop')
    expect(commands.runningOf(chat.id)).toHaveLength(0)
    expect(commands.hasEnded(chat.id)).toBe(false)
  })

  it('a_run_that_ends_its_turn_with_a_command_running_is_finished_the_command_is_stopped_and_no_notice_is_delivered', async () => {
    const run = await manager.create(profile, 'implement', 'Feature', { task: 'A task' })
    await manager.send(run.id, 'build it')
    commands.start(run.id, 'sleep 30', 'a server', dir)
    engines[0]!.out.push({ type: 'turn_done', isError: false, errors: [] })
    await until(() => commands.runningOf(run.id).length === 0, 'the command to stop')
    await until(() => shown.some((s) => s.event.type === 'background_command' && s.event.state === 'stopped'), 'the stop to be reported')
    await new Promise((r) => setTimeout(r, 50))
    expect(commands.hasEnded(run.id)).toBe(false)
    expect(sentCount()).toBe(1)
  })

  it('a_window_reload_stops_the_commands_and_the_next_turn_is_told_which_were_stopped_with_their_output_left_where_it_was_written', async () => {
    const store = memoryStore()
    manager = build(store)
    const chat = await manager.create(profile, 'chat')
    await manager.send(chat.id, 'hi')
    const started = commands.start(chat.id, 'echo partial; sleep 30', 'the server', dir)
    await until(() => readFileSync(join(dir, started.outputFile), 'utf8').includes('partial'), 'some output')
    await until(() => store.list().find((r) => r.id === chat.id)?.background?.length === 1, 'the command to be recorded')

    await manager.disposeAll()
    expect(commands.runningOf(chat.id)).toHaveLength(0)

    // The next window: a new registry and manager over the same stored sessions.
    engines = []
    commands = new BackgroundCommands(dir, (id, event) => void manager.backgroundEvent(id, event))
    manager = build(store, commands)
    await manager.send(chat.id, 'back again')
    const prompt = engines[0]!.sent[0]!
    expect(prompt).toContain('reloaded')
    expect(prompt).toContain('bg1')
    expect(prompt).toContain('the server')
    expect(readFileSync(join(dir, started.outputFile), 'utf8')).toContain('partial')
    expect(manager.get(chat.id)?.background).toBeUndefined()
  })

  it('the_transcript_shows_each_command_while_it_runs_and_how_it_ended_and_the_person_can_stop_a_running_one', async () => {
    const chat = await manager.create(profile, 'chat')
    await manager.send(chat.id, 'hi')
    commands.start(chat.id, 'sleep 30', 'a server', dir)
    await until(() => shown.some((s) => s.event.type === 'background_command' && s.event.state === 'running'), 'the running row')
    expect(manager.stopBackground(chat.id, 'bg1')).toBe(true)
    await until(() => shown.some((s) => s.event.type === 'background_command' && s.event.state === 'stopped'), 'the stopped row')
    expect(manager.stopBackground(chat.id, 'bg1')).toBe(false)

    commands.start(chat.id, 'exit 4', 'a failing one', dir)
    await until(() => shown.some((s) => s.event.type === 'background_command' && s.event.state === 'ended'), 'the ended row')
    const row = shown.map((s) => s.event).find((e) => e.type === 'background_command' && e.state === 'ended')
    expect(row).toMatchObject({ id: 'bg2', exitCode: 4, purpose: 'a failing one' })
    expect(allSent().length).toBeGreaterThan(0)
  })
})
