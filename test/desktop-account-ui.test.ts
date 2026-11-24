import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { projectRoot } from './patch-path'
import type { AccountStatus } from '../src/shared/account-gateway'

interface Node {
  type: unknown
  props: Record<string, unknown>
  children: unknown[]
}

interface HookContext {
  states: unknown[]
  cursor: number
  effects: Array<() => unknown>
  dependencies: Array<unknown[] | undefined>
  cleanups: Array<(() => void) | undefined>
}

interface AccountApi {
  status: () => Promise<AccountStatus>
  register: (email: string, password: string) => Promise<AccountStatus>
  verify: (token: string) => Promise<AccountStatus>
  login: (email: string, password: string) => Promise<AccountStatus>
  logout: () => Promise<AccountStatus>
  requestReset: (email: string) => Promise<AccountStatus>
  confirmReset: (token: string, password: string) => Promise<AccountStatus>
  checkIn: () => Promise<AccountStatus>
  refresh: () => Promise<AccountStatus>
  packages?: () => Promise<{ packages: Array<{ yuan: number; credits: number }> | null; paymentAvailable: boolean; message: string }>
  purchase?: (yuan: number) => Promise<{ ok: boolean; message: string; order: { orderId: string; yuan: number; credits: number; status: string } | null }>
  order?: (orderId: string) => Promise<{ ok: boolean; message: string; order: { orderId: string; status: string } | null }>
}

function shanghaiDay(offset = 0): string {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
  const [year, month, day] = formatted.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, (day ?? 1) + offset))
  return date.toISOString().slice(0, 10)
}

const emptyStatus = (overrides: Partial<AccountStatus> = {}): AccountStatus => ({
  configured: true,
  signedIn: false,
  email: '',
  balance: null,
  needsRestart: false,
  message: '',
  models: [],
  imageModels: [],
  videoModels: [],
  credits: null,
  profile: { models: 'ready', balance: 'ready', images: 'ready', videos: 'ready' },
  checkedIn: false,
  ...overrides
})

function createReact() {
  let active: HookContext | null = null
  const contexts = new Map<(props: Record<string, unknown>) => unknown, HookContext>()
  const React = {
    Fragment: Symbol.for('react.fragment'),
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Node => ({
      type,
      props: { ...(props ?? {}) },
      children
    }),
    useId: () => 'account-title',
    useState: (init: unknown) => {
      if (active === null) throw new Error('useState outside render')
      const index = active.cursor++
      if (!Object.hasOwn(active.states, index)) {
        active.states[index] = typeof init === 'function' ? (init as () => unknown)() : init
      }
      const context = active
      const set = (value: unknown) => {
        const current = context.states[index]
        context.states[index] = typeof value === 'function' ? (value as (prev: unknown) => unknown)(current) : value
      }
      return [active.states[index], set] as const
    },
    useRef: (value: unknown) => React.useState(() => ({ current: value }))[0],
    useCallback: (fn: unknown, _deps: unknown[]) => React.useState(() => fn)[0],
    useEffect: (fn: () => unknown, deps?: unknown[]) => {
      if (active === null) throw new Error('useEffect outside render')
      const context = active
      const index = context.cursor++
      const previous = context.dependencies[index]
      if (previous && deps && deps.length === previous.length && deps.every((value, i) => Object.is(value, previous[i]))) return
      context.dependencies[index] = deps
      context.effects.push(() => {
        context.cleanups[index]?.()
        const cleanup = fn()
        context.cleanups[index] = typeof cleanup === 'function' ? cleanup as () => void : undefined
      })
    }
  }
  const render = (component: (props: Record<string, unknown>) => unknown, props: Record<string, unknown>) => {
    let context = contexts.get(component)
    if (context === undefined) {
      context = { states: [], cursor: 0, effects: [], dependencies: [], cleanups: [] }
      contexts.set(component, context)
    }
    active = context
    context.cursor = 0
    context.effects = []
    const tree = component(props)
    const effects = context.effects
    active = null
    return { tree, effects }
  }
  const reset = () => {
    for (const context of contexts.values()) for (const cleanup of context.cleanups) cleanup?.()
    contexts.clear()
  }
  return { React, render, reset }
}

function loadPlugin(React: ReturnType<typeof createReact>['React']) {
  const clientPath = path.join(projectRoot, 'packages', 'dsh-taichi-account', 'lib', 'client.js')
  if (!existsSync(clientPath)) throw new Error('dsh-taichi-account client bundle is missing; run npm run account:build')
  const registrations = new Map<string, {
    id: string
    chunk?: string
    factory: (require: (id: string) => unknown) => Record<string, unknown>
  }>()
  const styles: Array<{ textContent?: string }> = []
  const stored = new Map<string, string>()
  const document = {
    getElementById: vi.fn(() => null),
    querySelector: vi.fn(() => null),
    createElement: vi.fn(() => ({ id: '', dataset: {}, textContent: '' })),
    head: { appendChild: (node: { textContent?: string }) => { styles.push(node) } }
  }
  const listeners = new Map<string, Set<(event: { type: string }) => void>>()
  const dispatchEvent = (event: { type: string }) => {
    for (const listener of listeners.get(event.type) ?? []) listener(event)
    return true
  }
  const sandboxWindow = {
    __ModuleLoader__: {
      load: (value: { id: string, chunk?: string, factory: (require: (id: string) => unknown) => Record<string, unknown> }) => {
        if (value.id !== 'dsh-taichi-account') throw new Error(`Unexpected account module id: ${value.id}`)
        registrations.set(value.chunk ?? '', value)
      }
    },
    addEventListener: (type: string, listener: (event: { type: string }) => void) => {
      const group = listeners.get(type) ?? new Set()
      group.add(listener)
      listeners.set(type, group)
    },
    removeEventListener: (type: string, listener: (event: { type: string }) => void) => {
      listeners.get(type)?.delete(listener)
    },
    CustomEvent: undefined as unknown as typeof CustomEvent,
    dispatchEvent: dispatchEvent as unknown as typeof window.dispatchEvent,
    localStorage: {
      getItem: (key: string) => stored.has(key) ? stored.get(key) ?? null : null,
      setItem: (key: string, value: string) => { stored.set(key, String(value)) },
      removeItem: (key: string) => { stored.delete(key) },
      clear: () => { stored.clear() }
    },
    dshDesktop: {} as { account?: AccountApi, restartHarness?: () => Promise<{ ok: boolean }> }
  }
  vm.runInNewContext(readFileSync(clientPath, 'utf8'), {
    URL,
    document,
    setInterval,
    clearInterval,
    window: sandboxWindow
  }, { filename: 'client.js' })
  const definition = registrations.get('')
  if (!definition) throw new Error('account client did not register a plugin definition')
  const primitiveNames = ['Button', 'Input', 'Modal', 'RiskConfirmation', 'SegmentedControl', 'SegmentedTabs', 'Tooltip', 'IconCheckOutlineRegular', 'IconChevronRightOutlineRegular', 'IconCloseOutlineRegular', 'IconInfoOutlineRegular', 'IconUserOutlineRegular']
  const primitives = Object.fromEntries(primitiveNames.map(name => [name, () => null]))
  const jsx = (type: unknown, props: { children?: unknown } | null, key?: unknown) => {
    const { children, ...rest } = props ?? {}
    const list = children == null ? [] : Array.isArray(children) ? children : [children]
    return React.createElement(type, key === undefined ? rest : { ...rest, key }, ...list)
  }
  const require = (id: string): unknown => {
    if (id === 'react') return React
    if (id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime') return { jsx, jsxs: jsx, Fragment: React.Fragment }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return new Proxy(primitives, {
      get: (target, key) => {
        if (!(key in target)) throw new Error(`UI primitives does not export ${String(key)}`)
        return Reflect.get(target, key)
      }
    })
    throw new Error(`Unexpected client dependency: ${id}`)
  }
  const load = Object.assign(require, {
    async: async (specifier: string) => {
      const file = specifier.startsWith('./') ? specifier.slice(2) : specifier
      const chunk = registrations.get(file)
      if (!chunk) throw new Error(`Missing account chunk: ${specifier}`)
      return chunk.factory(load)
    }
  })
  const plugin = definition.factory(load)
  const apply = plugin.apply
  if (typeof apply !== 'function') throw new Error('account client did not export apply')
  return {
    window: sandboxWindow,
    dispatchEvent,
    styles,
    plugin: {
      // The plugin factory runs in a vm realm, so its Promise fails instanceof here.
      apply: (ctx: unknown) => Promise.resolve(apply(ctx)),
      resetStatus: () => {
        const reset = plugin.resetStatus
        if (typeof reset === 'function') reset()
      },
      AccountPanel: plugin.AccountPanel as (props: Record<string, unknown>) => unknown,
      accountDialogOpen: plugin.accountDialogOpen as () => boolean,
      openAccountDialog: plugin.openAccountDialog as () => void
    }
  }
}

function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) {
    node.forEach(child => { walk(child, visit) })
    return
  }
  if (node === null || typeof node !== 'object' || !('type' in node)) return
  const record = node as Node
  visit(record)
  walk(record.children, visit)
}

function nodes(tree: unknown, predicate: (node: Node) => boolean): Node[] {
  const found: Node[] = []
  walk(tree, node => { if (predicate(node)) found.push(node) })
  return found
}

function linkLabels(tree: unknown): string[] {
  const row = nodes(tree, node => node.props['data-dsh-account-link-row'] === 'true')[0]
  const labels: string[] = []
  walk(row?.children, node => {
    for (const child of node.children) {
      if (typeof child === 'string') labels.push(child)
    }
  })
  return labels
}

function fields(tree: unknown): string[] {
  return nodes(tree, node => typeof node.type === 'function').flatMap(node => {
    if (node.props.present === false) return []
    const name = (node.type as { name?: string }).name
    if (name === 'PasswordField') return [typeof node.props.field === 'string' ? node.props.field : 'password']
    if (name === 'TextField' && typeof node.props.field === 'string') return [node.props.field]
    return []
  })
}

function screenOf(tree: unknown): string {
  const screen = nodes(tree, node => typeof node.props['data-dsh-account-screen'] === 'string')
  return String(screen[0]?.props['data-dsh-account-screen'] ?? '')
}

async function flush(): Promise<void> {
  for (let step = 0; step < 6; step += 1) await Promise.resolve()
}

