// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { DESKTOP_WINDOW_CONTROL_CHANNEL, DESKTOP_WINDOW_STATE_CHANNEL } from '../src/shared/desktop-window-controls'
import { mountWindowControls, type CaptionIpc } from '../src/preload/window-controls'
import { mountWindowsTitlebarLayout } from '../src/preload/windows-titlebar'

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement.removeAttribute('lang')
  document.documentElement.removeAttribute('data-dsh-modal-open')
  document.getElementById('dsh-desktop-windows-titlebar-layout-style')?.remove()
  vi.unstubAllGlobals()
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

  document.documentElement.setAttribute('data-dsh-modal-open', '')
  document.body.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientY: 8, button: 0 }))
  expect(toggles()).toBe(1)
  document.documentElement.removeAttribute('data-dsh-modal-open')

  document.body.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientY: 80, button: 0 }))
  expect(toggles()).toBe(1)

  host()?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientY: 8, button: 0 }))
  expect(toggles()).toBe(1)
  controls.dispose()
})

it('drops the caption menu under an open dialog and no longer reserves a native button gap', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }))
  document.body.innerHTML = '<div data-shell-overlay></div>'
  mountWindowsTitlebarLayout({ document, ipcRenderer: ipc().renderer })
  const style = document.getElementById('dsh-desktop-windows-titlebar-layout-style')?.textContent ?? ''
  expect(style).toContain('html[data-dsh-modal-open] [data-dsh-windows-menu] { z-index: 0 !important; }')
  expect(style).toContain('right: 0;')
  expect(style).not.toContain('140px')
  expect(host()).not.toBeNull()
})
