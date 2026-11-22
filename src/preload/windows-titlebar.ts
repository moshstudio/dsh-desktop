import type { IpcRenderer } from 'electron'
import { WINDOWS_TITLEBAR_HEIGHT } from '../shared/desktop-menu'
import { mountWindowsMenuBar } from './windows-menu-bar'
import { mountWindowControls, type CaptionIpc } from './window-controls'

/** Pages that may paint the native caption. Embedded account pages must not. */
export function isDesktopCaptionDocument(location: Pick<Location, 'protocol' | 'href'>): boolean {
  return location.protocol === 'dsh-app:'
    || location.protocol === 'file:'
    || location.protocol === 'dsh-desktop:'
    || location.href === 'about:blank'
}

const LAYOUT_STYLE_ID = 'dsh-desktop-windows-titlebar-layout-style'
const DRAG_REGION_ID = 'dsh-desktop-windows-drag-region'
const CAPTION_PASS_ATTRIBUTE = 'data-dsh-caption-passthrough'
const themeObservers = new WeakMap<Document, MutationObserver>()
const modalObservers = new WeakMap<Document, { observer: MutationObserver, generation: number }>()

/** Drop caption observers so a later document reuse does not keep rewriting dialog layers. */
export function releaseWindowsTitlebarLayout(document: Document): void {
  themeObservers.get(document)?.disconnect()
  themeObservers.delete(document)
  const modal = modalObservers.get(document)
  if (!modal) return
  modal.observer.disconnect()
  modal.generation += 1
  modalObservers.delete(document)
}

interface TitlebarLayoutMountOptions {
  document: Document
  ipcRenderer: CaptionIpc
}

/** Harness reads this marker while creating its first layout frame.
 * Its Windows-named seam is also used for the Linux caption; data-platform stays Linux.
 */
export function markWindowsTitlebar(document: Document): void {
  const apply = (root: HTMLElement): void => {
    root.dataset.windowsTitlebar = ''
    root.style.setProperty('--dsh-windows-titlebar-height', `${WINDOWS_TITLEBAR_HEIGHT}px`)
  }
  const root = document.documentElement as HTMLElement | null
  if (root) {
    apply(root)
    return
  }
  // Preload can run before the parser creates <html>. Mark it the moment it
  // exists so every Harness script, including its first layout, sees it.
  const observer = new MutationObserver(() => {
    const created = document.documentElement as HTMLElement | null
    if (!created) return
    observer.disconnect()
    apply(created)
  })
  observer.observe(document, { childList: true })
}

/**
 * Windows/Linux caption layout. Harness 0.1.7 owns the caption row on its pages
 * (AppFrame reserves it, paints it and makes it draggable) once the marker is
 * set; Desktop adds the caption menubar in the upstream seat, the window
 * buttons, and a drag strip for its own local pages. Dialog masks already
 * start below the caption, so the row stays visible; layers that still cover
 * it are opened up so the row stays clickable too.
 */
export function mountWindowsTitlebarLayout(options: TitlebarLayoutMountOptions): void {
  const { document, ipcRenderer } = options
  markWindowsTitlebar(document)
  if (!document.body) return

  const standalone = document.location.protocol === 'file:'
  document.body.toggleAttribute('data-dsh-standalone-titlebar', standalone)
  installLayout(document)
  if (document.location.protocol === 'file:') installDragRegion(document)
  trackModals(document)
  mountWindowsMenuBar({ document, ipcRenderer })
  mountWindowControls({ document, ipcRenderer })

  syncTheme(document, ipcRenderer)
  themeObservers.get(document)?.disconnect()
  const themeObserver = new MutationObserver(() => syncTheme(document, ipcRenderer))
  themeObservers.set(document, themeObserver)
  themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['data-ds-dark-theme', 'class', 'style']
  })
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    syncTheme(document, ipcRenderer)
  })
}

