/**
 * Host color scheme, published from the Cordis `theme` service.
 *
 * Alias tokens follow the palette on their own. A few surfaces (the canvas
 * card, shader wallpapers) still need to know which palette is active because
 * the layer tokens collapse to one color in each theme. They read this store
 * instead of `body[data-ds-dark-theme]` or a measured background.
 *
 * The default is light so a shell without the theme service keeps the light
 * canvas contract. `src/client/index.ts` publishes the real scheme.
 */

import { useEffect, useState } from 'react'

export type HostColorScheme = 'light' | 'dark'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Host theme palette changed. Declared here so this plugin does not import the theme package. */
    'theme/change'(snapshot: { active: { colorScheme: HostColorScheme } }): void
  }
}

type SchemeListener = (scheme: HostColorScheme) => void

let scheme: HostColorScheme = 'light'
const listeners = new Set<SchemeListener>()

export function getHostScheme(): HostColorScheme {
  return scheme
}

export function publishHostScheme(next: HostColorScheme): void {
  if (next !== 'light' && next !== 'dark') return
  if (next === scheme) return
  scheme = next
  for (const listener of listeners) listener(next)
}

export function subscribeHostScheme(listener: SchemeListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useHostScheme(): HostColorScheme {
  const [value, setValue] = useState(getHostScheme)
  useEffect(() => subscribeHostScheme(setValue), [])
  return value
}

/** Minimal shape of the host theme service. The theme package is not imported. */
export interface HostThemeService {
  getTheme(): { active: { colorScheme: HostColorScheme } }
}

export function readHostScheme(theme: HostThemeService | undefined): HostColorScheme {
  const colorScheme = theme?.getTheme().active.colorScheme
  return colorScheme === 'dark' ? 'dark' : 'light'
}
