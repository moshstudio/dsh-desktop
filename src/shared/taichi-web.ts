/** Provider ids registered by `dsh-taichi-web`. */
export const TAICHI_SEARCH_PROVIDER_ID = 'taichi-search'
export const TAICHI_FETCH_PROVIDER_ID = 'taichi-fetch'

/** Cordis plugin package name mounted by the desktop product patch. */
export const TAICHI_WEB_PLUGIN_NAME = 'dsh-taichi-web'

/** Lives next to the profile `cordis.patch.yml`. Never stores tokens. */
export const TAICHI_WEB_DEFAULTS_FILE = 'taichi-web-defaults.json'

/** Per-capability ownership of the profile web provider selection. */
export type TaichiWebCapabilityMark = 'unset' | 'desktop' | 'user'

export interface TaichiWebDefaultsMark {
  search: TaichiWebCapabilityMark
  fetch: TaichiWebCapabilityMark
}
