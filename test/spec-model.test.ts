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
- **Question tool**: a model asks through a question tool (docs/intent/agent.md#Questions)
- **Several at once**: a request carries one or more questions
  - **No options**: a question with no options → free-text only, text required

## Answering
- **Free text**: free text is always accepted [removed]
  - **Multi-select and text**: multi-select plus text → both are the answer
  - **Single-select and text**: single-select plus text → the text is the answer

## Open questions
- **Choice with text**: may a single-select question take text and a choice?
`

describe('spec contract', () => {
  it('a_rule_is_named_by_its_bold_lead_in_and_cited_after_its_text', () => {
    const parsed = parseSpec(spec)
    expect(parsed.problems).toEqual([])
    expect(parsed.title).toBe('User question')
    expect(parsed.goal).toBe("A session asks a structured question instead of guessing.\nThe answer returns as the tool's own result.")
    expect(parsed.scenarios.map((s) => s.title)).toEqual(['Asking a question', 'Answering'])
    expect(parsed.scenarios[0]!.intro).toBe('The model side of the exchange.')
    expect(parsed.scenarios[0]!.behaviours).toEqual([
      { name: 'Question tool', text: 'a model asks through a question tool', citation: 'docs/intent/agent.md#Questions', removed: false, edges: [] },
      {
        name: 'Several at once',
        text: 'a request carries one or more questions',
        removed: false,
        edges: [{ name: 'No options', text: 'a question with no options → free-text only, text required', removed: false }],
      },
    ])
    expect(parsed.scenarios[1]!.behaviours[0]).toMatchObject({ name: 'Free text', text: 'free text is always accepted [removed]', removed: true })
    expect(parsed.scenarios[1]!.behaviours[0]!.edges.map((e) => e.name)).toEqual(['Multi-select and text', 'Single-select and text'])
    expect(parsed.questions).toEqual([{ name: 'Choice with text', text: 'may a single-select question take text and a choice?', removed: false }])
  })

  it('a_citation_sits_between_the_text_and_the_markers_and_a_parenthesis_without_a_hash_is_prose', () => {
    const one = (line: string) => parseSpec(`## Goal\ng\n\n## S\n${line}\n`).scenarios[0]!.behaviours[0]!
    expect(one('- **A**: the text (docs/x.md#Heading with spaces) [removed]')).toMatchObject({
      text: 'the text [removed]',
      citation: 'docs/x.md#Heading with spaces',
      removed: true,
    })
    expect(one('- **A**: the text (tests by default)')).toMatchObject({ text: 'the text (tests by default)' })
    expect(one('- **A**: the text (tests by default)').citation).toBeUndefined()
    // A colon inside the bold and a rename note are read the same way.
    expect(one('- **A:** the text')).toMatchObject({ name: 'A', text: 'the text' })
    expect(one('- **A** (was B1): the text')).toMatchObject({ name: 'A', text: 'the text' })
  })

  it('flattens_every_rule_in_file_order_under_its_scenario_for_the_review', () => {
    expect(specItems(parseSpec(spec)).map((i) => [i.name, i.section, i.removed])).toEqual([
      ['Question tool', 'Asking a question', false],
      ['Several at once', 'Asking a question', false],
      ['No options', 'Asking a question', false],
      ['Free text', 'Answering', true],
      ['Multi-select and text', 'Answering', false],
      ['Single-select and text', 'Answering', false],
      ['Choice with text', 'Open questions', false],
    ])
    // The citation rides in the text, the form a comment carries to the agent.
    expect(specItems(parseSpec(spec))[0]!.text).toBe('a model asks through a question tool (docs/intent/agent.md#Questions)')
    expect(scenarioOf(parseSpec(spec), 'Single-select and text')?.title).toBe('Answering')
    expect(scenarioOf(parseSpec(spec), 'Choice with text')).toBeUndefined()
  })

  it('names_every_departure_from_the_contract_with_its_line', () => {
    const off = `# X
Stray prose.

## Goal
- **Goal rule**: a rule in the goal

## Behaviour
- **A**: a rule
  - **B**: fine
    - **C**: too deep
- a rule without a name
- **Bad, name**: punctuation
### Sub
Trailing prose.

## Open questions
- not a question
- **Q**: fine

## Decisions
### Untitled
- proposed: no finding
stray line
`
    const { problems } = parseSpec(off)
    expect(problems).toEqual([
      'line 2: "Stray prose.": text before the first section; the spec starts with `## Goal`.',
      'line 5: Goal rule: Goal is prose; a rule belongs in a scenario.',
      'line 10: C: nested too deep; a scenario holds rules, a rule holds edge cases, and that is all.',
      'line 11: "- a rule without a name": a rule without a name; a rule is `- **Name**: text`.',
      'line 12: "Bad, name": a name has no `* , : ( )` in it.',
      'line 13: "### Sub": sub-headings are not part of the contract; a scenario is a `##` heading, its rules are items.',
      'line 14: "Trailing prose.": prose after a scenario\'s items; a rule is an item, a remark belongs in the intro.',
      'line 17: "- not a question": Open questions holds `- **Name**: question` items only.',
      'line 20: a `## Decisions` section; decisions live in the feature\'s decisions file, and Repair moves them there: leave the section alone.',
      // The goal held an item and no prose, so there is no goal.
      'no `## Goal` section.',
    ])
  })

  it('a_decisions_section_left_in_a_spec_is_one_problem_and_its_lines_are_not_read_as_rules', () => {
    const legacy = `${spec}\n## Decisions\n### The tool refuses an empty answer\n- on: Free text\n- finding: the code says otherwise\n`
    const parsed = parseSpec(legacy)
    expect(parsed.problems).toHaveLength(1)
    expect(parsed.problems[0]).toContain('`## Decisions` section')
    expect(parsed.scenarios.map((s) => s.title)).toEqual(['Asking a question', 'Answering'])
  })

  it('a_spec_without_goal_or_scenario_or_with_a_reused_name_is_off_contract', () => {
    expect(parseSpec('# X\n').problems).toEqual(['no `## Goal` section.', 'no scenario: at least one `##` section with the rules.'])
    expect(parseSpec('# X\n\n## Goal\ng\n\n## Empty\n').problems).toEqual(['scenario "Empty" has no rule.'])
    expect(parseSpec('# X\n\n## Goal\ng\n\n## S\n- **A**: a\n- **a**: b\n').problems).toEqual([
      'line 8: "a" is used twice; a name belongs to one rule for good.',
    ])
  })

  it('the_fingerprint_follows_the_plan', () => {
    const base = specFingerprint(parseSpec(spec))
    expect(base).toMatch(/^[0-9a-f]{8}$/)
    expect(specFingerprint(parseSpec(spec))).toBe(base)
    expect(specFingerprint(parseSpec(spec.replace('a request carries', 'one request carries')))).not.toBe(base)
    expect(specFingerprint(parseSpec(spec.replace('may a single-select', 'must a single-select')))).not.toBe(base)
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
      expect(outcome?.additionalContext).toContain('- I1: x')
      // Other files and other tools are none of the contract's business.
      await writeFile(join(dir, 'plan', 'x.tasks.md'), '- I1: x\n')
      expect(await write('plan/x.tasks.md')).toBeUndefined()
      expect(await hook.postToolUse({ toolName: 'Read', input: { file_path: 'plan/x.spec.md' }, toolUseId: 't', output: '', isError: false })).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
