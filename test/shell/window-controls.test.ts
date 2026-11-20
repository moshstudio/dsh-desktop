import { describe, expect, it } from 'vitest'
import { applyDesktopWindowControl, type DesktopWindowControlTarget } from '../../src/main/shell/window-controls'
import { isDesktopWindowControlAction } from '../../src/shared/desktop-window-controls'

function fakeWindow(options: { maximized?: boolean, fullScreen?: boolean } = {}): { target: DesktopWindowControlTarget & { destroy(): void }, calls: string[] } {
  const calls: string[] = []
  const target = {
    maximized: options.maximized ?? false,
    fullScreen: options.fullScreen ?? false,
    minimize() { calls.push('minimize') },
    isMaximized() { return this.maximized },
    maximize() { this.maximized = true; calls.push('maximize') },
    unmaximize() { this.maximized = false; calls.push('unmaximize') },
    close() { calls.push('close') },
    isFullScreen() { return this.fullScreen },
    setFullScreen(flag: boolean) { this.fullScreen = flag; calls.push(flag ? 'enter-fullscreen' : 'leave-fullscreen') },
    destroy() { calls.push('destroy') }
  }
  return { target, calls }
}

describe('desktop window controls', () => {
  it('accepts only the three caption actions', () => {
    expect(isDesktopWindowControlAction('minimize')).toBe(true)
    expect(isDesktopWindowControlAction('toggle-maximize')).toBe(true)
    expect(isDesktopWindowControlAction('close')).toBe(true)
    expect(isDesktopWindowControlAction('destroy')).toBe(false)
    expect(isDesktopWindowControlAction('quit')).toBe(false)
  })

  it('minimizes, toggles the frame, and closes without destroying the window', () => {
    const restored = fakeWindow()
    expect(applyDesktopWindowControl(restored.target, 'minimize')).toEqual({ maximized: false, fullScreen: false })
    expect(applyDesktopWindowControl(restored.target, 'toggle-maximize')).toEqual({ maximized: true, fullScreen: false })
    expect(applyDesktopWindowControl(restored.target, 'toggle-maximize')).toEqual({ maximized: false, fullScreen: false })
    expect(applyDesktopWindowControl(restored.target, 'close')).toEqual({ maximized: false, fullScreen: false })
    expect(restored.calls).toEqual(['minimize', 'maximize', 'unmaximize', 'close'])
    expect(restored.calls).not.toContain('destroy')

    const maximized = fakeWindow({ maximized: true })
    expect(applyDesktopWindowControl(maximized.target, 'toggle-maximize').maximized).toBe(false)
    expect(maximized.calls).toEqual(['unmaximize'])

    const fullscreen = fakeWindow({ fullScreen: true })
    expect(applyDesktopWindowControl(fullscreen.target, 'toggle-maximize')).toEqual({ maximized: false, fullScreen: false })
    expect(fullscreen.calls).toEqual(['leave-fullscreen'])
  })
})
