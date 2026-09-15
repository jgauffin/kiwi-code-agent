import { describe, expect, it } from 'vitest'
import { indexPathFor, renderSummary, SUMMARY_BUDGET, type MappedProject } from '../src/agent/repo-map/summary'
import { buildTypeIndex, renderTypeIndex } from '../src/agent/repo-map/type-index'
import type { Convention } from '../src/agent/repo-map/conventions'

const project = (name: string, publicTypes: number): MappedProject => ({
  name,
  path: `src/${name}/${name}.csproj`,
  kind: 'dotnet',
  index: indexPathFor(name),
  publicTypes,
})

const conventions: Convention[] = [{ subject: 'Endpoint.cs', place: 'src/<Feature>/', matches: 14, total: 15 }]

describe('repo map summary', () => {
  it('the_summary_names_each_project_its_kind_its_index_path_and_its_public_type_count', () => {
    const text = renderSummary({ projects: [project('Api', 42), project('Core', 7)], conventions })
    expect(text).toContain('2 projects:')
    expect(text).toContain('- Api (dotnet) `src/Api/Api.csproj` — 42 public types, index `.agent/repo-map/types/Api.md`')
    expect(text).toContain('- Core (dotnet) `src/Core/Core.csproj` — 7 public types, index `.agent/repo-map/types/Core.md`')
    expect(text).toContain('- `Endpoint.cs` lives in `src/<Feature>/` — 14 of 15')
    expect(text).not.toContain('left out')
  })

  it('where_the_bound_trimmed_the_project_list_the_summary_states_how_many_were_left_out', () => {
    const many = Array.from({ length: 200 }, (_, i) => project(`Project${String(i).padStart(3, '0')}`, 200 - i))
    const text = renderSummary({ projects: many, conventions })
    expect(text.length).toBeLessThanOrEqual(SUMMARY_BUDGET)
    const listed = text.split('\n').filter((l) => l.startsWith('- Project')).length
    expect(listed).toBeGreaterThan(0)
    expect(listed).toBeLessThan(200)
    expect(text).toContain(`${200 - listed} more projects left out to keep this summary short.`)
    // The biggest projects are the ones kept.
    expect(text).toContain('- Project000 (dotnet)')
  })

  it('the_summary_stays_bounded_while_the_type_index_it_points_at_is_not_capped', () => {
    const files = Array.from({ length: 400 }, (_, i) => ({
      path: `src/Api/Type${String(i).padStart(3, '0')}.cs`,
      text: `public class Type${i}\n{\n    public int Value { get; set; }\n}\n`,
    }))
    const index = buildTypeIndex(files)
    const indexText = renderTypeIndex('Api', index)
    const summary = renderSummary({ projects: [project('Api', index.types.length)], conventions })
    expect(index.types).toHaveLength(400)
    expect(indexText).toContain('public class Type399')
    expect(indexText.length).toBeGreaterThan(SUMMARY_BUDGET)
    expect(summary.length).toBeLessThanOrEqual(SUMMARY_BUDGET)
    expect(summary).toContain('index `.agent/repo-map/types/Api.md`')
  })
})
