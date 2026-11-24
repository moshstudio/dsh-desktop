/** One status label for an installed row. The detail bands explain it; the row does not repeat it. */

export type InstalledStatusKind =
  | 'check-failed'
  | 'broken'
  | 'incompatible'
  | 'failed'
  | 'restart'
  | 'disabled'
  | 'inert'
  | 'live'
  | 'library'
  | 'unknown'

export type InstalledFilter = 'all' | 'updates' | 'problems' | 'disabled'

const PROBLEMS = new Set<InstalledStatusKind>(['check-failed', 'broken', 'incompatible', 'failed'])

export function installedStatusKind(input: {
  disabled: boolean
  checkFailed: boolean
  library?: boolean
  activation?: string | null
}): InstalledStatusKind {
  if (input.library === true) return 'library'
  if (input.checkFailed) return 'check-failed'
  const state = input.activation
  if (state === 'broken' || state === 'incompatible' || state === 'failed') return state
  if (input.disabled || state === 'disabled') return 'disabled'
  if (state === 'restart') return 'restart'
  if (state === 'inert') return 'inert'
  if (state === 'live') return 'live'
  return 'unknown'
}

/** "Enabled" only when the plugin is actually running or waiting on a restart. */
export function showEnabledLabel(kind: InstalledStatusKind): boolean {
  return kind === 'live' || kind === 'restart'
}

/** Break a package name after `@`, `/`, and `-`, never in the middle of a segment. */
export function packageNameSegments(name: string): Array<{ text: string; breakAfter: boolean }> {
  return name.split(/([/@-])/).filter(part => part !== '').map(text => ({
    text,
    breakAfter: text === '/' || text === '@' || text === '-',
  }))
}

/**
 * Trailing tag on a row that has nothing else to say about updates.
 * A failed request is the header notice's job, so rows stay quiet.
 * Before the check is ready, "up to date" would be a guess.
 */
export function installedUpdateTag(input: {
  ready: boolean
  failed: ReadonlySet<string> | null
  name: string
}): 'check-failed' | 'up-to-date' | null {
  if (input.failed === null) return null
  if (input.failed.has(input.name)) return 'check-failed'
  if (!input.ready) return null
  return 'up-to-date'
}

export function isInstalledProblem(kind: InstalledStatusKind): boolean {
  return PROBLEMS.has(kind)
}

/** Lower sorts first: problems, then everything else. */
export function installedProblemRank(kind: InstalledStatusKind): number {
  return isInstalledProblem(kind) ? 0 : 1
}

export function matchesInstalledFilter(filter: InstalledFilter, input: {
  kind: InstalledStatusKind
  updatable: boolean
}): boolean {
  if (filter === 'all') return true
  if (filter === 'updates') return input.updatable
  if (filter === 'problems') return isInstalledProblem(input.kind)
  return input.kind === 'disabled'
}

export function installedListMessage(installedCount: number, visibleCount: number): 'installed-empty' | 'search-empty' | 'list' {
  if (installedCount === 0) return 'installed-empty'
  if (visibleCount === 0) return 'search-empty'
  return 'list'
}

/** Shared by the list and the group view. Empty query matches everything. */
export function installedQueryHits(query: string, fields: {
  name: string
  spec?: string
  note?: string
  description?: string
  owner?: string
}): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return [fields.name, fields.spec, fields.note, fields.description, fields.owner]
    .some(value => typeof value === 'string' && value.toLowerCase().includes(needle))
}
