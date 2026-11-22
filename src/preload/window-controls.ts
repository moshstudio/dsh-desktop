import { desktopLocale } from '../shared/desktop-locale'
import { updateText } from '../shared/desktop-update-messages'
import { WINDOWS_TITLEBAR_HEIGHT } from '../shared/desktop-menu'
import {
  DESKTOP_WINDOW_CONTROL_CHANNEL,
  DESKTOP_WINDOW_STATE_CHANNEL,
  isDesktopWindowCaptionState,
  type DesktopWindowCaptionState,
  type DesktopWindowControlAction
} from '../shared/desktop-window-controls'

const HOST_ATTRIBUTE = 'data-dsh-window-controls'

/** Caption IPC stays inside the preload. The page never receives a generic invoke. */
export interface CaptionIpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void
}

interface WindowControlsOptions {
  document: Document
  ipcRenderer: CaptionIpc
}

const captionDoubleClicks = new WeakMap<Document, (event: Event) => void>()
const CAPTION_CONTROL = 'button, a, input, select, textarea, label, summary, [role="button"], [role="tab"], [role="menuitem"], [role="dialog"], [role="alertdialog"], dialog, [contenteditable="true"], [data-dsh-windows-menu], [data-dsh-window-controls], [data-dsh-no-drag]'

/** 1px caption glyphs on a 12px grid, the same geometry as the Windows title buttons. */
const svg = (body: string, linecap: 'butt' | 'square' = 'butt'): string =>
  `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="${linecap}" stroke-linejoin="miter">${body}</svg>`

const ICONS = {
  minimize: svg('<path d="M1.5 6h9"/>'),
  maximize: svg('<path d="M1.5 1.5h9v9h-9z"/>'),
  // Front square, plus only the part of the rear square that stays visible.
  restore: svg('<path d="M3.5 3.5V1.5H11.5V9.5H9.5M1.5 3.5h8v8h-8z"/>'),
  close: svg('<path d="M1.5 1.5L10.5 10.5M10.5 1.5L1.5 10.5"/>', 'square')
} as const

/**
 * Page-drawn minimize, maximize and close. z-index 40 sits above the caption
 * drag strip and the sidebar toggle. Dialog layers that cover this band are
 * opened by the caption passthrough, so the buttons stay clickable. Native
 * overlay buttons cannot.
 */
