/** Caption window buttons drawn by the page on Windows and Linux. */
export const DESKTOP_WINDOW_STATE_CHANNEL = 'desktop-titlebar:window-state'
export const DESKTOP_WINDOW_CONTROL_CHANNEL = 'desktop-titlebar:window-control'

export const desktopWindowControlActions = ['minimize', 'toggle-maximize', 'close'] as const
export type DesktopWindowControlAction = (typeof desktopWindowControlActions)[number]

export interface DesktopWindowCaptionState {
  maximized: boolean
  fullScreen: boolean
}

const desktopWindowControlActionSet = new Set<string>(desktopWindowControlActions)

export function isDesktopWindowControlAction(value: unknown): value is DesktopWindowControlAction {
  return typeof value === 'string' && desktopWindowControlActionSet.has(value)
}

export function isDesktopWindowCaptionState(value: unknown): value is DesktopWindowCaptionState {
  if (typeof value !== 'object' || value === null) return false
  const state = value as Record<string, unknown>
  return typeof state.maximized === 'boolean' && typeof state.fullScreen === 'boolean'
}
