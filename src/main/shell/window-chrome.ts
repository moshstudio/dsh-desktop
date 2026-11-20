import { usesDesktopCaption } from '../../shared/desktop-menu'

/** Native window chrome. macOS draws the traffic lights inside the sidebar row. */
export interface DesktopWindowChrome {
  titleBarStyle?: 'hiddenInset' | 'hidden'
  trafficLightPosition?: { x: number; y: number }
  vibrancy?: 'sidebar'
  visualEffectState?: 'active'
  backgroundColor?: string
  autoHideMenuBar?: boolean
}

/** Window background once the page reports its theme. The first frame uses a paper color. */
export function windowsChromeBackground(isDark: boolean): string {
  return isDark ? '#141416' : '#ffffff'
}

/**
 * macOS keeps the close buttons and the sidebar collapse control on one row.
 * Windows and Linux hide the native frame so the page caption (应用 / 编辑) is the menu
 * and the page draws minimize, maximize and close. A native overlay would stay above
 * every dialog. A normal title bar would stack Electron's File menu above that caption.
 */
export function desktopWindowChrome(platform: string, isDark = false): DesktopWindowChrome {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      backgroundColor: '#00000000'
    }
  }
  if (usesDesktopCaption(platform)) {
    return {
      titleBarStyle: 'hidden',
      autoHideMenuBar: true,
      backgroundColor: isDark ? '#141416' : '#f8f8f6'
    }
  }
  return {}
}
