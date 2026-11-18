import { describe, expect, it } from 'vitest'
import { windowsTrayIconFile, windowsTrayIconSize, windowsTrayPixels } from '../../src/main/shell/brand-icon'

describe('Windows tray icon size', () => {
  it('uses 16 physical pixels at 100% and grows with the display scale', () => {
    expect(windowsTrayPixels(1)).toBe(16)
    expect(windowsTrayPixels(1.25)).toBe(20)
    expect(windowsTrayPixels(1.5)).toBe(24)
    expect(windowsTrayPixels(2)).toBe(32)
    expect(windowsTrayPixels(Number.NaN)).toBe(16)
  })

  it('picks a pre-rendered bitmap that is at least as large as the slot', () => {
    expect(windowsTrayIconSize(16)).toBe(16)
    expect(windowsTrayIconSize(28)).toBe(32)
    expect(windowsTrayIconSize(64)).toBe(64)
    expect(windowsTrayIconSize(96)).toBe(64)
    expect(windowsTrayIconFile(28)).toBe('tray-icon-32.png')
  })
})
