/**
 * Discover teasers above the catalog: what to recommend installing, how long
 * ago a plugin was added, and the saved AI picks.
 *
 * Kept free of the DOM so a root-level test can import it. The client
 * typecheck does not include that test, and the root typecheck has no DOM lib.
 */

const DAY_MS = 86_400_000

/**
 * The one category a discover card prints. Themes have their own tab, so a
 * theme id is not this label. No non-theme category means the card omits it.
 */
export function primaryCategoryId(plugin: { category: string | string[] }): string | null {
  const values = Array.isArray(plugin.category) ? plugin.category : [plugin.category]
  for (const value of values) {
    if (typeof value !== 'string' || value === '' || value === 'theme') continue
    return value
  }
  return null
}

/**
 * The unfiltered Discover home: empty query, every category, all time, and
 * the default download sort. Recommendations only belong on that view.
 */
export function discoverHomeView(view: {
  query: string
  category: string
  timeRange: string
  sortField: string
  sortDir: string
}): boolean {
  return view.query.trim() === ''
    && view.category === 'all'
    && view.timeRange === 'all'
    && view.sortField === 'downloads'
    && view.sortDir === 'desc'
}

/** The fields the recommend-install filter reads. Catalog entries satisfy this. */
export interface RecommendCandidate {
  url: string
  deprecated?: boolean
}

/**
 * Highest-download plugins the user has not installed, skipping anything the
 * recent strip is already showing. `ranked` is the catalog in display order;
 * this only filters and caps, so the download sort stays with the caller.
 */
export function recommendedToInstall<T extends RecommendCandidate>(
  ranked: readonly T[],
  options: {
    installed: (plugin: T) => boolean
    blocked: (plugin: T) => boolean
    excludeUrls: ReadonlySet<string>
    limit: number
  },
): T[] {
  const picked: T[] = []
  for (const plugin of ranked) {
    if (picked.length >= options.limit) break
    if (plugin.deprecated === true) continue
    if (options.excludeUrls.has(plugin.url)) continue
    if (options.blocked(plugin)) continue
    if (options.installed(plugin)) continue
    picked.push(plugin)
  }
  return picked
}

/**
 * "今天" / "昨天" / "N 天前" from a catalog `added` timestamp.
 * Unparseable, empty, or still in the future yields null — the tile omits the
 * label rather than showing a broken date. Days are elapsed 24-hour periods,
 * the same clock `withinDays` uses, so the label does not depend on timezone.
 */
export function addedAgoLabel(
  added: string | undefined,
  now: number,
  t: (key: string) => string,
): string | null {
  if (added === undefined || added === '') return null
  const time = Date.parse(added)
  if (Number.isNaN(time)) return null
  const age = now - time
  if (!Number.isFinite(age) || age < 0) return null
  const days = Math.floor(age / DAY_MS)
  if (days <= 0) return t('recentAddedToday')
  if (days === 1) return t('recentAddedYesterday')
  return t('recentAddedDays').replace('{0}', String(days))
}

export interface SavedAiPick {
  url: string
  why: string
}

export interface SavedAiRecommend {
  picks: SavedAiPick[]
  intro: string
}

function pickFrom(value: unknown): SavedAiPick | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const pick = value as { url?: unknown; why?: unknown }
  if (typeof pick.url !== 'string' || pick.url === '') return null
  return { url: pick.url, why: typeof pick.why === 'string' ? pick.why : '' }
}

/**
 * The on-device AI row. New writes are `{ picks, intro }`. Older builds stored
 * only `{ urls }`; those still open, and the tile falls back to the catalog
 * description because there is no `why`.
 */
export function parseSavedAiRecommend(raw: string | null): SavedAiRecommend | null {
  if (raw === null || raw === '') return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as { picks?: unknown; urls?: unknown; intro?: unknown }
  if (Array.isArray(record.picks)) {
    const picks: SavedAiPick[] = []
    for (const item of record.picks) {
      const pick = pickFrom(item)
      if (pick !== null) picks.push(pick)
    }
    return { picks, intro: typeof record.intro === 'string' ? record.intro : '' }
  }
  if (Array.isArray(record.urls)) {
    const picks: SavedAiPick[] = []
    for (const url of record.urls) {
      if (typeof url === 'string' && url !== '') picks.push({ url, why: '' })
    }
    return { picks, intro: '' }
  }
  return null
}
