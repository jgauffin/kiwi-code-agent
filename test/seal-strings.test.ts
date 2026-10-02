import { describe, expect, it } from 'vitest'
import { SEAL_DECODER, sealSource } from '../scripts/seal-strings.mjs'

const LONG = 'Read the spec and check every rule against the code before you write a line'

/** The sealed code run as the bundle runs it: the decoder first, then the code, which fills `out`. */
function run(source: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  new Function('require', 'out', SEAL_DECODER + sealSource(source, 'sample.ts'))(require, out)
  return out
}

describe('sealSource', () => {
  it('a_long_string_and_template_are_not_readable_in_the_output_and_evaluate_to_the_same_text', () => {
    const source = [
      `declare const out: Record<string, unknown>`,
      `const name: string = 'task 3'`,
      `const when = new Date(0)`,
      `out.plain = '${LONG}'`,
      `out.template = \`${LONG}: \${name}, then \${when} and \${1 + 1}\``,
    ].join('\n')
    expect(sealSource(source, 'sample.ts')).not.toContain('check every rule')
    const out = run(source)
    expect(out['plain']).toBe(LONG)
    expect(out['template']).toBe(`${LONG}: task 3, then ${new Date(0)} and 2`)
  })

  it('names_specifiers_short_strings_and_tagged_templates_stay_as_written', () => {
    const source = [
      `import { a } from './a-module-path-that-is-long-enough-to-be-sealed-if-it-were-not-a-specifier'`,
      `type Kind = '${LONG}'`,
      `const o: { k?: Kind } = { '${LONG}': 1, short: 'short text' } as never`,
      `const t = String.raw\`${LONG}\``,
      `console.log(a, o, t)`,
    ].join('\n')
    const sealed = sealSource(source, 'sample.ts')
    expect(sealed).toContain('a-module-path-that-is-long-enough')
    expect(sealed).toContain(`'short text'`)
    // Once as the property name, once in the tagged template; the type is erased.
    expect(sealed.split(LONG).length - 1).toBe(2)
  })
})
