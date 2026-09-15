import { describe, expect, it } from 'vitest'
import { splitShellCommand } from '../src/agent/permissions/shell-split'

const tokens = (command: string) => splitShellCommand(command).segments.map((s) => s.tokens)
const texts = (command: string) => splitShellCommand(command).segments.map((s) => s.text)

/** Rules from the POSIX Shell Command Language (2.2 quoting, 2.3 tokens, 2.6 expansion, 2.7 redirection, 2.9–2.10 grammar) and bash's additions. */
describe('splitShellCommand', () => {
  describe('lists and pipelines', () => {
    it('splits_on_control_operators_and_keeps_quoted_operators_as_text', () => {
      expect(tokens('npm test && echo "a && b" | grep a; ls || true\nrm x & pwd')).toEqual([
        ['npm', 'test'],
        ['echo', 'a && b'],
        ['grep', 'a'],
        ['ls'],
        ['true'],
        ['rm', 'x'],
        ['pwd'],
      ])
    })

    it('pipes_that_carry_stderr_split_like_pipes', () => {
      expect(tokens('npm test |& tee out')).toEqual([['npm', 'test'], ['tee', 'out']])
    })

    it('each_segment_keeps_its_text_as_written_without_the_operators_around_it', () => {
      expect(texts('npm test 2>&1 && echo "a && b" | grep a;  ls -la > out.txt\nrm x')).toEqual(['npm test 2>&1', 'echo "a && b"', 'grep a', 'ls -la > out.txt', 'rm x'])
    })
  })

  describe('quoting', () => {
    it('honours_single_quotes_double_quotes_and_backslash_escapes', () => {
      const { segments } = splitShellCommand(`git commit -m 'it''s done' "x\\"y" a\\ b`)
      expect(segments[0]!.tokens).toEqual(['git', 'commit', '-m', 'its done', 'x"y', 'a b'])
    })

    it('ansi_c_quoting_resolves_escapes_and_a_quoted_operator_stays_text', () => {
      expect(tokens(`printf $'a;b\\n' && echo $"x|y"`)).toEqual([['printf', 'a;b\n'], ['echo', 'x|y']])
    })

    it('a_backslash_newline_joins_lines_inside_and_outside_double_quotes', () => {
      expect(tokens('npm run \\\n  build && echo "a\\\nb"')).toEqual([['npm', 'run', 'build'], ['echo', 'ab']])
    })

    it('a_hash_starts_a_comment_only_at_the_start_of_a_word', () => {
      expect(tokens('ls # && rm x\n# rm y\necho a#b')).toEqual([['ls'], ['echo', 'a#b']])
    })
  })

  describe('expansions', () => {
    it('command_substitution_and_process_substitution_flag_the_whole_command', () => {
      expect(splitShellCommand('echo $(rm -rf x)').substitutes).toBe(true)
      expect(splitShellCommand('echo `rm x`').substitutes).toBe(true)
      expect(splitShellCommand('diff <(ls a) <(ls b)').substitutes).toBe(true)
      expect(splitShellCommand('echo "$(ls)"').substitutes).toBe(true)
      expect(splitShellCommand("echo '$(ls)'").substitutes).toBe(false)
      expect(splitShellCommand('ls').substitutes).toBe(false)
    })

    it('operators_inside_a_substitution_belong_to_it_and_do_not_split_the_command', () => {
      expect(tokens('echo $(ls; rm x | wc) done')).toEqual([['echo', '$(ls; rm x | wc)', 'done']])
      expect(tokens('echo "$(echo ")"; ls)" && pwd')).toEqual([['echo', '$(echo ")"; ls)'], ['pwd']])
      expect(tokens('echo `ls; rm x` && pwd')).toEqual([['echo', '`ls; rm x`'], ['pwd']])
    })

    it('parameter_and_arithmetic_expansions_are_words_and_run_nothing_unless_they_substitute', () => {
      const plain = splitShellCommand('echo ${x:-a;b} $((1+2)) && pwd')
      expect(plain.segments.map((s) => s.tokens)).toEqual([['echo', '${x:-a;b}', '$((1+2))'], ['pwd']])
      expect(plain.substitutes).toBe(false)
      expect(splitShellCommand('echo $(( $(ls | wc -l) + 1 ))').substitutes).toBe(true)
    })
  })

  describe('redirection', () => {
    it('a_redirect_to_a_file_marks_the_segment_as_writing_but_dev_null_and_fd_dups_do_not', () => {
      const writes = (c: string) => splitShellCommand(c).segments[0]!.writesFile
      expect(writes('echo hi > out.txt')).toBe(true)
      expect(writes('cat a >> b')).toBe(true)
      expect(writes('echo hi >| out.txt')).toBe(true)
      expect(writes('cmd &> log')).toBe(true)
      expect(writes('cmd &>> log')).toBe(true)
      expect(writes('cmd 2> err.txt')).toBe(true)
      expect(writes('cmd 3<> rw.txt')).toBe(true)
      expect(writes('ls 2>/dev/null')).toBe(false)
      expect(writes('ls >NUL')).toBe(false)
      expect(writes('npm test 2>&1')).toBe(false)
      expect(writes('cmd >&-')).toBe(false)
      expect(writes('cmd <&3')).toBe(false)
      expect(writes('sort < in.txt')).toBe(false)
      expect(writes('cmd {fd}>out.txt')).toBe(true)
    })

    it('a_redirect_target_is_never_a_word_of_the_command_nor_a_command_of_its_own', () => {
      expect(tokens('echo hi > out.txt')).toEqual([['echo', 'hi']])
      expect(tokens('echo hi >| out.txt; ls')).toEqual([['echo', 'hi'], ['ls']])
      expect(tokens('cmd <&3 && ls')).toEqual([['cmd'], ['ls']])
      expect(tokens('cmd >&- ; ls')).toEqual([['cmd'], ['ls']])
      expect(tokens('sort < in.txt > out.txt')).toEqual([['sort']])
      expect(tokens('cmd {fd}>out.txt')).toEqual([['cmd']])
    })

    it('a_heredoc_body_belongs_to_its_command_and_its_lines_are_not_commands', () => {
      const { segments, substitutes } = splitShellCommand(`cat > /tmp/t.mts <<'EOF'\nimport { x } from './y'\nconst a = $(ls) && rm -rf /\nEOF\nnpx tsx /tmp/t.mts 2>&1`)
      expect(segments.map((s) => s.tokens)).toEqual([['cat'], ['npx', 'tsx', '/tmp/t.mts']])
      expect(segments[0]!.writesFile).toBe(true)
      expect(segments[0]!.text).toBe(`cat > /tmp/t.mts <<'EOF'\nimport { x } from './y'\nconst a = $(ls) && rm -rf /\nEOF`)
      expect(substitutes).toBe(false)
    })

    it('heredoc_delimiters_may_be_quoted_or_dash_prefixed_and_a_here_string_is_not_a_heredoc', () => {
      expect(tokens(`cat <<-"END"\n\tbody; rm x\n\tEND\nls`)).toEqual([['cat'], ['ls']])
      expect(tokens(`cat <<< "a; b"\nls`)).toEqual([['cat'], ['ls']])
      // An unterminated body runs to the end; nothing after it is taken for a command.
      expect(tokens(`cat <<EOF\nrm x\n`)).toEqual([['cat']])
    })

    it('a_heredoc_feeds_the_command_that_opened_it_even_when_the_line_goes_on_and_bodies_follow_in_order', () => {
      expect(texts(`cat <<A | grep x\na1\nA\nls`)).toEqual(['cat <<A\na1\nA', 'grep x', 'ls'])
      expect(texts(`diff <<A <<B\na\nA\nb\nB\nls`)).toEqual(['diff <<A <<B\na\nA\nb\nB', 'ls'])
    })
  })

  describe('compound commands', () => {
    it('reserved_words_that_open_or_close_a_construct_are_not_commands', () => {
      expect(tokens('if [ -f x ]; then rm x; elif ! test -d y; then ls; else pwd; fi')).toEqual([
        ['[', '-f', 'x', ']'],
        ['rm', 'x'],
        ['test', '-d', 'y'],
        ['ls'],
        ['pwd'],
      ])
      expect(tokens('while read line; do echo $line; done < f')).toEqual([['read', 'line'], ['echo', '$line']])
      expect(tokens('until false; do sleep 1; done')).toEqual([['false'], ['sleep', '1']])
      expect(tokens('{ ls; rm x; }')).toEqual([['ls'], ['rm', 'x']])
      expect(tokens('time -p npm test')).toEqual([['npm', 'test']])
      expect(tokens('echo if')).toEqual([['echo', 'if']])
      expect(tokens('"if" x')).toEqual([['if', 'x']])
    })

    it('a_for_or_select_header_runs_nothing_and_its_body_runs_as_written', () => {
      expect(tokens('for f in a b; do rm $f; done')).toEqual([['rm', '$f']])
      expect(tokens('for f in $(ls); do echo $f; done')).toEqual([['echo', '$f']])
      expect(tokens('for ((i=0; i<3; i++)); do echo $i; done')).toEqual([['echo', '$i']])
      expect(tokens('select x in a b; do rm $x; done')).toEqual([['rm', '$x']])
    })

    it('case_patterns_are_not_commands_and_every_clause_body_is', () => {
      expect(tokens('case "$1" in a|b) rm x ;; (c) ls ;& *) pwd ;;& esac')).toEqual([['rm', 'x'], ['ls'], ['pwd']])
      expect(tokens('case $x in\n  start)\n    npm start\n    ;;\n  *)\n    echo no\n    ;;\nesac\nls')).toEqual([['npm', 'start'], ['echo', 'no'], ['ls']])
      expect(tokens('case a in a) case b in b) rm x;; esac;; esac; ls')).toEqual([['rm', 'x'], ['ls']])
    })

    it('subshells_and_groups_are_their_inner_commands', () => {
      expect(tokens('(cd src && npm test) && ls')).toEqual([['cd', 'src'], ['npm', 'test'], ['ls']])
      expect(tokens('(ls)')).toEqual([['ls']])
      expect(tokens('( (rm x) )')).toEqual([['rm', 'x']])
    })

    it('an_arithmetic_command_runs_nothing', () => {
      expect(tokens('(( i++ )); ls')).toEqual([['ls']])
      expect(tokens('(( x > 1 && y < 2 )) && rm x')).toEqual([['rm', 'x']])
    })

    it('a_conditional_expression_is_one_command_whatever_operators_it_holds', () => {
      expect(tokens('[[ $a < $b && ( -f x || -d y ) ]] && rm x')).toEqual([['[[', '$a', '<', '$b', '&&', '(', '-f', 'x', '||', '-d', 'y', ')', ']]'], ['rm', 'x']])
      expect(splitShellCommand('[[ $(ls) == x ]]').substitutes).toBe(true)
    })

    it('a_function_definition_runs_nothing_but_its_body_is_listed', () => {
      expect(tokens('clean() { rm -rf dist; }; clean')).toEqual([['rm', '-rf', 'dist'], ['clean']])
      expect(tokens('function clean { rm -rf dist; }')).toEqual([['rm', '-rf', 'dist']])
      expect(tokens('function clean() { rm -rf dist; }')).toEqual([['rm', '-rf', 'dist']])
      expect(tokens('build ()\n{\n  npm run build\n}')).toEqual([['npm', 'run', 'build']])
    })
  })

  describe('simple commands', () => {
    it('leading_assignments_are_not_the_command_and_an_assignment_alone_runs_nothing', () => {
      expect(tokens('CI=1 NODE_ENV=test npm test')).toEqual([['npm', 'test']])
      expect(tokens('X=1; Y+=2; arr[0]=3; ls')).toEqual([['ls']])
      expect(tokens('X="a b" rm x')).toEqual([['rm', 'x']])
      expect(splitShellCommand('X=$(ls)').substitutes).toBe(true)
      expect(tokens('echo a=b')).toEqual([['echo', 'a=b']])
      expect(tokens('=x')).toEqual([['=x']])
    })

    it('the_text_of_a_command_starts_at_its_first_word_reserved_words_left_out_assignments_kept', () => {
      expect(texts('if true; then CI=1 npm test; fi')).toEqual(['true', 'CI=1 npm test'])
      expect(texts('{ ls; }')).toEqual(['ls'])
    })
  })
})
