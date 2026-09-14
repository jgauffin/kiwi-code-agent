import { x } from './x'

// a comment with { brace
const BRACES = '{'
const TEMPLATE = `a ${cond ? '{' : `}`} b`

export type Options = {
  a: string
}

export interface Shape {
  kind: string
}

export class Box<T> extends Base implements Shape {
  kind = 'box'
  handle = (e: Event) => {
    if (e) {
      return
    }
  }

  get size(): number {
    return 1
  }

  method(a: { b: string }): void {
    const inner = () => {
      return a.b
    }
    inner()
  }
}

export function plain(a: number): number {
  for (let i = 0; i < a; i++) {
    a++
  }
  return a
}

export const arrow = async ({ a }: Options): Promise<void> => {
  await x(a)
}

describe('suite', () => {
  it('case', () => {
    expect(1).toBe(1)
  })
  function helper() {
    return 2
  }
})

const obj = {
  nested: {
    deep: 1,
  },
}