function installLayout(document: Document): void {
  document.body.classList.add('dsh-desktop-windows-titlebar-layout')
  if (document.getElementById(LAYOUT_STYLE_ID)) return

  const style = document.createElement('style')
  style.id = LAYOUT_STYLE_ID
  style.textContent = `
    html, body { height: 100% !important; }
    body.dsh-desktop-windows-titlebar-layout {
      box-sizing: border-box !important;
      height: 100% !important;
      padding-top: 0 !important;
    }
    /* Local recovery pages do not have Harness AppFrame to reserve a caption
       row. Keep their logo/actions below both the menu and window controls. */
    body.dsh-desktop-windows-titlebar-layout[data-dsh-standalone-titlebar] {
      padding-top: ${WINDOWS_TITLEBAR_HEIGHT}px !important;
    }
    body.dsh-desktop-windows-titlebar-layout[data-dsh-standalone-titlebar] > .shell {
      height: 100% !important;
      min-height: 0 !important;
    }
    body.dsh-desktop-windows-titlebar-layout > #root {
      height: 100% !important;
      min-height: 0 !important;
    }
    /* Account and settings paint their mask below the caption, but the
       full-viewport layer still owns the band. pointer-events inherits, so
       clearing the layer alone also clears the mask and the dialog. The layer
       opts out and its children opt back in: the empty caption band falls
       through, while the mask and dialog keep clicks and hover. A layer that
       is its own mask is clipped instead, so the band is neither dimmed nor
       a hit target. */
    html[data-windows-titlebar]:not([data-fullscreen]) [${CAPTION_PASS_ATTRIBUTE}="hit"] {
      pointer-events: none !important;
    }
    html[data-windows-titlebar]:not([data-fullscreen]) [${CAPTION_PASS_ATTRIBUTE}="hit"] > * {
      pointer-events: auto;
    }
    html[data-windows-titlebar]:not([data-fullscreen]) [${CAPTION_PASS_ATTRIBUTE}="clip"] {
      clip-path: inset(var(--dsh-windows-titlebar-height, ${WINDOWS_TITLEBAR_HEIGHT}px) 0 0 0);
    }
    body.dsh-desktop-windows-titlebar-layout button,
    body.dsh-desktop-windows-titlebar-layout a,
    body.dsh-desktop-windows-titlebar-layout input,
    body.dsh-desktop-windows-titlebar-layout select,
    body.dsh-desktop-windows-titlebar-layout textarea,
    body.dsh-desktop-windows-titlebar-layout [role="button"],
    body.dsh-desktop-windows-titlebar-layout [role="tab"],
    body.dsh-desktop-windows-titlebar-layout [role="menuitem"],
    body.dsh-desktop-windows-titlebar-layout [data-dsh-no-drag] {
      -webkit-app-region: no-drag !important;
    }
    #${DRAG_REGION_ID} {
      position: fixed;
      z-index: 10;
      top: 0;
      left: 0;
      right: 0;
      height: ${WINDOWS_TITLEBAR_HEIGHT}px;
      background: transparent;
      pointer-events: none;
      user-select: none;
      -webkit-app-region: drag;
    }
  `
  document.head.appendChild(style)
}

/** Desktop's local pages have no Harness caption strip, so they get their own. */
function installDragRegion(document: Document): void {
  if (document.getElementById(DRAG_REGION_ID)) return
  const dragRegion = document.createElement('div')
  dragRegion.id = DRAG_REGION_ID
  dragRegion.setAttribute('aria-hidden', 'true')
  document.body.appendChild(dragRegion)
}

function isAppFrame(element: HTMLElement): boolean {
  if (element.id === 'root' || element.hasAttribute('data-shell-overlay')) return true
  for (const child of element.children) {
    if (child instanceof HTMLElement && child.hasAttribute('data-shell-overlay')) return true
  }
  return false
}

function coversCaption(element: HTMLElement, caption: number, viewportWidth: number): boolean {
  const view = element.ownerDocument.defaultView
  if (!view) return false
  const style = view.getComputedStyle(element)
  if (style.position !== 'fixed' && style.position !== 'absolute') return false
  if (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.opacity) === 0) return false
  const rect = element.getBoundingClientRect()
  if (rect.left > 1 || rect.width < viewportWidth - 20) return false
  return rect.top < caption - 1 && rect.bottom > caption
}

