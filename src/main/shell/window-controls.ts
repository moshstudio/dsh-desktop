import {
  type DesktopWindowCaptionState,
  type DesktopWindowControlAction
} from '../../shared/desktop-window-controls'

/** The slice of BrowserWindow the caption buttons are allowed to call. */
export interface DesktopWindowControlTarget {
  minimize(): void
  isMaximized(): boolean
  maximize(): void
  unmaximize(): void
  close(): void
  isFullScreen(): boolean
  setFullScreen(flag: boolean): void
}

export function readDesktopWindowCaptionState(
  target: Pick<DesktopWindowControlTarget, 'isMaximized' | 'isFullScreen'>
): DesktopWindowCaptionState {
  return { maximized: target.isMaximized(), fullScreen: target.isFullScreen() }
}

/**
 * Minimize, toggle the restored frame, or close. close() keeps the window's
 * existing hide-to-tray path; it does not destroy the window.
 */
export function applyDesktopWindowControl(
  target: DesktopWindowControlTarget,
  action: DesktopWindowControlAction
): DesktopWindowCaptionState {
  if (action === 'close') {
    const state = readDesktopWindowCaptionState(target)
    target.close()
    return state
  }
  if (action === 'minimize') target.minimize()
  else if (target.isFullScreen()) {
    // Menu and F11 enter fullscreen without going through this button.
    // Leaving that state is a fullscreen exit, not an unmaximize.
    target.setFullScreen(false)
    return { maximized: target.isMaximized(), fullScreen: false }
  } else if (target.isMaximized()) target.unmaximize()
  else target.maximize()
  return readDesktopWindowCaptionState(target)
}
