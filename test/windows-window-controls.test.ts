// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { DESKTOP_WINDOW_CONTROL_CHANNEL, DESKTOP_WINDOW_STATE_CHANNEL } from '../src/shared/desktop-window-controls'
import { mountWindowControls, type CaptionIpc } from '../src/preload/window-controls'
import { mountWindowsTitlebarLayout, releaseWindowsTitlebarLayout } from '../src/preload/windows-titlebar'

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement.removeAttribute('lang')
  document.documentElement.removeAttribute('data-windows-titlebar')
  document.documentElement.removeAttribute('data-fullscreen')
  document.documentElement.style.removeProperty('--dsh-windows-titlebar-height')
  document.getElementById('dsh-desktop-windows-titlebar-layout-style')?.remove()
  releaseWindowsTitlebarLayout(document)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
const host = (): HTMLElement | null => document.querySelector('[data-dsh-window-controls]')
const button = (action: string): HTMLButtonElement | null =>
  host()?.shadowRoot?.querySelector<HTMLButtonElement>(`button[data-control="${action}"]`) ?? null

function ipc(): { renderer: CaptionIpc, invoke: ReturnType<typeof vi.fn>, state: (value: unknown) => void } {
  let listener: ((event: unknown, value: unknown) => void) | undefined
  const invoke = vi.fn(async (channel: string) => {
    if (channel === DESKTOP_WINDOW_CONTROL_CHANNEL) return { maximized: true, fullScreen: false }
    return { maximized: false, fullScreen: false }
  })
  const renderer: CaptionIpc = {
    invoke,
    on: (channel, next) => {
      if (channel === DESKTOP_WINDOW_STATE_CHANNEL) listener = next
    }
  }
  return { renderer, invoke, state: value => listener?.(undefined, value) }
}

it('mounts one set of caption buttons and labels them in the page language', async () => {
  const { renderer, invoke } = ipc()
  const controls = mountWindowControls({ document, ipcRenderer: renderer })
  mountWindowControls({ document, ipcRenderer: renderer })
  expect(document.querySelectorAll('[data-dsh-window-controls]')).toHaveLength(1)
  expect(host()?.shadowRoot?.querySelector('style')?.textContent).toContain('z-index: 40')

  for (const [locale, minimize, maximize, close] of [
    ['en', 'Minimize', 'Maximize', 'Close'],
    ['zh', '最小化', '最大化', '关闭'],
    ['ja', '最小化', '最大化', '閉じる'],
    ['es', 'Minimizar', 'Maximizar', 'Cerrar'],
    ['fr', 'Réduire', 'Agrandir', 'Fermer'],
    ['de', 'Minimieren', 'Maximieren', 'Schließen'],
    ['ru', 'Свернуть', 'Развернуть', 'Закрыть'],
    ['pt', 'Minimizar', 'Maximizar', 'Fechar']
  ]) {
    document.documentElement.lang = locale ?? ''
    await flush()
    expect(button('minimize')?.getAttribute('aria-label')).toBe(minimize)
    expect(button('toggle-maximize')?.getAttribute('aria-label')).toBe(maximize)
    expect(button('close')?.getAttribute('aria-label')).toBe(close)
  }
  expect(invoke).toHaveBeenCalledWith(DESKTOP_WINDOW_STATE_CHANNEL)
  controls.dispose()
  expect(host()).toBeNull()
})

it('sends the three window actions and swaps the maximize button when the frame is maximized', async () => {
  document.documentElement.lang = 'zh'
  const { renderer, invoke, state } = ipc()
  const controls = mountWindowControls({ document, ipcRenderer: renderer })
  button('minimize')?.click()
  button('toggle-maximize')?.click()
  button('close')?.click()
  await flush()
  expect(invoke).toHaveBeenCalledWith(DESKTOP_WINDOW_CONTROL_CHANNEL, 'minimize')
  expect(invoke).toHaveBeenCalledWith(DESKTOP_WINDOW_CONTROL_CHANNEL, 'toggle-maximize')
  expect(invoke).toHaveBeenCalledWith(DESKTOP_WINDOW_CONTROL_CHANNEL, 'close')
  expect(button('toggle-maximize')?.getAttribute('aria-label')).toBe('还原')
  expect(button('toggle-maximize')?.querySelector<HTMLElement>('[data-icon="maximize"]')?.hidden).toBe(true)
  expect(button('toggle-maximize')?.querySelector<HTMLElement>('[data-icon="restore"]')?.hidden).toBe(false)

  const before = invoke.mock.calls.length
  button('minimize')?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
  expect(invoke.mock.calls.length).toBe(before)

  state({ maximized: false, fullScreen: true })
  expect(host()?.hidden).toBe(false)
  expect(button('toggle-maximize')?.getAttribute('aria-label')).toBe('还原')
  state({ maximized: false, fullScreen: false })
  expect(button('toggle-maximize')?.getAttribute('aria-label')).toBe('最大化')
  controls.dispose()
})

it('toggles maximize on a caption double-click and ignores dialogs, controls, and the page below', async () => {
  const { renderer, invoke } = ipc()
  const controls = mountWindowControls({ document, ipcRenderer: renderer })
  const toggles = (): number => invoke.mock.calls.filter(call => call[0] === DESKTOP_WINDOW_CONTROL_CHANNEL && call[1] === 'toggle-maximize').length

  document.body.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientY: 8, button: 0 }))
  expect(toggles()).toBe(1)

  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  document.body.append(dialog)
  dialog.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientY: 8, button: 0 }))
  expect(toggles()).toBe(1)
  dialog.remove()

  document.body.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientY: 8, button: 0 }))
  expect(toggles()).toBe(2)

  document.body.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientY: 80, button: 0 }))
  expect(toggles()).toBe(2)

  host()?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientY: 8, button: 0 }))
  expect(toggles()).toBe(2)
  controls.dispose()
})

