import { describe, expect, it } from 'vitest'
import { ScriptGate } from '../src/agent/script/script-gate'

const bash = (command: string) => ({ toolName: 'Bash', input: { command }, toolUseId: 'b' })
const denied = (outcome: unknown): string => (outcome && typeof outcome === 'object' && 'deny' in outcome ? String(outcome.deny) : '')

describe('the script gate', () => {
  it.each([
    ["python - <<'EOF'\ns = open('a.cs').read()\nEOF"],
    ['cd /tmp && python3 -c "import zipfile"'],
    ['node -e "console.log(1)"'],
    ['powershell -NoProfile -Command "(Get-Content a.cs -Raw) -replace \'x\', \'y\' | Set-Content a.cs"'],
    ["perl -pi -e 's/x/y/' a.cs"],
  ])('an_inline_program_through_the_shell_is_pointed_at_RunScript: %s', async (command) => {
    expect(denied(await new ScriptGate().preToolUse(bash(command)))).toContain('RunScript')
  })

  it('the_same_command_again_goes_through_for_what_RunScript_cannot_do', async () => {
    const gate = new ScriptGate()
    const command = 'python3 -c "import zipfile; print(zipfile.ZipFile(\'a.xlsx\').namelist())"'
    expect(denied(await gate.preToolUse(bash(command)))).not.toBe('')
    expect(await gate.preToolUse(bash(command))).toBeUndefined()
  })

  it.each([['npm test'], ['python tools/gen.py'], ['node --version'], ['dotnet test Suite.csproj']])('a_program_run_from_a_file_or_a_plain_command_goes_through: %s', async (command) => {
    expect(await new ScriptGate().preToolUse(bash(command))).toBeUndefined()
  })
})
