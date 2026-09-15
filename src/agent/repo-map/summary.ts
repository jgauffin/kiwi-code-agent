import { renderConvention, type Convention } from './conventions'
import { byPath, mapPath } from './map-files'

/**
 * The small part of the map, the part a session is given at its start: what the
 * projects are, where the tree puts things, and for each project the path of
 * its type index and how many public types are in it. The index itself stays on
 * disk, uncapped, and is opened by that path when a signature is actually
 * needed.
 *
 * This part is injected, so it is bounded: when the bound cuts the project list
 * the summary says how many it left out rather than quietly showing a part.
 */

export type ProjectKind = 'solution' | 'dotnet' | 'npm'

export type MappedProject = {
  /** How the project is known: the solution or project file's name. */
  name: string
  /** Workspace-relative path of the project or solution file. */
  path: string
  kind: ProjectKind
  /** Workspace-relative path of this project's type index inside the map. */
  index: string
  publicTypes: number
}

export type MapSummary = { projects: MappedProject[]; conventions: Convention[] }

/** Characters the injected summary may take; the rest of the map is read from disk. */
export const SUMMARY_BUDGET = 4000

/** The index file of a project, by the name the build gives it. */
export const indexPathFor = (name: string): string => mapPath(`types/${name}.md`)

const projectLine = (p: MappedProject): string =>
  `- ${p.name} (${p.kind}) \`${p.path}\` — ${p.publicTypes} public types, index \`${p.index}\``

/** Renders the summary as the session receives it, cut to the budget from the smallest project up. */
export function renderSummary(map: MapSummary, budget = SUMMARY_BUDGET): string {
  const head = ['# Repo map', '', 'Generated from the workspace tree; no document was consulted. It is rebuilt wholesale, so editing it changes nothing.', '']
  const tail = [
    '',
    '## Folder conventions',
    ...(map.conventions.length > 0 ? map.conventions.map(renderConvention) : ['None the tree supports firmly enough to state.']),
    '',
    'Open a project\'s index by its path above when you need a signature; it is a file on disk, not part of this summary.',
  ]
  const fixed = [...head, ...tail].join('\n').length
  if (map.projects.length === 0) {
    return [...head, 'No projects were recognised in this workspace: no solution, project file or package manifest was found.', ...tail].join('\n')
  }
  // The largest projects say the most about the workspace, so they are the ones kept when the bound bites.
  const ranked = [...map.projects].sort((a, b) => b.publicTypes - a.publicTypes || byPath(a.path, b.path))
  const kept: MappedProject[] = []
  let used = fixed + LEFT_OUT_ALLOWANCE
  for (const project of ranked) {
    const line = projectLine(project)
    if (kept.length > 0 && used + line.length + 1 > budget) break
    kept.push(project)
    used += line.length + 1
  }
  const leftOut = map.projects.length - kept.length
  return [
    ...head,
    `${map.projects.length} project${map.projects.length === 1 ? '' : 's'}:`,
    ...kept.sort((a, b) => byPath(a.path, b.path)).map(projectLine),
    ...(leftOut > 0 ? [`${leftOut} more project${leftOut === 1 ? '' : 's'} left out to keep this summary short.`] : []),
    ...tail,
  ].join('\n')
}

/** Room the "left out" line needs, counted before anything is kept so the bound holds either way. */
const LEFT_OUT_ALLOWANCE = 80
