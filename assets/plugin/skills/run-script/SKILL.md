---
name: run-script
description: Writing programs for the RunScript tool, which runs JavaScript in a sandbox with file and search access. Use for analysis over many files, cross-referencing contents, or the same edit across many files, instead of one tool call per file.
---

# RunScript

The script is the body of an async function: `await` and `return` work at the top level. It runs
in an isolated interpreter with no Node, `require`, `fetch` or filesystem of its own. It can only
call the functions below, and each call is checked against the same permission rules as your own
tool calls. What the script returns or logs with `console.log` is the result you get back;
nothing else from the run reaches you, so return a summary, not raw contents.

## Functions

Reading and searching, no prompt:

- `read(path)`: the whole file as text, not numbered and not cut.
- `readdir(path = '.')`: the names in a directory, sorted, each directory marked by a trailing
  slash. `exists(path)`: whether there is anything at the path. Both are free within the project;
  a path outside it is put to the user.
- `glob({ pattern, path? })`, `grep({ pattern, path?, include?, case_insensitive?, output_mode? })`:
  the same as the Glob and Grep tools, returning an array: paths for `glob` and for `grep` with
  `output_mode: 'files_with_matches'`, `file:line:text` lines otherwise. Empty when nothing
  matches. Every match is in the array, also past what the tools show you.
- `codeSearch({ query, path?, regex?, case_sensitive? })`: every match as
  `{ file, line, text, declaration, inDoc, start, end }`, where `declaration` is the qualified name
  of what the line sits in (`Cart.total`, null outside any) and `start`-`end` its lines.
- `markdownSearch({ query, path?, regex?, case_sensitive? })`: every match as
  `{ file, line, text, heading, start, end }`, `heading` being the section it sits in (null before the first).
- `specSearch({ query, regex?, case_sensitive? })`: every matching rule, open question or goal in
  `specs/*.spec.md` as `{ file, feature, status, kind, scenario, name, text, citation, edges }`,
  `kind` being `rule`, `question` or `goal` and `edges` a rule's edge cases as `{ name, text, citation }`.
- `jsonQuery(args)`, `jsonSchema(args)`, `codeOutline({ path, symbol })`: the same as the tools of that name.
- A denied or failing call throws; catch it to carry on.

Changing files, staged:

- `write(path, content)`, `edit({ file_path, old_string, new_string, replace_all? })`,
  `replace(path, pattern, replacement, flags = 'g')`, `move(source, destination)`,
  `copy(source, destination)`, `remove(path)`.
- Nothing is written while the script runs. Changes are collected, and when the script ends the
  user sees every changed file as one diff and approves or declines the whole set.
- `read` returns the staged content of a file the script has already changed.
- `replace` takes a regular expression and `$1`-style groups; it returns
  `{ path, matches, changed }`. No match stages nothing.
- `preview()` returns the staged diffs as text. Use it as a dry run: return it and look before
  deciding on a second script.
- `edit` follows the Edit tool: `old_string` must occur once unless `replace_all` is set.
- `move` and `copy` take text files and never overwrite the destination; a move is shown as the
  new file plus the old one removed. For a folder, glob its files and move each. A binary file
  goes through the Move or Copy tool instead. After `remove`, `read` and `exists` see the file as gone.

Not in a script: shell commands, asking the user, loading a skill and the task board. A loop of
commands would be a loop of permission prompts, and the others' answers are for you to weigh;
call them yourself before or after the script.

## Examples

Rename a call across the project:

```js
const files = await glob({ pattern: 'src/**/*.ts' })
let total = 0
for (const f of files) total += (await replace(f, '\\bgetUser\\(', 'fetchUser(')).matches
return `${total} calls in ${files.length} files`
```

Summarise a log in every run directory that has one:

```js
const rows = []
for (const dir of await readdir('.kiwi/runs')) {
  const file = `.kiwi/runs/${dir}events.jsonl`
  if (!(await exists(file))) continue
  const events = (await read(file)).split('\n').filter(Boolean).map((l) => JSON.parse(l))
  rows.push(`${dir} ${events.length} events`)
}
return rows.join('\n')
```

Find files that import a module but never use its default export:

```js
const hits = []
for (const f of await glob({ pattern: 'src/**/*.ts' })) {
  const text = await read(f)
  if (/from '\.\/legacy'/.test(text) && !/\blegacy\./.test(text)) hits.push(f)
}
return hits
```

## Limits

A script has a time budget for its own computation (waiting on a prompt does not count) and a
memory limit. A runaway loop or a pattern that backtracks without end is stopped and reported as
a failure. Keep scripts short and return only what you need to read.
