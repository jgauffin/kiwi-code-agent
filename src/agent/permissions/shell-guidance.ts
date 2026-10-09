/**
 * Said to every session, so the model reaches for a command that runs unasked
 * rather than for awk. awk's `system()`, `| "cmd"` and `print > file` make it
 * a shell of its own, so every awk run is asked; the commands named here cover
 * what awk is reached for in a pipeline, and the scratch file covers the rest.
 */
export const PIPE_WRITING =
  'Take a field or a column out of a command\'s output with the commands that only inspect, which run without a permission prompt: `tr -s \' \'` into `cut`, with `sort`, `uniq -c`, `wc`, `head`, `tail`, `comm`, `nl` and `column` beside them, and `jq` or `yq` for JSON and YAML. Never awk or perl for it: they run a program of their own, so the whole call is asked every time. Where a column is not enough and the answer is computed, redirect the output to a file in the scratch folder and read that from a RunScript program.'
