import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SpecContract, parseSpec, scenarioOf, specFingerprint, specItems } from '../src/agent/phases/spec-model'

const spec = `# User question

## Goal
A session asks a structured question instead of guessing.
The answer returns as the tool's own result.

## Asking a question
The model side of the exchange.
- B1 (docs/intent/agent.md#Questions): a model asks through a question tool
- B2: a request carries one or more questions
  - E3: a question with no options → free-text only, text required

## Answering
- B4: free text is always accepted [removed]
  - E1: multi-select plus text → both are the answer
  - E2: single-select plus text → the text is the answer

## Open questions
- Q1: may a single-select question take text and a choice?

## Findings
| Finding | Proposed solution |
|---|---|
| F1 (contradiction, B1): the code says otherwise | keep B1 |
`

describe('spec contract', () => {
  it('reads_scenarios_with_behaviours_and_their_edge_cases_nested', () => {
    const parsed = parseSpec(spec)
    expect(parsed.problems).toEqual([])
    expect(parsed.title).toBe('User question')
    expect(parsed.goal).toBe("A session asks a structured question instead of guessing.\nThe answer returns as the tool's own result.")
    expect(parsed.scenarios.map((s) => s.title)).toEqual(['Asking a question', 'Answering'])
    expect(parsed.scenarios[0]!.intro).toBe('The model side of the exchange.')
    expect(parsed.scenarios[0]!.behaviours).toEqual([
      { id: 'B1', text: 'a model asks through a question tool', citation: 'docs/intent/agent.md#Questions', removed: false, edges: [] },
      {
        id: 'B2',
        text: 'a request carries one or more questions',
        removed: false,
        edges: [{ id: 'E3', text: 'a question with no options → free-text only, text required', removed: false }],
      },
    ])
    expect(parsed.scenarios[1]!.behaviours[0]).toMatchObject({ id: 'B4', removed: true })
    expect(parsed.scenarios[1]!.behaviours[0]!.edges.map((e) => e.id)).toEqual(['E1', 'E2'])
    expect(parsed.questions).toEqual([{ id: 'Q1', text: 'may a single-select question take text and a choice?', removed: false }])
    expect(parsed.findings.map((f) => f.id)).toEqual(['F1'])
  })

  it('flattens_every_item_in_file_order_under_its_scenario_for_the_review', () => {
    expect(specItems(parseSpec(spec)).map((i) => [i.id, i.section, i.removed])).toEqual([
      ['B1', 'Asking a question', false],
      ['B2', 'Asking a question', false],
      ['E3', 'Asking a question', false],
      ['B4', 'Answering', true],
      ['E1', 'Answering', false],
      ['E2', 'Answering', false],
      ['Q1', 'Open questions', false],
      ['F1', 'Findings', false],
    ])
    // The citation rides in the text, the form a comment carries to the agent.
    expect(specItems(parseSpec(spec))[0]!.text).toBe('(docs/intent/agent.md#Questions) a model asks through a question tool')
    expect(scenarioOf(parseSpec(spec), 'E2')?.title).toBe('Answering')
    expect(scenarioOf(parseSpec(spec), 'Q1')).toBeUndefined()
  })

  it('names_every_departure_from_the_contract_with_its_line', () => {
    const off = `# X
Stray prose.

## Goal
- B9: a rule in the goal

## Behaviour
- B1: a rule
- E1: an edge at top level
  - E2: fine
    - E3: too deep
- I1: an invariant
- T1: a task
### Sub
Trailing prose.

## Invariants
- I2: restated

## Open questions
- B5: not a question

## Findings
- F1: not a row
`
    const { problems } = parseSpec(off)
    expect(problems).toEqual([
      'line 2: "Stray prose.": text before the first section; the spec starts with `## Goal`.',
      'line 5: B9: Goal is prose; a rule belongs in a scenario.',
      'line 9: E1: only behaviours (B) sit directly under a scenario; an edge case is indented under the behaviour it qualifies.',
      'line 11: E3: nested too deep; a scenario holds behaviours, a behaviour holds edge cases, and that is all.',
      'line 12: I1: only behaviours (B) sit directly under a scenario; an invariant or acceptance criterion is a behaviour, or restates one and goes.',
      'line 13: T1: only behaviours (B) sit directly under a scenario; tasks live in the tasks file, written when the spec is mapped against the code.',
      'line 14: "### Sub": sub-headings are not part of the contract; a scenario is a `##` heading, its rules are items.',
      'line 15: "Trailing prose.": prose after a scenario\'s items; a rule is an item, a remark belongs in the intro.',
      'line 18: I2: only behaviours (B) sit directly under a scenario; an invariant or acceptance criterion is a behaviour, or restates one and goes.',
      'line 21: B5: only questions (Q) go under Open questions; a rule belongs in a scenario.',
      'line 24: F1: Findings is a table, one row per finding.',
      // The goal held an item and no prose, so there is no goal.
      'no `## Goal` section.',
    ])
  })

  it('a_spec_without_goal_or_scenario_or_with_a_reused_id_is_off_contract', () => {
    expect(parseSpec('# X\n').problems).toEqual(['no `## Goal` section.', 'no scenario: at least one `##` section with the behaviours.'])
    expect(parseSpec('# X\n\n## Goal\ng\n\n## Empty\n').problems).toEqual(['scenario "Empty" has no behaviour.'])
    expect(parseSpec('# X\n\n## Goal\ng\n\n## S\n- B1: a\n- B1: b\n').problems).toEqual(['line 8: B1 is used twice; an id belongs to one item for good.'])
  })

  it('the_fingerprint_follows_the_plan_and_ignores_the_findings', () => {
    const base = specFingerprint(parseSpec(spec))
    expect(base).toMatch(/^[0-9a-f]{8}$/)
    expect(specFingerprint(parseSpec(spec.replace('| keep B1 |', '| drop B1 |')))).toBe(base)
    expect(specFingerprint(parseSpec(spec.replace('- B2: a request', '- B2: one request')))).not.toBe(base)
    expect(specFingerprint(parseSpec(spec.replace('- Q1: may', '- Q1: must')))).not.toBe(base)
  })
})

describe('SpecContract hook', () => {
  it('hands_the_problems_back_on_the_write_that_caused_them_and_stays_quiet_otherwise', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'contract-'))
    try {
      await mkdir(join(dir, 'plan'))
      const hook = new SpecContract(dir)
      const write = (file: string) => hook.postToolUse({ toolName: 'Write', input: { file_path: file }, toolUseId: 't', output: 'ok', isError: false })
      await writeFile(join(dir, 'plan', 'x.spec.md'), `---\nstatus: draft\n---\n${spec}`)
      expect(await write('plan/x.spec.md')).toBeUndefined()
      await writeFile(join(dir, 'plan', 'x.spec.md'), '# X\n\n## Goal\ng\n\n## Invariants\n- I1: x\n')
      const outcome = await write(join(dir, 'plan', 'x.spec.md'))
      expect(outcome?.additionalContext).toContain('`plan/x.spec.md` is off contract')
      expect(outcome?.additionalContext).toContain('I1')
      // Other files and other tools are none of the contract's business.
      await writeFile(join(dir, 'plan', 'x.tasks.md'), '- I1: x\n')
      expect(await write('plan/x.tasks.md')).toBeUndefined()
      expect(await hook.postToolUse({ toolName: 'Read', input: { file_path: 'plan/x.spec.md' }, toolUseId: 't', output: '', isError: false })).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