// Account and settings keep a full-size mask under the caption. That child
// still takes clicks. A layer that paints its own mask has to be clipped.
function maskReleasesCaption(element: HTMLElement, caption: number, viewportWidth: number): boolean {
  const view = element.ownerDocument.defaultView
  if (!view) return false
  for (const child of element.children) {
    if (!(child instanceof HTMLElement)) continue
    const role = child.getAttribute('role')
    if (role === 'dialog' || role === 'alertdialog') continue
    const style = view.getComputedStyle(child)
    if (style.position !== 'absolute' && style.position !== 'fixed') continue
    if (childDeclinesHits(child, style)) continue
    const rect = child.getBoundingClientRect()
    if (rect.top >= caption - 1 && rect.left <= 1 && rect.width >= viewportWidth - 20 && rect.height > caption) return true
  }
  return false
}

// The hit rule sets pointer-events:none on the layer, and the property
// inherits. A mask that only inherits that value still takes clicks once its
// own rule restores auto; treating the inherited none as an opt-out flips the
// layer to clip on the next mutation and back on the one after.
function childDeclinesHits(element: HTMLElement, style: CSSStyleDeclaration): boolean {
  if (style.display === 'none' || style.visibility === 'hidden') return true
  if (style.pointerEvents !== 'none') return false
  const inheritedFromHit = element.parentElement?.getAttribute(CAPTION_PASS_ATTRIBUTE) === 'hit'
    && element.style.pointerEvents !== 'none'
  return !inheritedFromHit
}

type CaptionPass = 'hit' | 'clip'

function syncCaptionPassthrough(document: Document): void {
  const root = document.documentElement
  const keep = new Map<HTMLElement, CaptionPass>()
  const view = document.defaultView
  if (view && root.hasAttribute('data-windows-titlebar') && !root.hasAttribute('data-fullscreen')) {
    const caption = WINDOWS_TITLEBAR_HEIGHT
    const viewportWidth = view.innerWidth
    if (viewportWidth > 0) {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], dialog[open]')
      for (const dialog of dialogs) {
        const style = view.getComputedStyle(dialog)
        if (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.opacity) === 0) continue
        let node: HTMLElement | null = dialog
        while (node && node !== document.body && node !== root) {
          if (isAppFrame(node)) break
          if (coversCaption(node, caption, viewportWidth)) {
            keep.set(node, maskReleasesCaption(node, caption, viewportWidth) ? 'hit' : 'clip')
            break
          }
          node = node.parentElement
        }
      }
    }
  }
  for (const element of document.querySelectorAll<HTMLElement>(`[${CAPTION_PASS_ATTRIBUTE}]`)) {
    if (!keep.has(element)) element.removeAttribute(CAPTION_PASS_ATTRIBUTE)
  }
  for (const [element, kind] of keep) {
    if (element.getAttribute(CAPTION_PASS_ATTRIBUTE) !== kind) element.setAttribute(CAPTION_PASS_ATTRIBUTE, kind)
  }
}

function trackModals(document: Document): void {
  // Only semantic dialogs count. Class-name guesses match permanent elements
  // and would open the caption for good.
  const previous = modalObservers.get(document)
  previous?.observer.disconnect()
  const generation = (previous?.generation ?? 0) + 1
  const update = (): void => {
    if (modalObservers.get(document)?.generation !== generation) return
    syncCaptionPassthrough(document)
  }

  // Streaming output mutates the DOM continuously; check at most once a frame.
  let scheduled = false
  const scheduleUpdate = (): void => {
    if (scheduled || modalObservers.get(document)?.generation !== generation) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      update()
    })
  }
  const observer = new MutationObserver(scheduleUpdate)
  modalObservers.set(document, { observer, generation })
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open', 'style', 'class', 'hidden', 'aria-hidden', 'aria-modal', 'role']
  })
  update()
}

function syncTheme(document: Document, ipcRenderer: Pick<IpcRenderer, 'invoke'>): void {
  const isDark = documentIsDark(document)
  void ipcRenderer.invoke('desktop-titlebar:set-theme', isDark).catch((error: unknown) => {
    console.warn('[desktop-titlebar] unable to synchronize native theme', error)
  })
}

export function documentIsDark(document: Document): boolean {
  if (document.body.hasAttribute('data-ds-dark-theme')) return true
  const color = document.defaultView?.getComputedStyle(document.body).backgroundColor ?? ''
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  if (!channels || channels.length < 3 || channels.some(Number.isNaN)) {
    return document.defaultView?.matchMedia('(prefers-color-scheme: dark)').matches ?? false
  }
  const [red = 255, green = 255, blue = 255] = channels
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 < 128
}
