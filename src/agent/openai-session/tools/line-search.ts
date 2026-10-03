import { isAbsolute, relative, resolve } from 'node:path'
import { walk } from './grep'
import { clip, searchPattern, type SearchQuery } from './search-text'
import { fail, ok, truncate, type ToolContext, type ToolOutput } from './tool'

/** What a search over files is asked for, past the query itself. */
export type FileSearchInput = SearchQuery & { path?: string | undefined; limit?: number | undefined }

/** One matching line with the parse of the file it sits in; `file` is the path as the answer shows it. */
export type LineMatch<Parsed> = { file: string; line: number; text: string; parsed: Parsed }

/** Where a match sits, as the search reports it. */
export type Placed<Item> = {
  /** The heading it is listed under; the matches sharing one are listed under it once. */
  title: string
  /** What tells two places apart where their titles read alike; the title itself when that already does. */
  place?: string
  /** The match as a script gets it, uncut. */
  item: Item
}

/** The kind of file a search reads, and what it makes of a match in one. */
export type SearchSubject<Parsed extends object, Item> = {
  /** One file as the count of those read names it: "source file", "markdown file". */
  fileNoun: string
  /** One place the matches group under: a declaration is a "place", a heading a "section". */
  placeNoun: string
  includes(path: string): boolean
  /** Undefined for a file that cannot be read or is too large to be; it is passed over. */
  read(path: string): Promise<string | undefined>
  lines(text: string): string[]
  /** Read once per file that has a match, so a file without one is never parsed. Takes the full path. */
  parse(path: string, text: string): Parsed
  place(match: LineMatch<Parsed>): Placed<Item>
}

type Shown = { title: string; line: number; text: string }

/**
 * A search for lines over a walk of the workspace: one pass whatever the kind
 * of file, with the subject saying which files are read and where a match
 * sits. Every match reaches a script, while the model is shown the first
 * `limit` of them, grouped under the place each sits in.
 *
 * `canRead` is the session's read scope; a scope guard checks only the path
 * the search starts from, so a search over a folder would otherwise hand back
 * the content of files the session is kept from.
 */
export class LineSearch<Parsed extends object, Item> {
  constructor(
    private readonly subject: SearchSubject<Parsed, Item>,
    private readonly canRead: (relPath: string) => boolean = () => true,
  ) {}

  async execute(input: FileSearchInput, ctx: ToolContext): Promise<ToolOutput> {
    let pattern: RegExp
    try {
      pattern = searchPattern(input)
    } catch (error) {
      return fail(`Invalid regular expression: ${(error as Error).message}`)
    }
    const root = input.path ? (isAbsolute(input.path) ? input.path : resolve(ctx.cwd, input.path)) : ctx.cwd
    const limit = input.limit ?? 50
    const shown: Shown[] = []
    const places = new Set<string>()
    const items: Item[] = []
    let searched = 0

    for await (const full of walk(root, undefined)) {
      if (ctx.signal.aborted) return fail('Search interrupted')
      const file = relative(ctx.cwd, full).split('\\').join('/') || full
      if (!this.subject.includes(full) || !this.canRead(file)) continue
      const text = await this.subject.read(full).catch(() => undefined)
      if (text === undefined) continue
      searched++
      const lines = this.subject.lines(text)
      let parsed: Parsed | undefined
      for (let i = 0; i < lines.length; i++) {
        const found = pattern.exec(lines[i]!)
        if (!found) continue
        parsed ??= this.subject.parse(full, text)
        const placed = this.subject.place({ file, line: i + 1, text: lines[i]!, parsed })
        places.add(placed.place ?? placed.title)
        items.push(placed.item)
        if (shown.length < limit) shown.push({ title: placed.title, line: i + 1, text: clip(lines[i]!, found.index) })
      }
    }

    const { fileNoun } = this.subject
    if (items.length === 0) return ok(`No matches in ${searched} ${fileNoun}${searched === 1 ? '' : 's'}.`, [])
    return ok(truncate(this.render(shown, items.length, places.size)), items)
  }

  private render(shown: Shown[], matched: number, places: number): string {
    const out: string[] = []
    let current = ''
    for (const hit of shown) {
      if (hit.title !== current) {
        out.push(hit.title)
        current = hit.title
      }
      out.push(`  ${hit.line}: ${hit.text}`)
    }
    const { placeNoun } = this.subject
    out.push('', `${matched} match${matched === 1 ? '' : 'es'} in ${places} ${placeNoun}${places === 1 ? '' : 's'}, ${shown.length} shown.`)
    return out.join('\n')
  }
}
