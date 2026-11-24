/**
 * Timing budgets, storage keys, page sizes and sort/time option lists used across the Market section.
 */

import type { SortDir, SortField, TimeRange } from './market-data.ts'

/** After this long without a structured phase, the install line adds a note that waiting is normal (#1011). */
export const SLOW_INSTALL_SECONDS = 90
/** How long the page keeps asking for a market DSH unloaded, and how long one ask may take (#1151). */
export const RECONNECT_BUDGET_MS = 90_000
export const RECONNECT_REQUEST_MS = 4000
export const UPDATE_CHECK_REQUEST_MS = 30_000
export const IGNORED_UPDATES_SESSION_KEY = 'taichi-dshm-updates-ignored'

/** Discover grid page-size choices — the catalog grows daily, so cap each page. */
export const PAGE_SIZES = [24, 48, 96]
export const DEFAULT_PAGE_SIZE = 24
export const WEBDAV_STORAGE_KEY = 'taichi-dshm-webdav'

/** Same cap as `MAX_NOTE` in hot.ts; the server trims anything longer. */
export const NOTE_MAX = 200

/** Sort field choices in the filter panel. */
export const SORT_FIELD_OPTIONS: ReadonlyArray<{ key: SortField; label: string }> = [
  { key: 'downloads', label: 'sortDownloads' },
  { key: 'stars', label: 'sortStars' },
  { key: 'added', label: 'sortAdded' },
]

/** Sort direction choices in the filter panel (labels depend on the field). */
export const SORT_DIR_OPTIONS: ReadonlyArray<SortDir> = ['desc', 'asc']

/** Published-within choices in the filter panel. */
export const TIME_OPTIONS: ReadonlyArray<{ key: TimeRange; label: string }> = [
  { key: 'all', label: 'timeAll' },
  { key: 'day', label: 'timeDay' },
  { key: 'week', label: 'timeWeek' },
  { key: 'month', label: 'timeMonth' },
  { key: 'quarter', label: 'timeQuarter' },
  { key: 'year', label: 'timeYear' },
]

/**
 * Discover "推荐与上新" display preferences.
 *
 * One entry covers recommended installs, recently added, and AI picks. It
 * only appears on the unfiltered home view. A missing store means collapsed
 * and still offered — older per-strip keys are not read, so a previous
 * "expanded" choice cannot put the teasers back in front of the catalog.
 */
export const HIGHLIGHTS_OPEN_KEY = 'taichi-dshm-highlights-open'
export const HIGHLIGHTS_HIDDEN_KEY = 'taichi-dshm-highlights-hidden'
/** Cap for the Discover teaser. Extra tiles live in a quiet horizontal
 * scroll so the block stays one row tall. */
export const RECENT_STRIP_LIMIT = 8

/** "不再提示" on the settings-page sidebar tip. A missing store means show it. */
export const SIDEBAR_TIP_KEY = 'taichi-dshm-sidebar-tip-dismissed'