it('keeps the caption row above an open dialog and no longer reserves a native button gap', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }))
  document.body.innerHTML = '<div data-shell-overlay></div>'
  mountWindowsTitlebarLayout({ document, ipcRenderer: ipc().renderer })
  const style = document.getElementById('dsh-desktop-windows-titlebar-layout-style')?.textContent ?? ''
  expect(style).toContain('[data-dsh-caption-passthrough="hit"]')
  expect(style).toContain('pointer-events: none !important;')
  expect(style).toContain('[data-dsh-caption-passthrough="hit"] > *')
  expect(style).toContain('pointer-events: auto;')
  expect(style).toContain('[data-dsh-caption-passthrough="clip"]')
  expect(style).not.toContain('z-index: 0')
  expect(style).toContain('right: 0;')
  expect(style).not.toContain('140px')
  expect(host()).not.toBeNull()
})

function box(element: HTMLElement, top: number, left: number, width: number, height: number): void {
  element.getBoundingClientRect = () => ({
    top, left, width, height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({})
  }) as DOMRect
}

it('lets the caption receive clicks through a dialog mask and clips a mask painted on the layer', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }))
  const width = window.innerWidth
  const masked = document.createElement('div')
  masked.style.position = 'fixed'
  const mask = document.createElement('div')
  mask.style.position = 'absolute'
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  masked.append(mask, dialog)
  const painted = document.createElement('div')
  painted.style.position = 'fixed'
  const paintedDialog = document.createElement('div')
  paintedDialog.setAttribute('role', 'dialog')
  painted.append(paintedDialog)
  const frame = document.createElement('div')
  frame.id = 'root'
  frame.style.position = 'fixed'
  const shell = document.createElement('div')
  shell.setAttribute('data-shell-overlay', '')
  const nested = document.createElement('div')
  nested.setAttribute('role', 'dialog')
  frame.append(shell, nested)
  document.body.append(masked, painted, frame)
  box(masked, 0, 0, width, 600)
  box(mask, 40, 0, width, 560)
  box(dialog, 80, 100, 400, 400)
  box(painted, 0, 0, width, 600)
  box(paintedDialog, 80, 100, 400, 400)
  box(frame, 0, 0, width, 600)
  box(nested, 80, 100, 400, 400)

  mountWindowsTitlebarLayout({ document, ipcRenderer: ipc().renderer })
  expect(masked.getAttribute('data-dsh-caption-passthrough')).toBe('hit')
  expect(dialog.hasAttribute('data-dsh-caption-passthrough')).toBe(false)
  expect(painted.getAttribute('data-dsh-caption-passthrough')).toBe('clip')
  expect(frame.hasAttribute('data-dsh-caption-passthrough')).toBe(false)

  dialog.remove()
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  expect(masked.hasAttribute('data-dsh-caption-passthrough')).toBe(false)
})

it('keeps the separated mask hittable after the layer opts out of the caption band', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }))
  const width = window.innerWidth
  const masked = document.createElement('div')
  masked.style.position = 'fixed'
  const mask = document.createElement('div')
  mask.style.position = 'absolute'
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  masked.append(mask, dialog)
  document.body.append(masked)
  box(masked, 0, 0, width, 600)
  box(mask, 40, 0, width, 560)
  box(dialog, 80, 100, 400, 400)

  mountWindowsTitlebarLayout({ document, ipcRenderer: ipc().renderer })
  expect(masked.getAttribute('data-dsh-caption-passthrough')).toBe('hit')
  expect(getComputedStyle(mask).pointerEvents).toBe('auto')
  expect(getComputedStyle(dialog).pointerEvents).toBe('auto')

  // The layer rule computes to none and inherits. A later mutation must not
  // read that inherited value as "the mask opted out" and switch to clip.
  const original = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element, pseudo?: string | null) => {
    const style = original(element, pseudo)
    if (!(element instanceof HTMLElement)) return style
    if (element.parentElement?.getAttribute('data-dsh-caption-passthrough') !== 'hit') return style
    if (element.style.pointerEvents === 'none') return style
    return new Proxy(style, {
      get(target, prop, receiver) {
        if (prop === 'pointerEvents') return 'none'
        const value: unknown = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      }
    }) as CSSStyleDeclaration
  })
  dialog.classList.add('tick')
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  expect(masked.getAttribute('data-dsh-caption-passthrough')).toBe('hit')
})

it('clips a layer when its full-size child opts out of hits itself', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }))
  const width = window.innerWidth
  const layer = document.createElement('div')
  layer.style.position = 'fixed'
  const inert = document.createElement('div')
  inert.style.position = 'absolute'
  inert.style.pointerEvents = 'none'
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  layer.append(inert, dialog)
  document.body.append(layer)
  box(layer, 0, 0, width, 600)
  box(inert, 40, 0, width, 560)
  box(dialog, 80, 100, 400, 400)

  mountWindowsTitlebarLayout({ document, ipcRenderer: ipc().renderer })
  expect(layer.getAttribute('data-dsh-caption-passthrough')).toBe('clip')
})