function primaryDisabled(tree: unknown): boolean {
  const primary = nodes(tree, node => node.props['data-dsh-account-primary'] === 'true')
  return primary[0]?.props.disabled === true
}

interface AccountCtx {
  inject: (deps: string[], callback: (scope: AccountCtx) => void) => void
  locale: {
    register: (ns: string, dicts: Record<string, Record<string, string>>) => void
    bind: () => (key: string) => string
  }
  layout: {
    selectPanel: (id: string | null) => void
    panelInfo: {
      getSnapshot: () => { activePanelId: string | null }
      subscribe: (listener: () => void) => () => void
    }
  }
  slots: {
    inject: (name: string, callback: () => void) => void
    register: (
      config: {
        name?: string
        id?: string
        key?: string
        inject: () => { t: (key: string) => string, onStatus?: (next: AccountStatus) => void }
        select?: (owner: { code?: string, dismiss?: () => void }) => unknown
      },
      component: (props: Record<string, unknown>) => unknown
    ) => void
  }
}

describe('desktop account page', () => {
  const react = createReact()
  const loaded = loadPlugin(react.React)
  const layout = {
    active: null as string | null,
    calls: [] as Array<string | null>,
    listeners: new Set<() => void>(),
    selectPanel(id: string | null) {
      layout.active = id
      layout.calls.push(id)
      for (const listener of layout.listeners) listener()
    },
    panelInfo: {
      getSnapshot: () => ({ activePanelId: layout.active }),
      subscribe(listener: () => void) {
        layout.listeners.add(listener)
        return () => { layout.listeners.delete(listener) }
      }
    }
  }
  beforeEach(() => {
    react.reset()
    layout.active = null
    layout.calls.length = 0
    loaded.plugin.resetStatus()
    loaded.window.dispatchEvent = loaded.dispatchEvent as typeof window.dispatchEvent
    loaded.window.localStorage.clear()
    loaded.window.dshDesktop = {}
    setReducedMotion(null)
  })
  const plugin = loaded.plugin
  const dictionaries: Record<string, Record<string, string>> = {}
  const registrations: Array<{
    name?: string
    id?: string
    key?: string
    component: (props: Record<string, unknown>) => unknown
    inject: () => {
      t: (key: string, vars?: Record<string, unknown>) => string
      onStatus?: (next: AccountStatus) => void
      onClose?: () => void
      initialStatus?: AccountStatus | null
    }
    select?: (owner: { code?: string, dismiss?: () => void }) => unknown
  }> = []
  const ctx: AccountCtx = {
    inject: (_deps, callback) => { callback(ctx) },
    locale: {
      register: (_ns, dicts) => { Object.assign(dictionaries, dicts) },
      bind: () => (key: string) => key
    },
    layout,
    slots: {
      inject: (_name, callback) => { callback() },
      register: (config, component) => {
        registrations.push({
          name: config.name,
          id: config.id,
          key: config.key,
          component,
          inject: config.inject,
          select: config.select
        })
      }
    }
  }
  let AccountButton: (props: Record<string, unknown>) => unknown = () => {
    throw new Error('account button was not registered')
  }
  let AccountPanel: (props: Record<string, unknown>) => unknown = () => {
    throw new Error('account page was not registered')
  }
  let buttonProps: Record<string, unknown> = {}
  let panelInject: () => {
    t: (key: string, vars?: Record<string, unknown>) => string
    onStatus?: (next: AccountStatus) => void
    onClose?: () => void
    initialStatus?: AccountStatus | null
  } = () => { throw new Error('account page was not registered') }
  beforeAll(async () => {
    await plugin.apply(ctx)
    const button = registrations.find(item => item.name === 'shell.activity.action' && item.id === 'desktop-account')
    if (button === undefined || typeof loaded.plugin.AccountPanel !== 'function') throw new Error('account page was not registered')
    expect(registrations.some(item => item.name === 'main')).toBe(false)
    AccountButton = button.component
    buttonProps = button.inject()
    AccountPanel = loaded.plugin.AccountPanel
    panelInject = button.inject
  })

  function mountAccount(account: AccountApi, translate?: (key: string) => string) {
    loaded.window.dshDesktop.account = account
    const injected = panelInject()
    const publish = injected.onStatus
    const onStatus = vi.fn((next: AccountStatus) => { if (typeof publish === 'function') publish(next) })
    const props = { ...injected, initialStatus: null, ...(translate ? { t: translate } : {}), onStatus }
    const view = react.render(AccountPanel, props)
    return { view, onStatus, rerender: () => react.render(AccountPanel, props) }
  }

  it('shows a recharge dialog when the conversation cannot continue', () => {
    const registered = registrations.find(item => (item.component as { name?: string }).name === 'QuotaRechargeNotice')
    if (registered === undefined || registered.select === undefined) throw new Error('quota dialog was not registered')
    expect(registered.select({ code: 'QUOTA' })).toMatchObject({ code: 'QUOTA' })
    expect(registered.select({ code: 'ACCOUNT_QUOTA' })).toBeNull()
    const dismiss = vi.fn()
    const view = react.render(registered.component, {
      matched: { code: 'QUOTA', dismiss },
      t: (key: string) => dictionaries.zh?.[key] ?? key
    })
    const dialog = view.tree as Node
    expect(dialog.props).toMatchObject({
      open: true,
      title: '积分不足',
      description: '积分不足以继续本次对话，请进行充值。',
      closeLabel: '关闭'
    })
    const footer = dialog.props.footer as Node
    expect(footer.children).toContain('知道了')
    const confirm = footer.props.onClick
    if (typeof confirm !== 'function') throw new Error('recharge dialog has no confirm action')
    confirm()
    const close = dialog.props.onClose
    if (typeof close !== 'function') throw new Error('recharge dialog has no close action')
    close()
    expect(dismiss).toHaveBeenCalledTimes(2)
  })

  const api = (overrides: Partial<AccountApi> = {}): AccountApi => ({
    status: async () => emptyStatus(),
    register: async () => emptyStatus(),
    verify: async () => emptyStatus(),
    login: async () => emptyStatus(),
    logout: async () => emptyStatus(),
    requestReset: async () => emptyStatus(),
    confirmReset: async () => emptyStatus(),
    checkIn: async () => emptyStatus(),
    refresh: async () => emptyStatus(),
    packages: async () => ({ packages: [], paymentAvailable: false, message: 'payment_unconfigured' }),
    ...overrides
  })

  function setReducedMotion(reduced: boolean | null) {
    const browser = loaded.window as typeof loaded.window & {
      matchMedia?: (query: string) => { matches: boolean, media: string }
    }
    if (reduced === null) {
      delete browser.matchMedia
      return
    }
    browser.matchMedia = (query: string) => ({
      matches: reduced && query.includes('reduce'),
      media: query
    })
  }

  function invoke(node: Node | undefined, event: string, ...args: unknown[]) {
    const handler = node?.props[event]
    if (typeof handler !== 'function') throw new Error(`Missing ${event}`)
    return handler(...args)
  }

  function field(tree: unknown, name: string) {
    return nodes(tree, node => node.props.field === name && node.props.present !== false)[0]
  }

  const click = (tree: unknown, label: string) => invoke(nodes(tree, node => node.children.includes(label))[0], 'onClick')
  const segment = (tree: unknown, label: string) => {
    const control = nodes(tree, node => {
      const options = node.props.options
      return Array.isArray(options) && options.some(option => (
        option !== null && typeof option === 'object' && 'label' in option && option.label === label
      ))
    })[0]
    if (!control) throw new Error(`Missing segment ${label}`)
    return control
  }
  const choose = (tree: unknown, label: string) => {
    const control = segment(tree, label)
    const options = control.props.options as Array<{ value: string, label: string }>
    const option = options.find(item => item.label === label)
    if (!option) throw new Error(`Missing segment ${label}`)
    invoke(control, 'onChange', option.value)
  }
  const tabs = (tree: unknown) => {
    const control = nodes(tree, node => Array.isArray(node.props.items))[0]
    if (!control) throw new Error('Missing tabs')
    return control
  }
  const submit = (tree: unknown) => invoke(nodes(tree, node => node.type === 'form')[0], 'onSubmit', { preventDefault: () => undefined })
  const risk = (tree: unknown) => nodes(tree, node => 'acknowledgeLabel' in node.props)[0]

  async function mountReady(overrides: Partial<AccountApi> = {}) {
    const mounted = mountAccount(api(overrides))
    for (const effect of mounted.view.effects) effect()
    await flush()
    return mounted
  }

  it('keeps the same copy keys in every shell language', () => {
    const expected = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt']
    expect(Object.keys(dictionaries).sort()).toEqual([...expected].sort())
    const keys = Object.keys(dictionaries.zh ?? {}).sort()
    expect(keys.length).toBeGreaterThan(20)
    for (const language of expected) expect(Object.keys(dictionaries[language] ?? {}).sort()).toEqual(keys)
    expect(dictionaries.zh?.needVerify).toBe('已收到验证码')
    expect(dictionaries.en?.needVerify).toBe('Already have a code')
  })

  it('keeps account motion short and optional', async () => {
    const css = loaded.styles.map(style => style.textContent ?? '').join('\n')
    expect(css).toContain('--dsw-alias-')
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toContain('--ds-')
    const reduced = css.slice(css.toLowerCase().indexOf('prefers-reduced-motion'))
    expect(reduced).toMatch(/animation:\s*none/)
    expect(reduced).toMatch(/transition:\s*none/)

    const { rerender } = await mountReady()
    const stageKey = () => nodes(rerender().tree, node => node.props['data-dsh-account-stage'] === 'true')[0]?.props.key
    const emailSlot = () => nodes(rerender().tree, node => node.props['data-dsh-account-slot'] === 'email')[0]
    expect(stageKey()).toBe('auth')
    expect(emailSlot()?.props.key).toBe('email')
    expect(nodes(rerender().tree, node => node.props['data-dsh-account-cross'] === 'true').some(node => node.children.includes('titleLogin'))).toBe(true)
    click(rerender().tree, 'needAccount')
    expect(stageKey()).toBe('auth')
    expect(emailSlot()?.props.key).toBe('email')
    expect(nodes(rerender().tree, node => node.props['data-dsh-account-cross'] === 'true').some(node => node.children.includes('titleRegister'))).toBe(true)
    expect(nodes(rerender().tree, node => node.props['data-dsh-account-slot'] === 'confirm')[0]?.props['data-motion']).toBeUndefined()
    expect(nodes(rerender().tree, node => node.props['aria-live'] === 'polite')[0]?.props['aria-atomic']).toBe('true')
  })

  it('keeps a shared password between sign-in and registration, then clears it outside that flow', async () => {
    const { rerender } = await mountReady()
    invoke(field(rerender().tree, 'email'), 'onChange', 'a@example.com')
    invoke(field(rerender().tree, 'password'), 'onChange', 'secret-pass')
    click(rerender().tree, 'needAccount')
    expect(linkLabels(rerender().tree)).toEqual(['needVerify', 'haveAccount'])
    expect(fields(rerender().tree)).toEqual(['email', 'password', 'confirm'])
    expect(field(rerender().tree, 'email')?.props.value).toBe('a@example.com')
    expect(field(rerender().tree, 'password')?.props.value).toBe('secret-pass')
    expect(nodes(rerender().tree, node => node.props['data-dsh-account-slot'] === 'email')[0]?.props.key).toBe('email')
    click(rerender().tree, 'haveAccount')
    expect(fields(rerender().tree)).toEqual(['email', 'password'])
    expect(field(rerender().tree, 'password')?.props.value).toBe('secret-pass')
    click(rerender().tree, 'needReset')
    expect(linkLabels(rerender().tree)).toEqual(['haveAccount'])
    expect(nodes(rerender().tree, node => node.props['data-dsh-account-link-row'] === 'true')[0]?.props['data-align']).toBe('end')
    expect(fields(rerender().tree)).toEqual(['email'])
    click(rerender().tree, 'haveAccount')
    invoke(field(rerender().tree, 'password'), 'onChange', 'secret-pass')
    click(rerender().tree, 'needAccount')
    click(rerender().tree, 'needVerify')
    expect(fields(rerender().tree)).toEqual(['token'])
    click(rerender().tree, 'haveAccount')
    expect(field(rerender().tree, 'email')?.props.value).toBe('a@example.com')
    expect(field(rerender().tree, 'password')?.props.value).toBe('')
  })

  it('does not change steps while sign-in is still running', async () => {
    let finish: (status: AccountStatus) => void = () => undefined
    const login = vi.fn(() => new Promise<AccountStatus>(resolve => { finish = resolve }))
    const { rerender } = await mountReady({ login })
    invoke(field(rerender().tree, 'email'), 'onChange', 'a@example.com')
    invoke(field(rerender().tree, 'password'), 'onChange', 'onlyletters')
    submit(rerender().tree)
    click(rerender().tree, 'needAccount')
    expect(fields(rerender().tree)).toEqual(['email', 'password'])
    expect(nodes(rerender().tree, node => node.props['data-mode'] === 'login').length).toBeGreaterThan(0)
    finish(emptyStatus({ message: 'invalid_credentials' }))
    await flush()
    click(rerender().tree, 'needAccount')
    expect(fields(rerender().tree)).toEqual(['email', 'password', 'confirm'])
  })

  it('slides a new field in and holds a leaving field until the motion ends', async () => {
    setReducedMotion(false)
    const { rerender } = await mountReady()
    invoke(field(rerender().tree, 'email'), 'onChange', 'a@example.com')
    invoke(field(rerender().tree, 'password'), 'onChange', 'secret-pass')
    click(rerender().tree, 'needAccount')
    expect(nodes(rerender().tree, node => node.props['data-dsh-account-slot'] === 'confirm')[0]?.props['data-motion']).toBe('enter')
    expect(field(rerender().tree, 'password')?.props.value).toBe('secret-pass')
    click(rerender().tree, 'haveAccount')
    click(rerender().tree, 'needReset')
    const leaving = nodes(rerender().tree, node => node.props.field === 'password' && node.props.present === false)[0]
    expect(nodes(rerender().tree, node => node.props['data-dsh-account-slot'] === 'password')[0]?.props['data-motion']).toBe('exit')
    expect(leaving?.props.value).toBe('')
    expect(fields(rerender().tree)).toEqual(['email'])
    setReducedMotion(true)
    click(rerender().tree, 'haveAccount')
    click(rerender().tree, 'needAccount')
    expect(nodes(rerender().tree, node => node.props['data-dsh-account-slot'] === 'confirm')[0]?.props['data-motion']).toBeUndefined()
    click(rerender().tree, 'haveAccount')
    click(rerender().tree, 'needReset')
    expect(nodes(rerender().tree, node => node.props['data-dsh-account-slot'] === 'password')).toHaveLength(0)
  })

  it('connects a visible field error to its input', async () => {
    const dictionary = dictionaries.zh ?? {}
    const { view, rerender } = mountAccount(api(), key => dictionary[key] ?? key)
    for (const effect of view.effects) effect()
    await flush()
    invoke(field(rerender().tree, 'email'), 'onChange', 'a')
    invoke(field(rerender().tree, 'email'), 'onBlur')
    const email = field(rerender().tree, 'email')
    if (typeof email?.type !== 'function') throw new Error('email field missing')
    const emailView = react.render(email.type as (props: Record<string, unknown>) => unknown, email.props)
    const emailInput = nodes(emailView.tree, node => node.props['aria-invalid'] === true)[0]
    const emailMessage = nodes(emailView.tree, node => node.props.role === 'alert')[0]
    expect(emailInput?.props['aria-describedby']).toBeTruthy()
    expect(emailMessage?.props.id).toBe(emailInput?.props['aria-describedby'])
    click(rerender().tree, dictionary.needAccount ?? '')
    invoke(field(rerender().tree, 'password'), 'onChange', 'short')
    invoke(field(rerender().tree, 'password'), 'onBlur')
    const password = field(rerender().tree, 'password')
    if (typeof password?.type !== 'function') throw new Error('password field missing')
    const passwordView = react.render(password.type as (props: Record<string, unknown>) => unknown, password.props)
    const passwordInput = nodes(passwordView.tree, node => node.props['aria-invalid'] === true)[0]
    const passwordMessage = nodes(passwordView.tree, node => node.props.role === 'alert')[0]
    expect(passwordMessage?.props.id).toBe(passwordInput?.props['aria-describedby'])
    expect(passwordMessage?.children).toEqual([dictionary.passwordLength])
  })

  it('shows a reading state before the account form', async () => {
    let resolveStatus: (status: AccountStatus) => void = () => undefined
    const { view, rerender } = mountAccount({
      status: () => new Promise(resolve => { resolveStatus = resolve }),
      register: async () => emptyStatus(),
      verify: async () => emptyStatus(),
      login: async () => emptyStatus(),
      logout: async () => emptyStatus(),
      requestReset: async () => emptyStatus(),
      confirmReset: async () => emptyStatus(),
      checkIn: async () => emptyStatus(),
      refresh: async () => emptyStatus()
    })
    expect(screenOf(view.tree)).toBe('loading')
    expect(fields(view.tree)).not.toContain('password')
    for (const effect of view.effects) effect()
    resolveStatus(emptyStatus())
    await flush()
    expect(screenOf(rerender().tree)).toBe('auth')
  })

  it('keeps reset to the email until the code step, and blocks an empty sign-in', async () => {
    const { view, rerender } = mountAccount({
      status: async () => emptyStatus(),
      register: async () => emptyStatus(),
      verify: async () => emptyStatus(),
      login: async () => emptyStatus(),
      logout: async () => emptyStatus(),
      requestReset: async () => emptyStatus(),
      confirmReset: async () => emptyStatus(),
      checkIn: async () => emptyStatus(),
      refresh: async () => emptyStatus()
    })
    await Promise.all(view.effects.map(effect => effect()))
    await flush()
    const signedOut = rerender()
    expect(screenOf(signedOut.tree)).toBe('auth')
    expect(fields(signedOut.tree)).toEqual(['email', 'password'])
    expect(primaryDisabled(signedOut.tree)).toBe(true)
    const primary = nodes(signedOut.tree, node => node.props['data-dsh-account-primary'] === 'true')[0]
    expect(primary?.props['data-dsh-account-primary']).toBe('true')
    expect(nodes(signedOut.tree, node => node.props['data-dsh-account-footer'] === 'true')[0]?.props['data-align']).toBe('stretch')
    expect(linkLabels(signedOut.tree)).toEqual(['needReset', 'needAccount'])
    expect(nodes(signedOut.tree, node => node.props['data-dsh-account-link-row'] === 'true')[0]?.props['data-align']).toBe('between')
    const reset = nodes(signedOut.tree, node => node.children.includes('needReset'))[0]
    const onClick = reset?.props.onClick
    if (typeof onClick !== 'function') throw new Error('reset link is missing')
    onClick()
    const resetting = rerender()
    expect(fields(resetting.tree)).toEqual(['email'])
    expect(fields(resetting.tree)).not.toContain('password')
  })

  it('hides the form when the gateway is not configured', async () => {
    const { view, rerender } = mountAccount({
      status: async () => emptyStatus({ configured: false }),
      register: async () => emptyStatus(),
      verify: async () => emptyStatus(),
      login: async () => emptyStatus(),
      logout: async () => emptyStatus(),
      requestReset: async () => emptyStatus(),
      confirmReset: async () => emptyStatus(),
      checkIn: async () => emptyStatus(),
      refresh: async () => emptyStatus()
    })
    await Promise.all(view.effects.map(effect => effect()))
    await flush()
    const gateway = rerender()
    expect(screenOf(gateway.tree)).toBe('gateway')
    expect(fields(gateway.tree)).toEqual([])
  })

  it('shows credits and models for a signed-in account without the password field', async () => {
    const { view, rerender } = mountAccount({
      status: async () => emptyStatus({
        signedIn: true,
        email: 'owner@example.com',
        balance: 0,
        models: [
          { id: 'demo-chat', name: 'demo-chat' },
          { id: 'long-model', name: 'long-model' }
        ]
      }),
      register: async () => emptyStatus(),
      verify: async () => emptyStatus(),
      login: async () => emptyStatus(),
      logout: async () => emptyStatus(),
      requestReset: async () => emptyStatus(),
      confirmReset: async () => emptyStatus(),
      checkIn: async () => emptyStatus(),
      refresh: async () => emptyStatus()
    })
    await Promise.all(view.effects.map(effect => effect()))
    await flush()
    const home = rerender()
    expect(screenOf(home.tree)).toBe('home')
    expect(fields(home.tree)).not.toContain('password')
    const text: unknown[] = []
    walk(home.tree, node => { text.push(...node.children) })
    expect(text).toContain('0')
    expect(text).toContain('balance')
    expect(text).toContain('demo-chat')
    expect(text).toContain('owner@example.com')
    expect(text).toContain('logout')
    expect(text).not.toContain('signedIn')
    expect(text).not.toContain('descAccount')
    expect(nodes(home.tree, node => node.type === 'form')).toHaveLength(0)
    expect(nodes(home.tree, node => node.props['data-dsh-account-model-name'] === 'true').map(node => node.children)).toEqual([['demo-chat'], ['long-model']])
    expect(nodes(home.tree, node => node.type === 'article')).toHaveLength(2)
    expect(nodes(home.tree, node => node.children.includes('priceUnavailable'))).toHaveLength(2)
    expect(nodes(home.tree, node => node.children.includes('creditsUnread'))).toHaveLength(1)
  })

  it('shows image and video prices apart from chat models', async () => {
    const { rerender } = await mountReady({
      status: async () => emptyStatus({
        signedIn: true,
        email: 'owner@example.com',
        balance: 10,
        models: [{ id: 'demo-chat', name: 'demo-chat' }],
        imageModels: [
          { id: 'later', name: 'Later', credits: 80 },
          { id: 'sooner', name: 'Sooner', credits: 12 },
          { id: 'unpriced', name: 'Unpriced' }
        ],
        videoModels: [{ id: 'veo', name: 'Veo', credits: 2600 }]
      })
    })
    const chat = rerender().tree
    expect(nodes(chat, node => node.props['data-dsh-account-model-name'] === 'true').map(node => node.children)).toEqual([['demo-chat']])
    choose(chat, 'catalogImage')
    const images = rerender().tree
    expect(nodes(images, node => node.props['data-dsh-account-model-name'] === 'true').map(node => node.children)).toEqual([['Sooner'], ['Later'], ['Unpriced']])
    expect(nodes(images, node => node.props['data-dsh-account-rate'] === 'true').map(node => node.children)).toEqual([['12'], ['80']])
    expect(nodes(images, node => node.children.includes('pricePerImage'))).toHaveLength(2)
    expect(nodes(images, node => node.children.includes('priceUnavailable'))).toHaveLength(1)
    expect(nodes(images, node => node.children.includes('demo-chat'))).toHaveLength(0)
    choose(images, 'catalogVideo')
    const videos = rerender().tree
    expect(nodes(videos, node => node.props['data-dsh-account-model-name'] === 'true').map(node => node.children)).toEqual([['Veo']])
    expect(nodes(videos, node => node.props['data-dsh-account-rate'] === 'true').map(node => node.children)).toEqual([['2,600']])
    expect(nodes(videos, node => node.children.includes('pricePerVideo'))).toHaveLength(1)
    expect(nodes(videos, node => node.children.includes('imagesEmpty'))).toHaveLength(0)
  })

  it('merges image tier prices that cost the same number of credits', async () => {
    const { rerender } = await mountReady({
      status: async () => emptyStatus({
        signedIn: true,
        email: 'owner@example.com',
        imageModels: [{
          id: 'gpt-image-2',
          name: 'GPT Image 2',
          credits: 150,
          qualityCredits: [
            { tier: '1k', credits: 150 },
            { tier: '4k', credits: 400 },
            { tier: '2k', credits: 400 }
          ]
        }]
      })
    })
    choose(rerender().tree, 'catalogImage')
    const images = rerender().tree
    expect(nodes(images, node => node.props['data-dsh-account-rate-label'] === 'true').map(node => node.children)).toEqual([['1K'], ['2K / 4K']])
    expect(nodes(images, node => node.props['data-dsh-account-rate'] === 'true').map(node => node.children)).toEqual([['150'], ['400']])
    expect(nodes(images, node => node.children.includes('pricePerImage'))).toHaveLength(2)
    expect(JSON.stringify(images)).not.toContain('vip')
  })

  it('keeps an empty media catalog distinct from a failed read', async () => {
    const { rerender } = await mountReady({
      status: async () => emptyStatus({
        signedIn: true,
        email: 'owner@example.com',
        imageModels: [],
        videoModels: [{ id: 'ignored', name: 'Ignored', credits: 1 }],
        profile: { models: 'ready', balance: 'ready', images: 'ready', videos: 'failed' }
      })
    })
    choose(rerender().tree, 'catalogImage')
    const images = rerender().tree
    expect(nodes(images, node => node.children.includes('imagesEmpty'))).toHaveLength(1)
    expect(nodes(images, node => node.children.includes('imagesUnread'))).toHaveLength(0)
    expect(nodes(images, node => node.type === 'article')).toHaveLength(0)
    choose(images, 'catalogVideo')
    const videos = rerender().tree
    expect(nodes(videos, node => node.children.includes('videosUnread'))).toHaveLength(1)
    expect(nodes(videos, node => node.children.includes('videosEmpty'))).toHaveLength(0)
    expect(nodes(videos, node => node.children.includes('Ignored'))).toHaveLength(0)
    expect(nodes(videos, node => node.children.includes('retry'))).toHaveLength(1)
  })

  it('reloads the model list each time the account page is opened', async () => {
    const refresh = vi.fn(async () => emptyStatus({
      signedIn: true,
      email: 'owner@example.com',
      models: [{ id: 'fresh', name: 'Fresh' }]
    }))
    const { view, rerender } = mountAccount(api({
      status: async () => emptyStatus({
        signedIn: true,
        email: 'owner@example.com',
        models: [{ id: 'cached', name: 'Cached' }]
      }),
      refresh
    }))
    for (const effect of view.effects) effect()
    await flush()
    expect(refresh).not.toHaveBeenCalled()
    layout.selectPanel('desktop-account')
    for (const effect of rerender().effects) effect()
    await flush()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(nodes(rerender().tree, node => node.props['data-dsh-account-model-name'] === 'true').map(node => node.children)).toEqual([['Fresh']])
    layout.selectPanel(null)
    for (const effect of rerender().effects) effect()
    layout.selectPanel('desktop-account')
    for (const effect of rerender().effects) effect()
    await flush()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('shows model prices on cards and keeps credit activity behind tabs', async () => {
    const { rerender } = await mountReady({
      status: async () => emptyStatus({
        signedIn: true,
        email: 'a@example.com',
        balance: 12,
        models: [
          {
            id: 'demo-chat',
            name: 'Demo Chat',
            price: {
              inputPerMillion: 2500,
              outputPerMillion: 10000,
              cachePerMillion: 250,
              cacheWrite5mPerMillion: 3125,
              cacheWrite1hPerMillion: 5000,
              listInputPerMillion: 14000,
              listOutputPerMillion: 70000,
              savingsRatio: 0.98,
              longContext: { minInputTokens: 272001, input: 2, output: 1.5, cache: 2, cacheWrite: 2 },
              peak: { multiplier: 2, weekdays: [0, 1, 2, 3, 4], windows: [['01:00', '04:00'], ['06:00', '10:00']] }
            }
          },
          { id: 'plain', name: 'Plain' }
        ],
        credits: {
          consumed: 30,
          recharged: 700,
          usageCount: 1,
          consumption: [{ id: 'request-used', amount: 30, createdAt: '2026-11-18T15:40:00.000Z', model: 'demo-chat' }],
          recharge: [
            { id: 'checkin-1', amount: 100, createdAt: '2026-11-18T15:30:00.000Z', kind: 'checkin' },
            { id: 'signup-1', amount: 600, createdAt: '2026-11-18T15:00:00.000Z', kind: 'signup' }
          ],
          daily: [
            { date: shanghaiDay(-1), consumed: 0, recharged: 600, count: 0 },
            { date: shanghaiDay(0), consumed: 30, recharged: 100, count: 1 }
          ]
        }
      })
    })
    const open = rerender().tree
    expect(tabs(open).props.value).toBe('models')
    expect(nodes(open, node => node.type === 'article')).toHaveLength(2)
    expect(nodes(open, node => node.props['data-dsh-account-rate'] === 'true').flatMap(node => node.children)).toEqual(['2,500', '10,000'])
    expect(nodes(open, node => node.props['data-dsh-account-rate-list'] === 'true').flatMap(node => node.children)).toEqual(['14,000', '70,000'])
    expect(nodes(open, node => node.props['data-dsh-account-save'] === 'true').flatMap(node => node.children)).toEqual(['priceSave 98%'])
    expect(nodes(open, node => node.props['data-dsh-account-bill'] === 'true')).toHaveLength(1)
    const cacheText: unknown[] = []
    walk(nodes(open, node => node.props['data-dsh-account-cache'] === 'true')[0], node => { cacheText.push(...node.children) })
    expect(cacheText).toEqual([
      'cacheReadBrief', ' ', '250', 'perMillion',
      ' · ',
      'cacheWriteBrief', ' ', '3,125', 'perMillionTokens'
    ])
    expect(nodes(open, node => node.props['aria-label'] === 'longContext')).toHaveLength(1)
    expect(nodes(open, node => node.props.label === 'longContext longContextFrom 272,001 tokens inputPrice ×2 outputPrice ×1.5 cachePrice ×2 cacheWritePrice ×2')).toHaveLength(1)
    const noteText: unknown[] = []
    for (const note of nodes(open, node => node.props['data-dsh-account-price-note'] === 'true')) {
      walk(note, node => { noteText.push(...node.children.filter(child => typeof child === 'string')) })
    }
    expect(noteText.join(' ')).not.toContain('longContext')
    expect(noteText).toEqual(expect.arrayContaining([
      'peakPrice', 'weekdayMon', 'weekdayFri', '01:00–04:00', '06:00–10:00'
    ]))
    expect(nodes(open, node => node.children.includes('priceUnavailable'))).toHaveLength(1)
    expect(nodes(open, node => node.props['data-dsh-account-rate-unit'] === 'true')).toHaveLength(2)
    expect(nodes(open, node => node.type === 'svg')).toHaveLength(1)
    expect(nodes(open, node => node.props['data-dsh-account-chart-tip'] === 'true').flatMap(node => node.children)).toContain('30')
    expect(dictionaries.zh?.totalConsumed).toBe('总消耗')
    expect(nodes(open, node => node.props['data-dsh-account-stat-label'] === 'true').flatMap(node => node.children)).toEqual([
      'totalConsumed',
      'consumed',
      'recharged',
      'usageCount',
      'consumed'
    ])
    expect(nodes(open, node => node.props['data-dsh-account-stat-value'] === 'true').map(node => node.children)).toEqual([['30'], ['700'], ['1']])
    choose(open, 'rangeYesterday')
    const yesterday = rerender().tree
    expect(nodes(yesterday, node => node.props['data-dsh-account-stat-value'] === 'true').map(node => node.children)).toEqual([['0'], ['600'], ['0']])
    expect(nodes(yesterday, node => node.children.includes('chartEmpty'))).toHaveLength(1)
    choose(yesterday, 'rangeToday')
    const today = rerender().tree
    expect(nodes(today, node => node.props['data-dsh-account-stat-value'] === 'true').map(node => node.children)).toEqual([['30'], ['100'], ['1']])
    expect(nodes(today, node => node.type === 'svg')).toHaveLength(1)
    choose(today, 'rangeAll')
    const entire = rerender().tree
    expect(nodes(entire, node => node.props['data-dsh-account-stat-value'] === 'true').map(node => node.children)).toEqual([['30'], ['700'], ['1']])
    expect(nodes(open, node => node.children.includes('−30'))).toHaveLength(0)
    invoke(tabs(entire), 'onChange', 'usage')
    const usage = rerender().tree
    expect(nodes(usage, node => node.type === 'article')).toHaveLength(0)
    expect(nodes(usage, node => node.children.includes('demo-chat')).length).toBeGreaterThan(0)
    expect(nodes(usage, node => node.children.includes('−30'))).toHaveLength(1)
    invoke(tabs(usage), 'onChange', 'recharge')
    const grants = rerender().tree
    expect(nodes(grants, node => node.children.includes('+100'))).toHaveLength(1)
    expect(nodes(grants, node => node.children.includes('+600'))).toHaveLength(1)
    expect(nodes(grants, node => node.children.includes('kindCheckin'))).toHaveLength(1)
    expect(nodes(grants, node => node.children.includes('kindSignup'))).toHaveLength(1)
    expect(tabs(grants).props.value).toBe('recharge')
  })

  it('sorts the model list by vendor or by input price', async () => {
    const { rerender } = await mountReady({
      status: async () => emptyStatus({
        signedIn: true,
        email: 'a@example.com',
        balance: 1,
        models: [
          { id: 'openai/gpt', name: 'GPT', price: { inputPerMillion: 5000, outputPerMillion: 8000 } },
          { id: 'anthropic/claude', name: 'Claude', price: { inputPerMillion: 1000, outputPerMillion: 2000 } },
          { id: 'openai/mini', name: 'Mini', price: { inputPerMillion: 200, outputPerMillion: 200 } },
          { id: 'openai/o1', name: 'o1' },
          { id: 'plain', name: 'Plain', price: { inputPerMillion: 100, outputPerMillion: 100 } }
        ]
      })
    })
    const names = (tree: unknown) => nodes(tree, node => node.props['data-dsh-account-model-name'] === 'true').map(node => node.children[0])
    const home = rerender().tree
    expect(nodes(home, node => node.children.includes('sortByVendor') && node.props['aria-pressed'] === false)).toHaveLength(1)
    expect(nodes(home, node => node.props['data-dsh-account-vendor'] === 'true').map(node => node.children[0])).toEqual(['OpenAI', 'Anthropic', 'vendorOther'])
    expect(names(home)).toEqual(['Mini', 'GPT', 'o1', 'Claude', 'Plain'])
    click(home, 'sortByVendor')
    const priced = rerender().tree
    expect(nodes(priced, node => node.children.includes('sortByPrice') && node.props['aria-pressed'] === true)).toHaveLength(1)
    expect(nodes(priced, node => node.props['data-dsh-account-vendor'] === 'true')).toHaveLength(0)
    expect(names(priced)).toEqual(['Plain', 'Mini', 'Claude', 'GPT', 'o1'])
  })

  it('turns an unknown service code into the unavailable message', async () => {
    const { view, rerender } = mountAccount({
      status: async () => emptyStatus({ message: 'nope' }),
      register: async () => emptyStatus(),
      verify: async () => emptyStatus(),
      login: async () => emptyStatus(),
      logout: async () => emptyStatus(),
      requestReset: async () => emptyStatus(),
      confirmReset: async () => emptyStatus(),
      checkIn: async () => emptyStatus(),
      refresh: async () => emptyStatus()
    })
    await Promise.all(view.effects.map(effect => effect()))
    await flush()
    const failed = rerender()
    const alert = nodes(failed.tree, node => node.props.role === 'alert')
    expect(alert.some(node => node.children.includes('unavailable'))).toBe(true)
  })
  it('closes logout confirmation on a successful signed-out response without a message', async () => {
    const restart = vi.fn(async () => ({ ok: true }))
    loaded.window.dshDesktop.restartHarness = restart
    const { rerender } = await mountReady({ status: async () => emptyStatus({ signedIn: true, email: 'a@example.com' }) })
    click(rerender().tree, 'logout')
    invoke(risk(rerender().tree), 'onAcknowledgedChange', true)
    invoke(risk(rerender().tree), 'onConfirm')
    await flush()
    const tree = rerender().tree
    expect(restart).not.toHaveBeenCalled()
    expect(risk(tree)?.props.open).toBe(false)
    expect(screenOf(tree)).toBe('auth')
  })

  it('keeps logout confirmation available after failure', async () => {
    const { rerender } = await mountReady({
      status: async () => emptyStatus({ signedIn: true, email: 'a@example.com' }),
      logout: async () => { throw new Error('offline') }
    })
    click(rerender().tree, 'logout')
    invoke(risk(rerender().tree), 'onConfirm')
    await flush()
    expect(risk(rerender().tree)?.props.open).toBe(true)
    expect(risk(rerender().tree)?.props.disabled).toBe(false)
  })

  it('clears old service errors when changing forms and describes verification without an email', async () => {
    const { rerender } = await mountReady({ status: async () => emptyStatus({ message: 'invalid_credentials' }) })
    expect(nodes(rerender().tree, node => node.props.role === 'alert')).toHaveLength(1)
    click(rerender().tree, 'needAccount')
    click(rerender().tree, 'needVerify')
    const tree = rerender().tree
    expect(nodes(tree, node => node.props.role === 'alert')).toHaveLength(0)
    expect(nodes(tree, node => node.children.includes('descVerifyUnknown'))).toHaveLength(1)
  })

  it('keeps unknown credits distinct from zero and uses signed-in empty model copy', async () => {
    const { rerender } = await mountReady({ status: async () => emptyStatus({ signedIn: true, email: 'a@example.com' }) })
    const tree = rerender().tree
    const balance = nodes(tree, node => node.props['data-dsh-account-balance'] === 'true')[0]
    expect(balance?.children).toEqual(['—'])
    expect(nodes(tree, node => node.props['data-dsh-account-caption'] === 'true')[0]?.children).toEqual(['balanceUnread'])
    expect(nodes(tree, node => node.children.includes('modelsEmpty'))).toHaveLength(1)
    expect(dictionaries.zh?.modelsEmpty).toBe('暂无可用模型。')
  })

  it('announces a check-in without repeating the balance', async () => {
    const { rerender } = await mountReady({
      status: async () => emptyStatus({
        signedIn: true,
        email: 'a@example.com',
        balance: 4,
        checkedIn: true,
        message: 'checked_in',
        models: [{ id: 'demo-chat', name: 'demo-chat' }]
      })
    })
    const caption = nodes(rerender().tree, node => node.props['data-dsh-account-caption'] === 'true')[0]
    expect(caption?.children).toEqual(['checked_in'])
    expect(caption?.props.role).toBe('status')
    const checked = nodes(rerender().tree, node => node.children.includes('checkedInDone'))[0]
    expect(checked?.props.disabled).toBe(true)
    expect(nodes(rerender().tree, node => node.props['data-dsh-account-balance'] === 'true')[0]?.children).toEqual(['4'])
  })

  it.each([false, true])('refreshes the account after payment (close before refresh: %s)', async closeBeforeRefresh => {
    const pageUrl = 'https://openapi.alipay.com/gateway.do?method=alipay.trade.page.pay&sign_type=RSA2&sign=test'
    const packages = vi.fn(async () => ({
      packages: [{ yuan: 50, credits: 40_000 }, { yuan: 80, credits: 70_000 }],
      paymentAvailable: true,
      message: ''
    }))
    const purchase = vi.fn(async () => ({
      ok: true,
      message: '',
      order: { orderId: '11111111-1111-4111-8111-111111111111', yuan: 50, credits: 40_000, status: 'pending', qrImage: pageUrl }
    }))
    let completeRefresh: (status: AccountStatus) => void = () => undefined
    const refresh = vi.fn(() => new Promise<AccountStatus>(resolve => { completeRefresh = resolve }))
    const { rerender } = await mountReady({
      status: async () => emptyStatus({ signedIn: true, email: 'a@example.com', balance: 4 }),
      packages,
      purchase,
      refresh,
      order: async orderId => ({ ok: true, message: '', order: { orderId, status: 'paid' } })
    })
    expect(nodes(rerender().tree, node => node.props['data-yuan'] === '50')).toHaveLength(0)
    click(rerender().tree, 'rechargeAction')
    expect(nodes(rerender().tree, node => node.children.includes('rechargeLoading'))).toHaveLength(1)
    await flush()
    const packs = nodes(rerender().tree, node => node.props['data-dsh-account-pack'] === 'true')
    expect(packs.map(node => node.props['data-yuan'])).toEqual(['50', '80'])
    expect(packs.map(node => node.props['data-credits'])).toEqual(['40000', '70000'])
    expect(nodes(packs[0], node => node.type === 'strong').map(node => node.children)).toEqual([['rechargeCredits']])
    expect(nodes(rerender().tree, node => node.props.description === 'rechargeRate')).toHaveLength(1)
    invoke(packs[0], 'onClick')
    invoke(packs[1], 'onClick')
    const opening = rerender().tree
    expect(nodes(opening, node => node.props.role === 'status' && node.children.includes('creating'))).toHaveLength(1)
    expect(nodes(opening, node => node.props['data-dsh-account-pack'] === 'true').every(node => node.props.disabled === true)).toBe(true)
    invoke(nodes(opening, node => node.props.title === 'rechargeTitle')[0], 'onClose')
    expect(nodes(rerender().tree, node => node.props.title === 'rechargeTitle')).toHaveLength(1)
    await flush()
    expect(purchase).toHaveBeenCalledTimes(1)
    expect(purchase).toHaveBeenCalledWith(50)
    const waiting = rerender()
    expect(nodes(waiting.tree, node => node.props.role === 'status' && node.children.includes('rechargeWaiting'))).toHaveLength(1)
    expect(nodes(waiting.tree, node => node.props['data-dsh-account-pack'] === 'true')).toHaveLength(0)
    const frame = nodes(waiting.tree, node => node.type === 'iframe' && node.props['data-dsh-account-qr'] === 'true')[0]
    expect(frame?.props.src).toBe(pageUrl)
    expect(frame?.props.title).toBe('rechargeScan')
    for (const effect of waiting.effects) effect()
    await flush()
    const paid = rerender()
    for (const effect of paid.effects) effect()
    expect(nodes(paid.tree, node => node.props.role === 'status' && node.children.includes('rechargePaid'))).toHaveLength(1)
    expect(nodes(paid.tree, node => node.props['data-dsh-account-qr'] === 'true')).toHaveLength(0)
    expect(refresh).toHaveBeenCalledOnce()
    expect(nodes(paid.tree, node => node.props['data-dsh-account-balance'] === 'true')[0]?.children).toEqual(['4'])
    if (closeBeforeRefresh) {
      invoke(nodes(paid.tree, node => node.props.title === 'rechargeTitle')[0], 'onClose')
      const closed = rerender()
      for (const effect of closed.effects) effect()
      expect(nodes(closed.tree, node => node.props.title === 'rechargeTitle')).toHaveLength(0)
    }
    completeRefresh(emptyStatus({
      signedIn: true,
      email: 'a@example.com',
      balance: 40_004,
      credits: {
        consumed: 0, recharged: 40_000, usageCount: 0, consumption: [], daily: [],
        recharge: [{ id: 'payment-1', kind: 'purchase', amount: 40_000, createdAt: '2026-11-18T15:30:00.000Z' }]
      }
    }))
    await flush()
    const refreshed = rerender().tree
    expect(nodes(refreshed, node => node.props['data-dsh-account-balance'] === 'true')[0]?.children).toEqual(['40004'])
    invoke(tabs(refreshed), 'onChange', 'recharge')
    expect(nodes(rerender().tree, node => node.props['data-sign'] === 'plus' && node.children.includes('+40,000'))).toHaveLength(1)
  })

  it('keeps a failed package read retryable and does not show fallback prices', async () => {
    const packages = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ packages: [], paymentAvailable: false, message: 'payment_unconfigured' })
    const { rerender } = await mountReady({
      status: async () => emptyStatus({ signedIn: true, email: 'a@example.com', balance: 4 }),
      packages
    })
    click(rerender().tree, 'rechargeAction')
    await flush()
    expect(nodes(rerender().tree, node => node.props['data-dsh-account-pack'] === 'true')).toHaveLength(0)
    expect(nodes(rerender().tree, node => node.children.includes('unavailable'))).toHaveLength(1)
    invoke(nodes(rerender().tree, node => node.props['data-dsh-account-pack-retry'] === 'true')[0], 'onClick')
    await flush()
    expect(packages).toHaveBeenCalledTimes(2)
    expect(nodes(rerender().tree, node => node.children.includes('rechargeEmptyPackages'))).toHaveLength(1)
    expect(nodes(rerender().tree, node => node.children.includes('payment_unconfigured'))).toHaveLength(1)
  })

  it('retries a failed profile instead of describing the catalog as empty', async () => {
    const refresh = vi.fn(async () => emptyStatus({
      signedIn: true,
      email: 'a@example.com',
      balance: 2,
      models: [{ id: 'demo-chat', name: 'demo-chat' }],
      checkedIn: true
    }))
    const { rerender } = await mountReady({
      status: async () => emptyStatus({
        signedIn: true,
        email: 'a@example.com',
        message: 'profile_unavailable',
        balance: null,
        profile: { models: 'failed', balance: 'failed', images: 'ready', videos: 'ready' }
      }),
      refresh
    })
    const failed = rerender().tree
    expect(nodes(failed, node => node.type === 'form')).toHaveLength(0)
    expect(nodes(failed, node => node.children.includes('modelsEmpty'))).toHaveLength(0)
    expect(nodes(failed, node => node.children.includes('modelsUnread'))).toHaveLength(1)
    expect(nodes(failed, node => node.children.includes('balanceUnread'))).toHaveLength(1)
    click(failed, 'retry')
    await flush()
    expect(refresh).toHaveBeenCalledOnce()
    const recovered = rerender().tree
    expect(nodes(recovered, node => node.children.includes('demo-chat'))).toHaveLength(1)
    expect(nodes(recovered, node => node.children.includes('checked_in'))).toHaveLength(1)
    expect(nodes(recovered, node => node.children.includes('retry'))).toHaveLength(0)
  })

  it('opens the account dialog from the rail without leaving the conversation', () => {
    loaded.window.dshDesktop.account = api()
    const railProps = { ...buttonProps, wide: false }
    const button = react.render(AccountButton, railProps)
    expect(nodes(button.tree, node => node.props.className === 'dsh-desktop-tooltip')).toHaveLength(0)
    const accountButton = nodes(button.tree, node => node.props['data-dsh-taichi-account'] === 'true')[0]
    expect(accountButton?.props['data-dsh-activity']).toBe('')
    expect(accountButton?.props['aria-label']).toBe('open')
    expect(accountButton?.props['data-selected']).toBe('false')
    expect(accountButton?.type).toBe('button')
    expect(nodes(button.tree, node => node.type === AccountPanel)).toHaveLength(0)
    for (const effect of button.effects) effect()
    const opener = () => nodes(react.render(AccountButton, buttonProps).tree, node => node.props['data-dsh-taichi-account'] === 'true')[0]
    const dialog = () => nodes(react.render(AccountButton, buttonProps).tree, node => node.type === AccountPanel)
    invoke(opener(), 'onClick')
    expect(layout.calls).toEqual([])
    expect(opener()?.props['data-selected']).toBe('true')
    expect(opener()?.props['aria-pressed']).toBe('true')
    expect(dialog()).toHaveLength(1)
    invoke(opener(), 'onClick')
    expect(layout.calls).toEqual([])
    expect(opener()?.props['data-selected']).toBe('false')
    expect(dialog()).toHaveLength(0)
    loaded.window.dispatchEvent({ type: 'dsh-taichi-account-open' } as unknown as Event)
    expect(dialog()).toHaveLength(1)
    expect(layout.calls).toEqual([])
    const page = react.render(AccountPanel, panelInject())
    const modal = nodes(page.tree, node => node.props.className === 'dsh-account-dialog')[0]
    expect(modal?.props).toMatchObject({ open: true, headless: true, title: 'open' })
    expect(nodes(page.tree, node => node.props['data-dsh-account-panel'] === 'true')).toHaveLength(1)
  })

  it('opens a signed-in page from the cached status without the loading screen', async () => {
    loaded.window.dshDesktop.account = api({
      status: async () => emptyStatus({
        signedIn: true,
        email: 'owner@example.com',
        balance: 3,
        models: [{ id: 'demo-chat', name: 'demo-chat' }]
      })
    })
    const button = react.render(AccountButton, buttonProps)
    for (const effect of button.effects) effect()
    await flush()
    const view = react.render(AccountPanel, panelInject())
    expect(screenOf(view.tree)).toBe('home')
    expect(nodes(view.tree, node => node.children.includes('descLoading'))).toHaveLength(0)
    expect(nodes(view.tree, node => node.children.includes('owner@example.com'))).toHaveLength(1)
  })

  it('validates email after blur or submit, and resets validation on form changes', async () => {
    const { rerender } = await mountReady()
    invoke(field(rerender().tree, 'email'), 'onChange', 'a')
    expect(field(rerender().tree, 'email')?.props.invalid).toBe(false)
    invoke(field(rerender().tree, 'email'), 'onBlur')
    expect(field(rerender().tree, 'email')?.props.invalid).toBe(true)
    click(rerender().tree, 'needAccount')
    expect(field(rerender().tree, 'email')?.props.invalid).toBe(false)
    submit(rerender().tree)
    expect(field(rerender().tree, 'email')?.props.invalid).toBe(true)
  })

  it.each(['login', 'register', 'resetConfirm'])('passes the exact password for %s', async mode => {
    const login = vi.fn(async () => emptyStatus())
    const register = vi.fn(async () => emptyStatus())
    const confirmReset = vi.fn(async () => emptyStatus())
    const { rerender } = await mountReady({ login, register, confirmReset, requestReset: async () => emptyStatus({ message: 'accepted' }) })
    invoke(field(rerender().tree, 'email'), 'onChange', ' a@example.com ')
    if (mode === 'register') click(rerender().tree, 'needAccount')
    if (mode === 'resetConfirm') {
      click(rerender().tree, 'needReset')
      submit(rerender().tree)
      await flush()
      invoke(field(rerender().tree, 'token'), 'onChange', ' code ')
    }
    const password = ' pass word 1 '
    invoke(field(rerender().tree, 'password'), 'onChange', password)
    if (mode !== 'login') invoke(field(rerender().tree, 'confirm'), 'onChange', password)
    submit(rerender().tree)
    await flush()
    expect(mode === 'login' ? login : mode === 'register' ? register : confirmReset)
      .toHaveBeenCalledWith(mode === 'resetConfirm' ? 'code' : 'a@example.com', password)
  })

  it('sends a letter-only or short existing password and leaves the check to the gateway', async () => {
    const login = vi.fn(async () => emptyStatus({ message: 'invalid_credentials' }))
    const { rerender } = await mountReady({ login })
    invoke(field(rerender().tree, 'email'), 'onChange', 'a@example.com')
    invoke(field(rerender().tree, 'password'), 'onChange', 'onlyletters')
    expect(field(rerender().tree, 'password')?.props.error).toBe('')
    expect(primaryDisabled(rerender().tree)).toBe(false)
    submit(rerender().tree)
    await flush()
    expect(login).toHaveBeenCalledWith('a@example.com', 'onlyletters')
    invoke(field(rerender().tree, 'password'), 'onChange', 'cf1234')
    submit(rerender().tree)
    await flush()
    expect(login).toHaveBeenLastCalledWith('a@example.com', 'cf1234')
  })

  it.each(['register', 'resetConfirm'])('accepts a letter-only new password once the confirmation matches for %s', async mode => {
    const dictionary = dictionaries.zh ?? {}
    const register = vi.fn(async () => emptyStatus({ message: 'invalid_request' }))
    const confirmReset = vi.fn(async () => emptyStatus({ message: 'accepted' }))
    const { view, rerender } = mountAccount(api({
      register,
      confirmReset,
      requestReset: async () => emptyStatus({ message: 'accepted' })
    }), key => dictionary[key] ?? key)
    for (const effect of view.effects) effect()
    await flush()
    if (mode === 'register') click(rerender().tree, dictionary.needAccount ?? '')
    if (mode === 'resetConfirm') {
      click(rerender().tree, dictionary.needReset ?? '')
      invoke(field(rerender().tree, 'email'), 'onChange', 'a@example.com')
      submit(rerender().tree)
      await flush()
      invoke(field(rerender().tree, 'token'), 'onChange', 'code')
    } else {
      invoke(field(rerender().tree, 'email'), 'onChange', 'a@example.com')
    }
    expect(fields(rerender().tree)).toContain('confirm')
    invoke(field(rerender().tree, 'password'), 'onChange', 'onlyletters')
    expect(field(rerender().tree, 'password')?.props.error).toBe('')
    expect(primaryDisabled(rerender().tree)).toBe(true)
    invoke(field(rerender().tree, 'confirm'), 'onChange', 'different')
    invoke(field(rerender().tree, 'confirm'), 'onBlur')
    expect(field(rerender().tree, 'confirm')?.props.error).toBe(dictionary.passwordMismatch)
    submit(rerender().tree)
    await flush()
    expect(register).not.toHaveBeenCalled()
    expect(confirmReset).not.toHaveBeenCalled()
    invoke(field(rerender().tree, 'confirm'), 'onChange', 'onlyletters')
    expect(field(rerender().tree, 'confirm')?.props.error).toBe('')
    expect(primaryDisabled(rerender().tree)).toBe(false)
    submit(rerender().tree)
    await flush()
    if (mode === 'register') {
      expect(register).toHaveBeenCalledWith('a@example.com', 'onlyletters')
      expect(nodes(rerender().tree, node => node.props.role === 'alert').map(node => node.children)).toEqual([[dictionary.invalid_request]])
    } else {
      expect(confirmReset).toHaveBeenCalledWith('code', 'onlyletters')
    }
  })

  it('verifies with the code typed in the app and rejects a pasted link', async () => {
    const verify = vi.fn(async () => emptyStatus({ message: 'accepted' }))
    const { rerender } = await mountReady({ verify })
    click(rerender().tree, 'needAccount')
    click(rerender().tree, 'needVerify')
    const link = 'http://127.0.0.1:8787/v1/auth/verify?token=_vKpIesyKlQTFEDlJ8wdw3BP1cASYOv_6SIfZKlH6qI'
    invoke(field(rerender().tree, 'token'), 'onChange', ` ${link}&extra=1 `)
    expect(field(rerender().tree, 'token')?.props.label).toBe('token')
    expect(field(rerender().tree, 'token')?.props.autoComplete).toBe('one-time-code')
    expect(field(rerender().tree, 'token')?.props.error).toBe('codeExpected')
    expect(primaryDisabled(rerender().tree)).toBe(true)
    submit(rerender().tree)
    await flush()
    expect(verify).not.toHaveBeenCalled()
    invoke(field(rerender().tree, 'token'), 'onChange', ' 123456 ')
    expect(field(rerender().tree, 'token')?.props.error).toBe('')
    submit(rerender().tree)
    await flush()
    expect(verify).toHaveBeenCalledWith('123456')
    expect(screenOf(rerender().tree)).toBe('auth')
  })

  it('shows a rejected code and returns to registration to send another', async () => {
    const dictionary = dictionaries.zh ?? {}
    const verify = vi.fn(async () => emptyStatus({ message: 'code_rejected' }))
    const { view, rerender } = mountAccount(api({ verify }), key => dictionary[key] ?? key)
    for (const effect of view.effects) effect()
    await flush()
    invoke(field(rerender().tree, 'email'), 'onChange', 'a@example.com')
    click(rerender().tree, dictionary.needAccount ?? '')
    click(rerender().tree, dictionary.needVerify ?? '')
    invoke(field(rerender().tree, 'token'), 'onChange', '123456')
    submit(rerender().tree)
    await flush()
    const rejected = rerender().tree
    expect(fields(rejected)).toEqual(['token'])
    expect(nodes(rejected, node => node.props.role === 'alert').map(node => node.children)).toEqual([[dictionary.code_rejected]])
    expect(nodes(rejected, node => node.children.includes(dictionary.unavailable ?? ''))).toHaveLength(0)
    click(rejected, dictionary.resendCode ?? '')
    const again = rerender().tree
    expect(fields(again)).toEqual(['email', 'password', 'confirm'])
    expect(field(again, 'email')?.props.value).toBe('a@example.com')
    expect(field(again, 'password')?.props.value).toBe('')
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('keeps a verification transport failure on the code step', async () => {
    const verify = vi.fn(async () => { throw new Error('offline') })
    const { rerender } = await mountReady({ verify })
    click(rerender().tree, 'needAccount')
    click(rerender().tree, 'needVerify')
    invoke(field(rerender().tree, 'token'), 'onChange', '123456')
    submit(rerender().tree)
    await flush()
    const failed = rerender().tree
    expect(fields(failed)).toEqual(['token'])
    expect(nodes(failed, node => node.props.role === 'alert').map(node => node.children)).toEqual([['unavailable']])
  })

  it('sends another reset code without leaving the code step', async () => {
    const dictionary = dictionaries.zh ?? {}
    const requestReset = vi.fn(async () => emptyStatus({ message: 'accepted' }))
    const confirmReset = vi.fn(async () => emptyStatus({ message: 'accepted' }))
    const { view, rerender } = mountAccount(api({ requestReset, confirmReset }), key => dictionary[key] ?? key)
    for (const effect of view.effects) effect()
    await flush()
    click(rerender().tree, dictionary.needReset ?? '')
    invoke(field(rerender().tree, 'email'), 'onChange', 'a@example.com')
    submit(rerender().tree)
    await flush()
    invoke(field(rerender().tree, 'token'), 'onChange', '123456')
    invoke(field(rerender().tree, 'password'), 'onChange', 'onlyletters')
    invoke(field(rerender().tree, 'confirm'), 'onChange', 'onlyletters')
    click(rerender().tree, dictionary.resendCode ?? '')
    await flush()
    const again = rerender().tree
    expect(requestReset).toHaveBeenCalledTimes(2)
    expect(requestReset).toHaveBeenLastCalledWith('a@example.com')
    expect(confirmReset).not.toHaveBeenCalled()
    expect(fields(again)).toEqual(['token', 'password', 'confirm'])
    expect(field(again, 'token')?.props.value).toBe('')
    expect(field(again, 'password')?.props.value).toBe('onlyletters')
    expect(nodes(again, node => node.props.role === 'status').map(node => node.children)).toEqual([[dictionary.accepted]])
  })

  it('remembers the last email for the next sign-in and registration', async () => {
    const login = vi.fn(async () => emptyStatus({ message: 'invalid_credentials' }))
    const register = vi.fn(async () => emptyStatus({ message: 'accepted' }))
    const first = await mountReady({ login })
    expect(field(first.rerender().tree, 'email')?.props.value).toBe('')
    invoke(field(first.rerender().tree, 'email'), 'onChange', ' User@Example.COM ')
    invoke(field(first.rerender().tree, 'password'), 'onChange', 'onlyletters')
    submit(first.rerender().tree)
    await flush()
    expect(loaded.window.localStorage.getItem('dsh-taichi-account-email')).toBe('user@example.com')
    expect(JSON.stringify(loaded.window.localStorage.getItem('dsh-taichi-account-email'))).not.toContain('onlyletters')
    react.reset()
    const second = await mountReady()
    expect(field(second.rerender().tree, 'email')?.props.value).toBe('user@example.com')
    click(second.rerender().tree, 'needAccount')
    expect(field(second.rerender().tree, 'email')?.props.value).toBe('user@example.com')
    invoke(field(second.rerender().tree, 'email'), 'onChange', 'next@example.com')
    invoke(field(second.rerender().tree, 'password'), 'onChange', 'onlyletters')
    invoke(field(second.rerender().tree, 'confirm'), 'onChange', 'onlyletters')
    second.rerender()
    loaded.window.dshDesktop.account = api({ register })
    submit(second.rerender().tree)
    await flush()
    expect(register).toHaveBeenCalledWith('next@example.com', 'onlyletters')
    expect(loaded.window.localStorage.getItem('dsh-taichi-account-email')).toBe('next@example.com')
    loaded.window.localStorage.setItem('dsh-taichi-account-email', 'not-an-email')
    react.reset()
    const ignored = await mountReady()
    expect(field(ignored.rerender().tree, 'email')?.props.value).toBe('')
  })

  it('sends the email in lowercase', async () => {
    const login = vi.fn(async () => emptyStatus())
    const { rerender } = await mountReady({ login })
    invoke(field(rerender().tree, 'email'), 'onChange', ' User@Example.COM ')
    invoke(field(rerender().tree, 'password'), 'onChange', 'onlyletters')
    submit(rerender().tree)
    await flush()
    expect(login).toHaveBeenCalledWith('user@example.com', 'onlyletters')
  })

  it('explains that a short password such as cf1234 is below the 8 character minimum', async () => {
    const dictionary = dictionaries.zh ?? {}
    const register = vi.fn(async () => emptyStatus({ message: 'invalid_request' }))
    const { view, rerender } = mountAccount(api({ register }), key => dictionary[key] ?? key)
    for (const effect of view.effects) effect()
    await flush()
    click(rerender().tree, dictionary.needAccount ?? '')
    invoke(field(rerender().tree, 'email'), 'onChange', 'a@example.com')
    invoke(field(rerender().tree, 'password'), 'onChange', 'cf1234')
    expect(primaryDisabled(rerender().tree)).toBe(true)
    expect(field(rerender().tree, 'password')?.props.error).toBe(dictionary.passwordLength)
    submit(rerender().tree)
    await flush()
    expect(register).not.toHaveBeenCalled()
    expect(nodes(rerender().tree, node => node.props.role === 'alert')).toHaveLength(0)
  })

  it('keeps the generic request error when a formatted password is rejected', async () => {
    const dictionary = dictionaries.zh ?? {}
    const { view, rerender } = mountAccount(api({
      login: async () => emptyStatus({ message: 'invalid_request' })
    }), key => dictionary[key] ?? key)
    for (const effect of view.effects) effect()
    await flush()
    invoke(field(rerender().tree, 'email'), 'onChange', 'a@example.com')
    invoke(field(rerender().tree, 'password'), 'onChange', 'secret1')
    submit(rerender().tree)
    await flush()
    expect(nodes(rerender().tree, node => node.props.role === 'alert').map(node => node.children)).toEqual([[dictionary.invalid_request]])
  })

  it('awaits restart, blocks duplicate actions and restores controls after failure', async () => {
    let rejectRestart: (error: Error) => void = () => undefined
    const restart = vi.fn(() => new Promise<{ ok: boolean }>((_resolve, reject) => { rejectRestart = reject }))
    const { rerender } = await mountReady({ status: async () => emptyStatus({ needsRestart: true }) })
    loaded.window.dshDesktop.restartHarness = restart
    const notice = () => nodes(rerender().tree, node => (node.type as { name?: string }).name === 'RestartNotice')[0]
    const restartNode = notice()
    if (!restartNode || typeof restartNode.type !== 'function') throw new Error('Missing restart notice')
    const rendered = react.render(restartNode.type as (props: Record<string, unknown>) => unknown, restartNode.props)
    click(rendered.tree, 'restart')
    click(rendered.tree, 'restart')
    expect(restart).toHaveBeenCalledTimes(1)
    expect(notice()?.props.busy).toBe(true)
    rejectRestart(new Error('offline'))
    await flush()
    expect(notice()?.props.busy).toBe(false)
    expect(nodes(rerender().tree, node => node.children.includes('unavailable'))).toHaveLength(1)
  })

  it('ignores pending actions after unmount and keeps a fresh page isolated', async () => {
    let complete: (value: AccountStatus) => void = () => undefined
    const { rerender, onStatus } = await mountReady({ login: () => new Promise(resolve => { complete = resolve }) })
    invoke(field(rerender().tree, 'email'), 'onChange', 'a@example.com')
    invoke(field(rerender().tree, 'password'), 'onChange', 'password')
    submit(rerender().tree)
    onStatus.mockClear()
    react.reset()
    const fresh = await mountReady()
    complete(emptyStatus({ signedIn: true, email: 'stale@example.com' }))
    await flush()
    expect(onStatus).not.toHaveBeenCalled()
    expect(screenOf(fresh.rerender().tree)).toBe('auth')
    const button = react.render(AccountButton, buttonProps)
    expect(nodes(button.tree, node => node.props['data-dsh-taichi-account'] === 'true')[0]?.props['data-signed-in']).toBe('false')
  })

  it('opens the shared Harness restart notice after sign-in and leaves the account page', async () => {
    const events: Array<{ type: string, detail?: { source?: string, restartRequired?: boolean } }> = []
    loaded.window.CustomEvent = class CustomEvent {
      type: string
      detail?: { source?: string, restartRequired?: boolean }
      constructor(type: string, init?: { detail?: { source?: string, restartRequired?: boolean } }) {
        this.type = type
        this.detail = init?.detail
      }
    } as unknown as typeof CustomEvent
    loaded.window.dispatchEvent = ((event: Event) => {
      events.push(event as unknown as { type: string, detail?: { source?: string, restartRequired?: boolean } })
      return true
    }) as typeof window.dispatchEvent
    const login = vi.fn(async () => emptyStatus({ signedIn: true, email: 'a@example.com', needsRestart: true }))
    const { rerender } = await mountReady({ login })
    invoke(field(rerender().tree, 'email'), 'onChange', 'a@example.com')
    invoke(field(rerender().tree, 'password'), 'onChange', 'password')
    loaded.plugin.openAccountDialog()
    submit(rerender().tree)
    await flush()
    expect(events).toEqual([{ type: 'dsh-desktop-restart-required', detail: { source: 'account', restartRequired: true } }])
    expect(loaded.plugin.accountDialogOpen()).toBe(false)
    expect(layout.calls).toEqual([])
    expect(nodes(rerender().tree, node => (node.type as { name?: string }).name === 'RestartNotice')).toHaveLength(0)
  })

  it('restarts Harness automatically after the sign-out confirmation', async () => {
    const restart = vi.fn(async () => ({ ok: true }))
    loaded.window.dshDesktop.restartHarness = restart
    const { rerender } = await mountReady({
      status: async () => emptyStatus({ signedIn: true, email: 'a@example.com' }),
      logout: async () => emptyStatus({ signedIn: false, needsRestart: true, message: 'restart_to_sign_out' })
    })
    click(rerender().tree, 'logout')
    invoke(risk(rerender().tree), 'onAcknowledgedChange', true)
    invoke(risk(rerender().tree), 'onConfirm')
    await flush()
    expect(restart).toHaveBeenCalledTimes(1)
    expect(risk(rerender().tree)?.props.open).toBe(false)
    expect(dictionaries.zh?.logoutDescription).toContain('立即重启 Harness')
  })

  it('keeps a required Harness restart when automatic sign-out restart fails', async () => {
    loaded.window.dshDesktop.restartHarness = async () => ({ ok: false })
    const { rerender } = await mountReady({
      status: async () => emptyStatus({ signedIn: true, email: 'a@example.com' }),
      logout: async () => emptyStatus({ signedIn: false, needsRestart: true, message: 'restart_to_sign_out' })
    })
    click(rerender().tree, 'logout')
    invoke(risk(rerender().tree), 'onAcknowledgedChange', true)
    invoke(risk(rerender().tree), 'onConfirm')
    await flush()
    const tree = rerender().tree
    expect(risk(tree)?.props.open).toBe(false)
    const notice = nodes(tree, node => (node.type as { name?: string }).name === 'RestartNotice')[0]
    expect(notice?.props.kind).toBe('signOut')
    expect(nodes(tree, node => node.children.includes('unavailable'))).toHaveLength(1)
    expect(nodes(tree, node => node.props['data-dsh-account-close'] === 'true')[0]?.props.disabled).toBe(true)
    invoke(nodes(tree, node => node.props['data-dsh-account-close'] === 'true')[0], 'onClick')
    expect(layout.calls).toEqual([])
  })

  it('closes the account dialog when no Harness restart is required', async () => {
    const { rerender } = await mountReady()
    const close = nodes(rerender().tree, node => node.props['data-dsh-account-close'] === 'true')[0]
    expect(close?.props.disabled).toBe(false)
    expect(close?.props['aria-label']).toBe('close')
    loaded.plugin.openAccountDialog()
    invoke(close, 'onClick')
    expect(loaded.plugin.accountDialogOpen()).toBe(false)
    expect(layout.calls).toEqual([])
  })

  it('reports a rejected restart result and allows retry', async () => {
    const { rerender } = await mountReady({ status: async () => emptyStatus({ needsRestart: true }) })
    loaded.window.dshDesktop.restartHarness = async () => ({ ok: false })
    const notice = () => nodes(rerender().tree, node => (node.type as { name?: string }).name === 'RestartNotice')[0]
    await invoke(notice(), 'onRestart')
    expect(notice()?.props.busy).toBe(false)
    expect(nodes(rerender().tree, node => node.children.includes('unavailable'))).toHaveLength(1)
    loaded.window.dshDesktop.restartHarness = async () => ({ ok: true })
    await invoke(notice(), 'onRestart')
    expect(nodes(rerender().tree, node => node.props.role === 'alert')).toHaveLength(0)
  })

  it('does not let a delayed sidebar status replace a newer page result', async () => {
    let complete: (value: AccountStatus) => void = () => undefined
    loaded.window.dshDesktop.account = api({ status: () => new Promise(resolve => { complete = resolve }) })
    const button = react.render(AccountButton, buttonProps)
    for (const effect of button.effects) effect()
    panelInject().onStatus?.(emptyStatus({ signedIn: true, email: 'new@example.com' }))
    complete(emptyStatus())
    await flush()
    const updated = react.render(AccountButton, buttonProps)
    expect(nodes(updated.tree, node => node.props['data-dsh-taichi-account'] === 'true')[0]?.props['data-signed-in']).toBe('true')
  })

  it.each(['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'])('shows partial account failure while staying signed in (%s)', async language => {
    const dictionary = dictionaries[language] ?? {}
    const { view, rerender } = mountAccount(api({
      status: async () => emptyStatus({
        signedIn: true,
        email: 'owner@example.com',
        message: 'profile_unavailable',
        balance: null,
        profile: { models: 'failed', balance: 'failed', images: 'ready', videos: 'ready' }
      })
    }), key => dictionary[key] ?? key)
    for (const effect of view.effects) effect()
    await flush()
    const tree = rerender().tree
    expect(screenOf(tree)).toBe('home')
    expect(fields(tree)).toEqual([])
    expect(dictionary.balanceUnread).toBeTruthy()
    expect(dictionary.modelsUnread).toBeTruthy()
    expect(dictionary.retry).toBeTruthy()
    expect(nodes(tree, node => node.props.role === 'alert')).toHaveLength(0)
    expect(nodes(tree, node => node.children.includes(dictionary.signedIn))).toHaveLength(0)
    expect(nodes(tree, node => node.children.includes(dictionary.modelsEmpty))).toHaveLength(0)
    expect(nodes(tree, node => node.props['data-dsh-account-balance'] === 'true')[0]?.children).toEqual(['—'])
    expect(nodes(tree, node => node.children.includes(dictionary.balanceUnread))).toHaveLength(1)
    expect(nodes(tree, node => node.children.includes(dictionary.modelsUnread))).toHaveLength(1)
    expect(nodes(tree, node => node.children.includes(dictionary.retry))).toHaveLength(1)
    expect(nodes(tree, node => node.children.includes(dictionary.logout))).toHaveLength(1)
  })

})
