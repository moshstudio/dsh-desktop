// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

interface Registration {
  config: { name: string; id?: string; order?: number }
  component: (props: Record<string, unknown>) => unknown
}

describe('DSH Desktop client slot occupants', () => {
  it('registers one occupant per brand seat and keeps the official name mark-free', async () => {
    const source = await readFile(
      path.join(projectRoot, 'packages', 'dsh-desktop-client-ui', 'client.js'),
      'utf8'
    )
    let definition: {
      factory: (require: (id: string) => unknown) => {
        apply: (ctx: unknown) => void
        inject: string[]
      }
    } | undefined
    const appended: Array<{ textContent?: string }> = []
    const removeStyle = vi.fn()
    let disposeStyle: (() => void) | undefined
    const document = {
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => ({ id: '', dataset: {}, textContent: '', remove: removeStyle })),
      head: { appendChild: (node: { textContent?: string }) => appended.push(node) }
    }
    vm.runInNewContext(source, {
      document,
      navigator: { language: 'en-US' },
      window: {
        dshDesktop: { getRepairDraft: vi.fn(), openRepairAgent: vi.fn() },
        __ModuleLoader__: {
          load: (value: typeof definition) => {
            definition = value
          }
        }
      }
    })

    expect(definition).toBeDefined()
    const createElement = (
      type: unknown,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ): { type: unknown; props: Record<string, unknown> } => ({
      type,
      props: { ...props, children }
    })
    const BrandWordmark = vi.fn()
    const FishLogo = vi.fn()
    const plugin = definition!.factory((id) => {
      if (id === 'react') {
        return {
          createElement,
          useEffect: (effect: () => void | (() => void)) => effect(),
          useState: (initial: unknown) => [initial, vi.fn()]
        }
      }
      if (id === '@deepseek-ai/dsh-client-ui-primitives') {
        return { BrandWordmark, FishLogo }
      }
      throw new Error(`Unexpected client dependency: ${id}`)
    })

    const registrations: Registration[] = []
    const slots = {
      inject: (_name: string, callback: () => unknown): unknown => {
        const result = callback()
        if (result && typeof result === 'object' && Symbol.iterator in result) {
          for (const _entry of result as Iterable<unknown>) void _entry
        }
        return result
      },
      register: (
        config: Registration['config'],
        component: Registration['component']
      ): (() => void) => {
        registrations.push({ config, component })
        return () => undefined
      }
    }
    plugin.apply({ slots, locale: { register: () => () => undefined, bind: () => (key: string) => key }, effect: (setup: () => (() => void) | undefined) => { disposeStyle = setup() } })

    expect(plugin.inject).toEqual(['locale', 'slots', 'remote.session', 'sessions', 'uiWorkspace'])
    expect(registrations.map(({ config }) => config.name)).toEqual([
      'conversation.input.dock',
      'sidebar.settings.action',
      'sidebar.brand.mark',
      'sidebar.brand.name',
      'conversation.hero.brand.mark',
      'sidebar.right.tab.document.unpreviewable',
      'sidebar.workspaces.session.menu.item',
      'sidebar.workspaces.session.menu.item',
      'sidebar.workspaces.session.menu.item'
    ])
    expect(registrations.some(({ config }) => config.name === 'settings.sidebar.footer')).toBe(false)
    expect(source).not.toContain('了解企业版')
    // Desktop toolbar styles have an owned lifetime; branding stays in currentColor.
    expect(appended).toHaveLength(1)
    expect(appended[0]?.textContent).toContain("[data-dsh-preset-search]")
    expect(appended[0]?.textContent).not.toContain('--dsh-dialog-mask-blur')
    expect(appended[0]?.textContent).not.toContain('--dsw-mask-blur')
    expect(appended[0]?.textContent).not.toContain('backdrop-filter')
    expect(appended[0]?.textContent).toContain('html [role="dialog"] { border-radius: var(--dsw-radius-md); }')
    expect(appended[0]?.textContent).toContain("[data-dsh-market-nav-icon] span[class*=\"navIcon\"]")
    expect(appended[0]?.textContent).not.toContain("[data-taichi-dshmarket-nav-icon]")
    expect(appended[0]?.textContent).toContain("[data-dsh-better-sidebar-settings-nav] span[class*=\"navIcon\"]")

    const fixture = new DOMParser().parseFromString(`
      <html data-windows-titlebar><body>
        <div data-dsh-sidebar-root data-dsh-sidebar-wide="true">
          <div data-window-drag>
            <button data-brand-control><span data-dsh-sidebar-brand-identity></span></button>
            <button data-sidebar-toggle></button>
          </div>
          <button data-dsh-sidebar-new-session></button>
        </div>
      </body></html>
    `, 'text/html')
    const style = window.document.createElement('style')
    style.textContent = appended[0]?.textContent ?? ''
    window.document.head.append(style)
    window.document.documentElement.setAttribute('data-windows-titlebar', '')
    const sidebarFixture = window.document.body.appendChild(fixture.body.firstElementChild as HTMLElement)
    try {
      const rules = Array.from(style.sheet?.cssRules ?? [])
      const defaults = () => window.getComputedStyle(window.document.documentElement)
        .getPropertyValue('--dsh-font-family-text-default')
      expect(defaults()).toBe('')
      window.document.documentElement.setAttribute('data-platform', 'win32')
      expect(defaults()).toMatch(/^["']DSH Alibaba PuHuiTi["'],.*sans-serif$/s)
      const faces = rules.filter((rule): rule is CSSFontFaceRule => rule.type === CSSRule.FONT_FACE_RULE)
      expect(faces.map(face => face.style.getPropertyValue('font-weight'))).toEqual(['400', '700'])
      expect(style.textContent?.match(/font-display: swap;/g)).toHaveLength(2)
      const fontSources = Array.from(style.textContent?.matchAll(/src: ([^;]+);/g) ?? [], ([, src]) => src)
      expect(fontSources).toEqual(['55-Regular', '85-Bold'].map(variant => {
        const fontPath = `npm/c1-alibaba-puhui-ti@1.0.0/fonts/AlibabaPuHuiTi-3-${variant}.woff2`
        return ['cdn.jsdmirror.com', 'cdn.jsdelivr.net']
          .map(host => `url('https://${host}/${fontPath}') format('woff2')`).join(', ')
      }))
      const row = sidebarFixture.querySelector('[data-window-drag]')
      const brand = sidebarFixture.querySelector('[data-brand-control]')
      const toggle = sidebarFixture.querySelector('[data-sidebar-toggle]')
      if (!row || !brand || !toggle) throw new Error('Missing sidebar controls')
      expect(window.getComputedStyle(row).height).toBe('0px')
      expect(window.getComputedStyle(brand).display).toBe('none')
      expect(window.getComputedStyle(toggle).display).not.toBe('none')
      sidebarFixture.setAttribute('data-dsh-sidebar-wide', 'false')
      expect(window.getComputedStyle(row).height).not.toBe('0px')
    } finally {
      sidebarFixture.remove()
      style.remove()
      window.document.documentElement.removeAttribute('data-windows-titlebar')
      window.document.documentElement.removeAttribute('data-platform')
    }

    disposeStyle?.()
    expect(removeStyle).toHaveBeenCalledOnce()

    const sidebar = registrations.find(
      ({ config }) => config.name === 'sidebar.brand.name'
    )!.component
    const englishName = sidebar({ t: (key: string) => key === 'name' ? 'taichi-dsh' : key }) as { type: unknown; props: Record<string, unknown> }
    const chineseName = sidebar({ t: (key: string) => key === 'name' ? '太极-dsh' : key }) as { type: unknown; props: Record<string, unknown> }
    expect(englishName.type).toBe('span')
    expect(englishName.props.children).toEqual(['taichi-dsh'])
    expect(chineseName.props.children).toEqual(['太极-dsh'])
    expect(source).toContain("zh: { name: '太极-dsh' }")

    const sidebarMark = registrations.find(
      ({ config }) => config.name === 'sidebar.brand.mark'
    )!.component({ size: 24 }) as { type: unknown; props: Record<string, unknown> }
    expect(sidebarMark.type).toBe('svg')
    expect(sidebarMark.props.height).toBe(17)
    const markChildren = sidebarMark.props.children as Array<{ type: unknown; props: Record<string, unknown> }>
    const markCircle = markChildren.find(child => child.type === 'circle')
    if (!markCircle) throw new Error('Expected the sidebar taiji circle')
    expect(markCircle.props.fill).toBe('currentColor')

    const heroMark = registrations.find(
      ({ config }) => config.name === 'conversation.hero.brand.mark'
    )!.component({ size: 48 }) as { type: unknown; props: Record<string, unknown> }
    expect(heroMark.type).toBe(FishLogo)
    expect(heroMark.props.size).toBe(48)
  })
})
