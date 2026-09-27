---
name: run-script
description: Writing programs for the RunScript tool, which runs JavaScript in a sandbox with file, search and shell access. Use for analysis over many files, cross-referencing contents, or the same edit across many files, instead of one tool call per file.
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
- `glob({ pattern, path? })`, `grep({ pattern, path?, include?, case_insensitive?, output_mode? })`:
  the same as the Glob and Grep tools, returning their text.
- `jsonQuery(args)`, `jsonSchema(args)`: the same as the tools of that name.
- `bash({ command, description? })`: the same as the Bash tool, asked per command as usual.
  A denied or failing call throws; catch it to carry on.

Changing files, staged:

- `write(path, content)`, `edit({ file_path, old_string, new_string, replace_all? })`,
  `replace(path, pattern, replacement, flags = 'g')`.
- Nothing is written while the script runs. Changes are collected, and when the script ends the
  user sees every changed file as one diff and approves or declines the whole set.
- `read` returns the staged content of a file the script has already changed.
- `replace` takes a regular expression and `$1`-style groups; it returns
  `{ path, matches, changed }`. No match stages nothing.
- `preview()` returns the staged diffs as text. Use it as a dry run: return it and look before
  deciding on a second script.
- `edit` follows the Edit tool: `old_string` must occur once unless `replace_all` is set.

## Examples

Rename a call across the project:

```js
const files = (await glob({ pattern: 'src/**/*.ts' })).split('\n').filter(Boolean)
let total = 0
for (const f of files) total += (await replace(f, '\\bgetUser\\(', 'fetchUser(')).matches
return `${total} calls in ${files.length} files`
```

Find files that import a module but never use its default export:

```js
const hits = []
for (const f of (await glob({ pattern: 'src/**/*.ts' })).split('\n').filter(Boolean)) {
  const text = await read(f)
  if (/from '\.\/legacy'/.test(text) && !/\blegacy\./.test(text)) hits.push(f)
}
return hits
```

## Limits

A script has a time budget for its own computation (waiting on a prompt does not count) and a
memory limit. A runaway loop or a pattern that backtracks without end is stopped and reported as
a failure. Keep scripts short and return only what you need to read.
