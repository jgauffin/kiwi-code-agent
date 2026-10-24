import { describe, expect, it } from 'vitest'
import { SleepGate } from '../src/agent/script/sleep-gate'

const run = (toolName: string, command: string) => ({ toolName, input: { command }, toolUseId: 'b' })
const denied = (outcome: unknown): string => (outcome && typeof outcome === 'object' && 'deny' in outcome ? String(outcome.deny) : '')

describe('the sleep gate', () => {
  it.each([['sleep 30'], ['sleep 1m'], ['npm run build && sleep 10 && curl x'], ['sleep 3 3']])(
    'a_long_sleep_is_refused_pointing_at_the_notice_the_wait_and_the_return: %s',
    async (command) => {
      const reason = denied(await new SleepGate().preToolUse(run('Bash', command)))
      expect(reason).toContain('notice')
      expect(reason).toContain('BackgroundWait')
      expect(reason).toContain('schedule')
    },
  )

  it.each([['Start-Sleep 10'], ['Start-Sleep -Seconds 30'], ['Start-Sleep -Milliseconds 9000']])(
    'a_long_Start_Sleep_is_refused: %s',
    async (command) => {
      expect(denied(await new SleepGate().preToolUse(run('PowerShell', command)))).not.toBe('')
    },
  )

  it('a_long_timeout_t_is_refused', async () => {
    expect(denied(await new SleepGate().preToolUse(run('PowerShell', 'timeout /t 60')))).not.toBe('')
  })

  it.each([['sleep 5'], ['sleep 0.5'], ['for i in 1 2 3; do curl -sf x && break; sleep 2; done']])(
    'a_short_sleep_between_retries_runs_as_before: %s',
    async (command) => {
      expect(await new SleepGate().preToolUse(run('Bash', command))).toBeUndefined()
    },
  )

  it.each([['Start-Sleep 3'], ['Start-Sleep -Milliseconds 500'], ['timeout /t 2'], ['timeout 600 npm test']])(
    'a_short_sleep_or_a_command_timeout_runs_as_before: %s',
    async (command) => {
      expect(await new SleepGate().preToolUse(run('PowerShell', command))).toBeUndefined()
    },
  )

  it('a_long_sleep_inside_a_background_command_is_refused_the_same_way', async () => {
    expect(denied(await new SleepGate().preToolUse(run('BackgroundBash', 'sleep 120; npm test')))).toContain('BackgroundWait')
  })
})
