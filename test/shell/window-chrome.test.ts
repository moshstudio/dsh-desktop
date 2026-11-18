import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { desktopBrandLogoPaths } from '../../src/main/shell/brand-logo'
import { workspaceDirectoryPrompt } from '../../src/main/shell/directory-picker'
import { isDesktopTitlebarDocument } from '../../src/main/shell/titlebar-document'
import { desktopWindowChrome, windowsChromeBackground, windowsTitleBarOverlay } from '../../src/main/shell/window-chrome'
import { usesDesktopCaption, WINDOWS_TITLEBAR_HEIGHT } from '../../src/shared/desktop-menu'

describe('desktop window chrome', () => {
  it('places the macOS traffic lights on the sidebar row', () => {
    expect(desktopWindowChrome('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      backgroundColor: '#00000000'
    })
    expect(desktopWindowChrome('freebsd')).toEqual({})
  })

  it.each(['win32', 'linux'])('uses the caption menu and native overlay on %s', platform => {
    expect(usesDesktopCaption(platform)).toBe(true)
    expect(usesDesktopCaption('darwin')).toBe(false)
    expect(desktopWindowChrome(platform, false).backgroundColor).toBe('#f8f8f6')
    expect(desktopWindowChrome(platform, true)).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: windowsTitleBarOverlay(true),
      autoHideMenuBar: true,
      backgroundColor: '#141416'
    })
    expect(windowsTitleBarOverlay(false)).toEqual({
      color: '#00000000',
      symbolColor: '#202124',
      height: WINDOWS_TITLEBAR_HEIGHT
    })
    expect(windowsTitleBarOverlay(true).symbolColor).toBe('#f3f4f6')
    expect(windowsChromeBackground(true)).toBe('#141416')
    expect(windowsChromeBackground(false)).toBe('#ffffff')
  })
})

describe('desktop brand logos', () => {
  it('uses the first root that has both pairing wordmarks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-brand-'))
    const dist = join(root, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist')
    await mkdir(dist, { recursive: true })
    await writeFile(join(dist, 'dsh-desktop-logo-light.png'), 'light')
    await writeFile(join(dist, 'dsh-desktop-logo-dark.png'), 'dark')
    const logos = desktopBrandLogoPaths(['/missing', root])
    expect(logos?.light.endsWith('dsh-desktop-logo-light.png')).toBe(true)
    expect(logos?.dark.endsWith('dsh-desktop-logo-dark.png')).toBe(true)
    expect(desktopBrandLogoPaths(['/missing'])).toBeUndefined()
  })
})

describe('desktop titlebar documents', () => {
  const pages = {
    splashPage: join(tmpdir(), 'splash.html'),
    importPage: join(tmpdir(), 'web-import.html')
  }

  it('accepts the application page and the local desktop pages that share its preload', () => {
    const splash = new URL(pathToFileURL(pages.splashPage))
    splash.searchParams.set('theme', 'dark')
    const importer = new URL(pathToFileURL(pages.importPage))
    importer.searchParams.set('state', '{}')
    expect(isDesktopTitlebarDocument('dsh-app://app/', pages)).toBe(true)
    expect(isDesktopTitlebarDocument('dsh-app://app/?session=1', pages)).toBe(true)
    expect(isDesktopTitlebarDocument(splash.href, pages)).toBe(true)
    expect(isDesktopTitlebarDocument(importer.href, pages)).toBe(true)
    expect(isDesktopTitlebarDocument('dsh-desktop://desktop/plugin-recovery.html?seq=1', pages)).toBe(true)
    expect(isDesktopTitlebarDocument('about:blank', pages)).toBe(false)
    expect(isDesktopTitlebarDocument('about:blank', pages, true)).toBe(true)
  })

  it('rejects other windows, embedded account pages, and a different file', () => {
    expect(isDesktopTitlebarDocument('dsh-app://other/', pages)).toBe(false)
    expect(isDesktopTitlebarDocument('dsh-app://app:3000/', pages)).toBe(false)
    expect(isDesktopTitlebarDocument('https://account.example/usage', pages)).toBe(false)
    expect(isDesktopTitlebarDocument('dsh-desktop://desktop/safe-mode.html', pages)).toBe(false)
    expect(isDesktopTitlebarDocument('dsh-desktop://harness/', pages)).toBe(false)
    expect(isDesktopTitlebarDocument(pathToFileURL(join(tmpdir(), 'other.html')).href, pages)).toBe(false)
  })
})

describe('workspace directory picker', () => {
  it('names the folder panel in the Desktop language', () => {
    expect(workspaceDirectoryPrompt('zh')).toBe('选择工作区目录')
    expect(workspaceDirectoryPrompt('en')).toBe('Select Workspace Directory')
  })
})