export function mountWindowControls(options: WindowControlsOptions): { dispose(): void } {
  const { document, ipcRenderer } = options
  const existing = document.querySelector(`[${HOST_ATTRIBUTE}]`)
  if (existing) return { dispose: () => existing.remove() }

  const host = document.createElement('div')
  host.setAttribute(HOST_ATTRIBUTE, '')
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `
    :host { position: fixed; top: 0; right: 0; z-index: 40; display: flex;
      height: var(--dsh-windows-titlebar-height, 40px); -webkit-app-region: no-drag; }
    button { width: 46px; height: 100%; margin: 0; padding: 0; border: 0; display: grid;
      place-items: center; background: transparent; color: var(--dsw-alias-label-secondary, #5f6368);
      cursor: default; }
    button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(32, 33, 36, .08));
      color: var(--dsw-alias-label-primary, #202124); }
    button[data-control="close"]:hover { background: #c42b1c; color: #fff; }
    button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4d6bfe); outline-offset: -2px; }
    svg { display: block; }
  `
  const buttons = new Map<DesktopWindowControlAction, HTMLButtonElement>()
  const createButton = (action: DesktopWindowControlAction): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.control = action
    // A second click in a double-click would undo minimize or maximize.
    button.addEventListener('click', event => {
      if (event.detail > 1) return
      void ipcRenderer.invoke(DESKTOP_WINDOW_CONTROL_CHANNEL, action)
        .then(applyIncoming)
        .catch((error: unknown) => {
          console.error('[desktop-titlebar] window control failed', error)
        })
    })
    return button
  }
  const minimize = createButton('minimize')
  minimize.innerHTML = ICONS.minimize
  const toggle = createButton('toggle-maximize')
  const maximizeIcon = document.createElement('span')
  maximizeIcon.dataset.icon = 'maximize'
  maximizeIcon.innerHTML = ICONS.maximize
  const restoreIcon = document.createElement('span')
  restoreIcon.dataset.icon = 'restore'
  restoreIcon.hidden = true
  restoreIcon.innerHTML = ICONS.restore
  toggle.append(maximizeIcon, restoreIcon)
  const close = createButton('close')
  close.innerHTML = ICONS.close
  buttons.set('minimize', minimize)
  buttons.set('toggle-maximize', toggle)
  buttons.set('close', close)
  shadow.append(style, minimize, toggle, close)

  const relabel = (maximized: boolean): void => {
    const locale = desktopLocale(document.documentElement.lang || navigator.language) ?? 'en'
    const minimizeButton = buttons.get('minimize')
    const toggleButton = buttons.get('toggle-maximize')
    const closeButton = buttons.get('close')
    if (minimizeButton) minimizeButton.setAttribute('aria-label', updateText(locale, 'minimize'))
    if (toggleButton) {
      toggleButton.setAttribute('aria-label', updateText(locale, maximized ? 'restore' : 'maximize'))
      const maximizeMark = toggleButton.querySelector<HTMLElement>('[data-icon="maximize"]')
      const restoreMark = toggleButton.querySelector<HTMLElement>('[data-icon="restore"]')
      if (maximizeMark) maximizeMark.hidden = maximized
      if (restoreMark) restoreMark.hidden = !maximized
    }
    if (closeButton) closeButton.setAttribute('aria-label', updateText(locale, 'close'))
  }
  let expanded = false
  const applyIncoming = (value: unknown): void => {
    if (!host.isConnected || !isDesktopWindowCaptionState(value)) return
    applyState(value)
  }
  const applyState = (state: DesktopWindowCaptionState): void => {
    // Fullscreen is entered from the view menu and F11, not from this button.
    expanded = state.maximized || state.fullScreen
    relabel(expanded)
  }
  relabel(false)
  const languageObserver = new MutationObserver(() => relabel(expanded))
  languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  const onState = (_event: unknown, value: unknown): void => applyIncoming(value)
  ipcRenderer.on(DESKTOP_WINDOW_STATE_CHANNEL, onState)
  void ipcRenderer.invoke(DESKTOP_WINDOW_STATE_CHANNEL).then(applyIncoming).catch((error: unknown) => {
    console.warn('[desktop-titlebar] unable to read window state', error)
  })
  bindCaptionDoubleClick(document, ipcRenderer)
  document.body.append(host)

  return {
    dispose: () => {
      languageObserver.disconnect()
      host.remove()
    }
  }
}

function bindCaptionDoubleClick(document: Document, ipcRenderer: CaptionIpc): void {
  const previous = captionDoubleClicks.get(document)
  if (previous) document.removeEventListener('dblclick', previous)
  const listener = (event: Event): void => { handleCaptionDoubleClick(document, ipcRenderer, event) }
  captionDoubleClicks.set(document, listener)
  document.addEventListener('dblclick', listener)
}

/** Double-click on the empty caption toggles maximize. Dialogs and controls do not. */
function handleCaptionDoubleClick(document: Document, ipcRenderer: CaptionIpc, event: Event): void {
  if (!(event instanceof MouseEvent) || event.defaultPrevented || event.button !== 0) return
  if (event.clientY < 0 || event.clientY >= WINDOWS_TITLEBAR_HEIGHT) return
  const controls = document.querySelector(`[${HOST_ATTRIBUTE}]`)
  if (!controls) return
  const target = event.target
  if (!(target instanceof Element)) return
  if (target.closest(CAPTION_CONTROL)) return
  // A drag-region double-click also maximizes the window. preventDefault keeps
  // that native toggle from running in addition to the control below.
  event.preventDefault()
  void ipcRenderer.invoke(DESKTOP_WINDOW_CONTROL_CHANNEL, 'toggle-maximize').catch((error: unknown) => {
    console.error('[desktop-titlebar] window control failed', error)
  })
}
