import { describe, expect, it } from 'vitest'
import { buildTypeIndex, renderTypeIndex, scanPublicTypes } from '../src/agent/repo-map/type-index'

const csharp = `using System;

namespace Demo;

public class Widget : Base, IThing
{
    private readonly string _text = "x";
    internal int Hidden;

    public int Count { get; set; }

    public async Task<Result> RunAsync<T>(T input) where T : class
    {
        var local = Secret();
    }

    private void Secret() { }
}

public enum Kind { A, B }

class Internal
{
    public int NotReached;
}
`

const typescript = `import { join } from 'node:path'

export interface Options {
  name: string
  retries?: number
}

export class Box {
  private hidden = 1
  readonly size: number = 0
  handle(event: string): void {
    const inner = { a: 1 }
  }
  get label(): string {
    return ''
  }
}

export function helper(a: number): string {
  return ''
}

function notExported(): void {}
`

const shape = (text: string, path: string): Record<string, string[]> =>
  Object.fromEntries((scanPublicTypes(path, text) ?? []).map((t) => [t.name, t.members]))

describe('type index', () => {
  it('public_types_and_their_public_members_come_from_the_scan_of_csharp_and_typescript_source', () => {
    expect(shape(csharp, 'src/Widget.cs')).toEqual({
      Widget: ['public int Count { get; set; }', 'public async Task<Result> RunAsync<T>(T input) where T : class'],
      Kind: [],
    })
    expect(shape(typescript, 'src/box.ts')).toEqual({
      Options: ['name: string', 'retries?: number'],
      Box: ['readonly size: number = 0', 'handle(event: string): void', 'get label(): string'],
      helper: [],
    })
  })

  it('a_file_the_scan_cannot_parse_is_left_out_named_as_skipped_and_does_not_fail_the_build', () => {
    const index = buildTypeIndex([
      { path: 'src/Widget.cs', text: csharp },
      { path: 'src/Broken.cs', text: 'public class Broken {\n  public void Half() {\n' },
      { path: 'src/blob.ts', text: 'export class Blob {}\u0000' },
      { path: 'src/notes.txt', text: 'public class NotSource {}' },
    ])
    expect(index.types.map((t) => t.name)).toEqual(['Widget', 'Kind'])
    expect(index.skipped).toEqual(['src/Broken.cs', 'src/blob.ts', 'src/notes.txt'].sort())
    const text = renderTypeIndex('Api', index)
    expect(text).toContain('## Skipped: the scan could not read these files')
    expect(text).toContain('src/Broken.cs')
  })

  it('the_index_renders_one_line_per_type_and_per_member_under_the_file_it_came_from', () => {
    const index = buildTypeIndex([{ path: 'src/box.ts', text: typescript }])
    expect(renderTypeIndex('web', index).split('\n')).toEqual([
      '# Public types: web',
      '',
      '3 public types.',
      '',
      '## src/box.ts',
      'export interface Options (line 3)',
      '  name: string',
      '  retries?: number',
      'export class Box (line 8)',
      '  readonly size: number = 0',
      '  handle(event: string): void',
      '  get label(): string',
      'export function helper(a: number): string (line 19)',
    ])
  })
})
