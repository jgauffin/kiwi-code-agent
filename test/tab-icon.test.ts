import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { awaitsUser, type SessionStatus } from '../src/agent/session/session-status'

/** The statuses whose tab wears the pulsing icon, and those whose tab stays still. */
const pulsing: SessionStatus[] = ['needs_human', 'needs_approval', 'needs_answer']
const still: SessionStatus[] = ['idle', 'planning', 'implementing', 'error']

/** The chunk types in file order, each with its payload. */
function chunks(png: Buffer): { type: string; data: Buffer }[] {
  const out: { type: string; data: Buffer }[] = []
  let at = 8
  while (at < png.length) {
    const length = png.readUInt32BE(at)
    out.push({ type: png.toString('ascii', at + 4, at + 8), data: png.subarray(at + 8, at + 8 + length) })
    at += 12 + length
  }
  return out
}

describe('waiting tab icon', () => {
  it('a_session_stopped_on_the_user_is_what_makes_the_tab_pulse', () => {
    expect(pulsing.filter(awaitsUser)).toEqual(pulsing)
    expect(still.filter(awaitsUser)).toEqual([])
  })

  it('the_waiting_icon_is_an_animated_png_that_loops_for_as_long_as_the_session_waits', async () => {
    const found = chunks(await readFile(join(process.cwd(), 'docs', 'logos', 'head-waiting.png')))
    const types = found.map((c) => c.type)
    const actl = found.find((c) => c.type === 'acTL')?.data
    if (!actl) throw new Error('no acTL chunk: the icon is a still image')
    // acTL must precede the first IDAT, or a decoder reads the file as a still image.
    expect(types.indexOf('acTL')).toBeLessThan(types.indexOf('IDAT'))
    expect(actl.readUInt32BE(0)).toBeGreaterThan(1)
    expect(types.filter((t) => t === 'fcTL')).toHaveLength(actl.readUInt32BE(0))
    expect(actl.readUInt32BE(4)).toBe(0)
  })
})
