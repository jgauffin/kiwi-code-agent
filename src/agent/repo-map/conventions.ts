import { byPath } from './map-files'

/**
 * Where things live, read off the tree and nothing else — no document, no
 * README, no intent file has a say here. Every convention carries the count it
 * rests on ("`Endpoint.cs` files live in `src/<Feature>/` — 14 of 15"), and a
 * pattern too thin or too contradicted is left out rather than hedged.
 */

export type Convention = {
  /** What the convention is about: a file name, a name suffix, an extension. */
  subject: string
  /** Where those files live, placeholders and all. */
  place: string
  /** Files that follow it, of the files the subject covers. */
  matches: number
  total: number
}

/** Fewer than this and it is a coincidence, not a convention. */
export const MIN_MATCHES = 3

/** Below this share of the subject's files it is contradicted, and left out entirely. */
export const MIN_RATIO = 0.8

/** A segment holds a literal only when this much of the family agrees on it. */
const SEGMENT_AGREEMENT = 0.6

/** The map states the strongest few; past that the list is noise, not shape. */
const MAX_CONVENTIONS = 12

const dirOf = (path: string): string[] => path.split('/').slice(0, -1)
const baseOf = (path: string): string => path.split('/').slice(-1)[0]!

/** `foo.test.ts` -> `.test.ts`, `UserController.cs` -> `Controller.cs`; undefined when the name has no prefix before it. */
export function suffixOf(base: string): string | undefined {
  const dotted = /^.+?(\.[^.]+\.[^.]+)$/.exec(base)
  if (dotted) return dotted[1]!
  const pascal = /^.+?([A-Z][A-Za-z0-9]*\.[^.]+)$/.exec(base)
  return pascal ? pascal[1]! : undefined
}

/** The conventions the tree supports, strongest first. `files` are workspace-relative paths. */
export function findConventions(files: string[]): Convention[] {
  const found = [...nameConventions(files), ...suffixConventions(files), ...extensionConventions(files)]
  const seen = new Set<string>()
  return found
    .filter((c) => c.matches >= MIN_MATCHES && c.matches / c.total >= MIN_RATIO)
    .sort((a, b) => b.matches - a.matches || byPath(a.subject, b.subject))
    .filter((c) => {
      const key = `${c.subject}|${c.place}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_CONVENTIONS)
}

export const renderConvention = (c: Convention): string => `- \`${c.subject}\` lives in \`${c.place}\` — ${c.matches} of ${c.total}`

/** Files sharing a name: `Endpoint.cs` in every feature folder. */
function nameConventions(files: string[]): Convention[] {
  return familyConventions(groupBy(files, (path) => baseOf(path)))
}

/** Files sharing a name ending: `*Controller.cs`, `*.test.ts`. */
function suffixConventions(files: string[]): Convention[] {
  const groups = groupBy(files, (path) => suffixOf(baseOf(path)))
  return familyConventions(groups).map((c) => ({ ...c, subject: `*${c.subject}` }))
}

/** A language's home: the top folder most of its files sit under. */
function extensionConventions(files: string[]): Convention[] {
  const conventions: Convention[] = []
  for (const [extension, family] of groupBy(files, (path) => /(\.[^./]+)$/.exec(path)?.[1])) {
    const tops = groupBy(family, (path) => (path.includes('/') ? path.split('/')[0]! : undefined))
    for (const [top, under] of tops) {
      conventions.push({ subject: `*${extension}`, place: `${top}/`, matches: under.length, total: family.length })
    }
  }
  return conventions
}

/** The place a family of files agrees on: literal where they agree, a placeholder where they do not. */
function familyConventions(groups: Map<string, string[]>): Convention[] {
  const conventions: Convention[] = []
  for (const [subject, family] of groups) {
    const place = commonPlace(family)
    if (place === undefined) continue
    conventions.push({ subject, place: `${place.join('/')}/`, matches: family.filter((p) => fits(p, place)).length, total: family.length })
  }
  return conventions
}

/**
 * The shape of the folders a family sits in: the depth most of them share, each
 * segment either the literal they agree on or a placeholder. All placeholders
 * says nothing about where anything lives, so it is no convention.
 */
function commonPlace(family: string[]): string[] | undefined {
  const depth = commonest(family.map((p) => dirOf(p).length))
  if (depth === undefined || depth === 0) return undefined
  const dirs = family.map(dirOf).filter((d) => d.length === depth)
  const place = Array.from({ length: depth }, (_, i) => {
    const values = dirs.map((d) => d[i]!)
    const literal = commonest(values)
    const agreed = literal !== undefined && values.filter((v) => v === literal).length / values.length >= SEGMENT_AGREEMENT
    return agreed ? literal : placeholder(values)
  })
  return place.some((segment) => !segment.startsWith('<')) ? place : undefined
}

/** A varying folder is named for what it holds: capitalised values read as features. */
function placeholder(values: string[]): string {
  const capitalised = values.filter((v) => /^[A-Z]/.test(v)).length
  return capitalised * 2 >= values.length ? '<Feature>' : '<name>'
}

const fits = (path: string, place: string[]): boolean => {
  const dir = dirOf(path)
  return dir.length === place.length && place.every((segment, i) => segment.startsWith('<') || segment === dir[i])
}

/** The value most of them have; ties go to the smaller value so the answer does not depend on order. */
function commonest<T extends string | number>(values: T[]): T | undefined {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best: T | undefined
  let bestCount = 0
  for (const [value, count] of [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

function groupBy(files: string[], key: (path: string) => string | undefined): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const path of [...files].sort(byPath)) {
    const group = key(path)
    if (group === undefined) continue
    groups.set(group, [...(groups.get(group) ?? []), path])
  }
  return new Map([...groups.entries()].sort((a, b) => byPath(a[0], b[0])))
}
