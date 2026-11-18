import { isSplashPageUrl } from './splash-page'
import { isWebImportPageUrl } from './web-import-offer'
import { SCHEME } from './window/ipc'

/** Local recovery page. Same document `startup-recovery.ts` loads in the main window. */
const RECOVERY_PAGE = '/plugin-recovery.html'

export interface TitlebarDocuments {
  splashPage: string
  importPage: string
}

/**
 * Documents whose preload syncs the native caption.
 * The application page, the whale splash, the web-import page, and plugin
 * recovery all use the desktop window preload. Usage and top-up do not.
 */
export function isDesktopTitlebarDocument(url: string, pages: TitlebarDocuments, allowBlank = false): boolean {
  if (allowBlank && url === 'about:blank') return true
  if (isAppDocument(url)) return true
  if (isSplashPageUrl(url, pages.splashPage)) return true
  if (isWebImportPageUrl(url, pages.importPage)) return true
  return isPluginRecoveryDocument(url)
}

function isAppDocument(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === `${SCHEME}:`
      && parsed.hostname === 'app'
      && parsed.port === ''
      && parsed.username === ''
      && parsed.password === ''
  } catch {
    return false
  }
}

function isPluginRecoveryDocument(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'dsh-desktop:'
      && parsed.hostname === 'desktop'
      && parsed.pathname === RECOVERY_PAGE
      && parsed.port === ''
      && parsed.username === ''
      && parsed.password === ''
  } catch {
    return false
  }
}
