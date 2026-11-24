import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { projectRoot } from './patch-path'

interface RailNode {
  type: unknown
  props: Record<string, unknown>
  children: unknown[]
}

interface Registration {
  config: {
    name: string
    children?: Record<string, { kind?: string, scope?: string }>
  }
  component: (props: Record<string, unknown>) => RailNode
}

function element(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown {
  const node = { type, props: { ...(props ?? {}) }, children }
  return typeof type === 'function' ? type({ ...node.props, children }) : node
}

function nodes(root: unknown, match: (node: RailNode) => boolean): RailNode[] {
  if (Array.isArray(root)) return root.flatMap(child => nodes(child, match))
  if (!root || typeof root !== 'object') return []
  const node = root as RailNode
  const nested = Array.isArray(node.children) ? node.children.flatMap(child => nodes(child, match)) : []
  return match(node) ? [node, ...nested] : nested
}

function loadRail() {
  const source = readFileSync(path.join(projectRoot, 'packages', 'dsh-desktop-activity', 'client.js'), 'utf8')
  let definition: {
    factory: (require: (id: string) => unknown) => {
      apply: (ctx: Record<string, unknown>) => void
      ActivityButton: Registration['component']
      placeActivityMark: (rail: unknown, memory: unknown) => void
    }
  } | undefined
  vm.runInNewContext(source, {
    document: {
      getElementById: () => null,
      createElement: () => ({ id: '', dataset: {}, textContent: '' }),
      head: { appendChild: () => undefined },
      querySelector: () => null
    },
    window: {
      __ModuleLoader__: {
        load: (value: typeof definition) => { definition = value }
      }
    }
  })
  if (!definition) throw new Error('activity client did not register')
  const React = {
    createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
      const node = element(type, props, ...children)
      return typeof type === 'function' ? type({ ...(props ?? {}), children }) : node
    },
    useState: (initial: unknown) => [initial, () => undefined],
    useEffect: () => undefined,
    useLayoutEffect: () => undefined,
    useCallback: (factory: unknown) => factory,
    useRef: (initial: unknown) => ({ current: initial }),
    useSyncExternalStore: (subscribe: unknown, getSnapshot: unknown) => (
      typeof getSnapshot === 'function' ? getSnapshot() : subscribe
    )
  }
  const plugin = definition.factory((id) => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { IconSettingsOutlineMedium: 'settings-icon' }
    throw new Error(`Unexpected client dependency: ${id}`)
  })
  const registrations: Registration[] = []
  plugin.apply({
    effect: (fn: () => void) => { fn() },
    locale: {
      register: () => undefined,
      bind: () => (key: string) => key
    },
    layout: { toggleSidebar: () => undefined },
    slots: {
      inject: (_name: string, callback: () => void) => { callback() },
      register: (config: Registration['config'], component: Registration['component']) => {
        registrations.push({ config, component })
      }
    }
  })
  const rail = registrations.find(item => item.config.name === 'shell.activity')
  if (!rail) throw new Error('activity rail was not registered')
  return { plugin, rail }
}

function described(label: string, selected = false) {
  return element('span', {
    'data-dsh-activity-item': '',
    'data-label': label,
    'data-selected': selected ? 'true' : 'false',
    onClick: () => undefined
  }, element('svg', { id: label }))
}

describe('activity rail seats', () => {
  const loaded = loadRail()

  it('declares a main seat and keeps the footer seat', () => {
    expect(loaded.rail.config.children).toMatchObject({
      'shell.activity.main': { kind: 'list', scope: 'root' },
      'shell.activity.action': { kind: 'list', scope: 'root' }
    })
  })

  it('renders both seats through the same button', () => {
    const calls: Array<[string, Record<string, unknown>]> = []
    const tree = loaded.rail.component({
      t: (key: string) => key,
      layout: { toggleSidebar: () => undefined },
      renderSlot: (name: string, props: Record<string, unknown>) => {
        calls.push([name, props])
        const Seat = props.component as Registration['component']
        return Seat({
          region: props.region,
          bindTip: props.bindTip,
          children: [described(name, true)]
        })
      }
    })
    expect(calls.map(([name]) => name)).toEqual(['shell.activity.main', 'shell.activity.action'])
    expect(calls.map(([, props]) => props.region)).toEqual(['main', 'footer'])
    const buttons = nodes(tree, node => node.type === 'button')
    const labels = buttons.map(button => button.props['aria-label'])
    expect(labels).toEqual(['home', 'shell.activity.main', 'shell.activity.action'])
    expect(buttons[0]?.props['aria-current']).toBe('page')
    expect(buttons.every(button => button.props['data-dsh-activity'] === '')).toBe(true)
    expect(buttons[1]?.props['aria-current']).toBe('page')
    expect(buttons[2]?.props['aria-expanded']).toBe(true)
    expect(buttons[2]?.props['aria-current']).toBeUndefined()
  })

  it('drops a contribution that has no name or action', () => {
    const tree = loaded.plugin.ActivityContributions({
      region: 'footer',
      bindTip: (props: Record<string, unknown>) => props,
      children: [
        element('span', { 'data-dsh-activity-item': '', 'data-label': '   ', onClick: () => undefined }),
        element('span', { 'data-dsh-activity-item': '', 'data-label': 'Tools' }),
        described('Tools')
      ]
    })
    expect(nodes(tree, node => node.type === 'button').map(button => button.props['aria-label'])).toEqual(['Tools'])
  })

  it('leaves an older button contribution untouched', () => {
    const legacy = element('button', { 'data-dsh-activity': 'legacy', 'aria-label': 'Legacy' })
    const tree = loaded.plugin.ActivityContributions({
      region: 'main',
      bindTip: (props: Record<string, unknown>) => props,
      children: [legacy]
    })
    expect(tree).toEqual([legacy])
  })

  it('moves the mark when a plugin button becomes selected', () => {
    const mark = { offsetHeight: 16, style: {} as Record<string, string>, dataset: {} as Record<string, string>, getBoundingClientRect: () => ({}) }
    const rail = {
      offsetHeight: 400,
      buttons: [] as Array<{ getAttribute(name: string): string | null }>,
      querySelector(selector: string) {
        return selector === '[data-dsh-activity-mark]' ? mark : null
      },
      querySelectorAll() {
        return rail.buttons.filter(button => (
          button.getAttribute('aria-current') === 'page'
          || button.getAttribute('aria-expanded') === 'true'
          || button.getAttribute('data-selected') === 'true'
        ))
      }
    }
    const home = {
      offsetTop: 8,
      offsetHeight: 36,
      getAttribute: (name: string) => name === 'aria-current' ? 'page' : null
    }
    const account = {
      offsetTop: 320,
      offsetHeight: 36,
      attrs: {} as Record<string, string>,
      getAttribute(name: string) { return this.attrs[name] ?? null },
      setAttribute(name: string, value: string) { this.attrs[name] = value }
    }
    rail.buttons.push(home)
    const memory = { target: null, selected: [] }
    loaded.plugin.placeActivityMark(rail, memory)
    expect(mark.style.transform).toBe('translateY(18px)')
    rail.buttons.push(account)
    account.setAttribute('data-selected', 'true')
    loaded.plugin.placeActivityMark(rail, memory)
    expect(mark.style.transform).toBe('translateY(330px)')
  })
})