import { readFileSync } from 'node:fs'
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
  credits: null,
  profile: { models: 'ready', balance: 'ready' },
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
  const directory = path.join(projectRoot, 'packages', 'dsh-desktop-account')
  const files = ['client.locale.js', 'client.style.js', 'client.form.js', 'client.dialog.js', 'client.js']
  const registrations = new Map<string, {
    id: string
    chunk?: string
    factory: (require: (id: string) => unknown) => Record<string, unknown>
  }>()
  const styles: Array<{ textContent?: string }> = []
  const stored = new Map<string, string>()
  const document = {
    getElementById: vi.fn(() => null),
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
        if (value.id !== 'dsh-desktop-account') throw new Error(`Unexpected account module id: ${value.id}`)
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
  for (const file of files) {
    vm.runInNewContext(readFileSync(path.join(directory, file), 'utf8'), {
      URL,
      document,
      window: sandboxWindow
    })
  }
  const definition = registrations.get('')
  if (!definition) throw new Error('client.js did not register a plugin definition')
  const primitiveNames = ['Button', 'Input', 'Modal', 'RiskConfirmation', 'Tooltip', 'IconChevronLeftOutlineRegular', 'IconInfoOutlineRegular', 'IconUserOutlineRegular']
  const primitives = Object.fromEntries(primitiveNames.map(name => [name, () => null]))
  const require = (id: string): unknown => {
    if (id === 'react') return React
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
      }
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

function fields(tree: unknown): string[] {
  return nodes(tree, node => typeof node.type === 'function').flatMap(node => {
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
    const button = registrations.find(item => item.name === 'sidebar.settings.action' && item.id === 'desktop-account')
    const panel = registrations.find(item => item.name === 'main' && item.key === 'desktop-account')
    if (button === undefined || panel === undefined) throw new Error('account page was not registered')
    AccountButton = button.component
    buttonProps = button.inject()
    AccountPanel = panel.component
    panelInject = panel.inject
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
    ...overrides
  })

  function invoke(node: Node | undefined, event: string, ...args: unknown[]) {
    const handler = node?.props[event]
    if (typeof handler !== 'function') throw new Error(`Missing ${event}`)
    return handler(...args)
  }

  function field(tree: unknown, name: string) {
    return nodes(tree, node => node.props.field === name)[0]
  }

  const click = (tree: unknown, label: string) => invoke(nodes(tree, node => node.children.includes(label))[0], 'onClick')
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
    const css = loaded.styles.map(style => style.textContent ?? '').join('\n')
    expect(css).toContain('[data-dsh-sidebar-settings-actions]{display:flex;flex-direction:row;align-items:center}')
    expect(css).toContain('.dshDeskAccountPanel{box-sizing:border-box;display:flex;flex:1;flex-direction:column;width:100%;height:100%')
    expect(css).toContain('.dshDeskAccountContent{box-sizing:border-box;display:flex;flex-direction:column;flex:1;width:100%;min-width:0')
    expect(css).toContain('.dshDeskAccountContent>:not(.dshDeskAccountBody),.dshDeskAccountStage{box-sizing:border-box;min-width:0;padding-inline:32px}')
    expect(css).toContain('.dshDeskAccountBody{flex:1;min-height:0;margin-top:16px;overflow-y:auto}')
    expect(css).not.toContain('width:min(960px,100%)')
    expect(css).toContain('.dshDeskAccountBack{')
    expect(css).not.toContain('.dshDeskAccountDialog')
    expect(css).not.toContain('width:min(520px,100%)')
  })

  it('keeps account motion short and optional', async () => {
    const css = loaded.styles.map(style => style.textContent ?? '').join('\n')
    expect(css).toContain('@keyframes dshDeskAccountRise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}')
    expect(css).toContain('@keyframes dshDeskAccountFade{from{opacity:0}to{opacity:1}}')
    expect(css).toContain('@keyframes dshDeskAccountPresenceIn{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:none}}')
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion:reduce)'))
    for (const selector of [
      '.dshDeskAccountButton',
      '.dshDeskAccountInfo',
      '.dshDeskAccountBack',
      '.dshDeskAccountReveal',
      '.dshDeskAccountLinks button',
      '.dshDeskAccountInput',
      '.dshDeskAccountTitle',
      '.dshDeskAccountDescription',
      '.dshDeskAccountStage',
      '.dshDeskAccountFieldError',
      '.dshDeskAccountAlert',
      '.dshDeskAccountStatus',
      '.dshDeskAccountNotice',
      '.dshDeskAccountPresence'
    ]) expect(reduced).toContain(selector)
    expect(reduced).toContain('transition:none')
    expect(reduced).toContain('animation:none')

    const { rerender } = await mountReady()
    const stageKey = () => nodes(rerender().tree, node => node.props.className === 'dshDeskAccountStage')[0]?.props.key
    expect(stageKey()).toBe('auth:login')
    expect(nodes(rerender().tree, node => node.props.className === 'dshDeskAccountTitle')[0]?.props.key).toBe('auth:login')
    click(rerender().tree, 'needAccount')
    expect(stageKey()).toBe('auth:register')
    expect(nodes(rerender().tree, node => node.props.className === 'dshDeskAccountDescription')[0]?.props.key).toBe('auth:register')
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
    expect(nodes(home.tree, node => node.props.className === 'dshDeskAccountModelName').map(node => node.children)).toEqual([['demo-chat'], ['long-model']])
    expect(nodes(home.tree, node => node.type === 'article')).toHaveLength(2)
    expect(nodes(home.tree, node => node.children.includes('priceUnavailable'))).toHaveLength(2)
    expect(nodes(home.tree, node => node.children.includes('creditsUnread'))).toHaveLength(1)
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
    expect(nodes(rerender().tree, node => node.props.className === 'dshDeskAccountModelName').map(node => node.children)).toEqual([['Fresh']])
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
    expect(nodes(open, node => node.props.role === 'tab' && node.props['aria-selected'] === 'true').map(node => node.children[0])).toEqual(['models'])
    expect(nodes(open, node => node.type === 'article')).toHaveLength(2)
    expect(nodes(open, node => node.props.className === 'dshDeskAccountRateNow').flatMap(node => node.children)).toEqual(['2,500', '10,000'])
    expect(nodes(open, node => node.props.className === 'dshDeskAccountRateList').flatMap(node => node.children)).toEqual(['14,000', '70,000'])
    expect(nodes(open, node => node.props.className === 'dshDeskAccountSave').flatMap(node => node.children)).toEqual(['priceSave 98%'])
    expect(nodes(open, node => node.props.className === 'dshDeskAccountBill')).toHaveLength(1)
    const cacheText: unknown[] = []
    walk(nodes(open, node => node.props.className === 'dshDeskAccountCache')[0], node => { cacheText.push(...node.children) })
    expect(cacheText).toEqual([
      'cacheReadBrief', ' ', '250', 'perMillion',
      ' · ',
      'cacheWriteBrief', ' ', '3,125', 'perMillionTokens'
    ])
    expect(nodes(open, node => node.props.className === 'dshDeskAccountInfo')).toHaveLength(1)
    expect(nodes(open, node => node.props.label === 'longContext longContextFrom 272,001 tokens inputPrice ×2 outputPrice ×1.5 cachePrice ×2 cacheWritePrice ×2')).toHaveLength(1)
    const noteText: unknown[] = []
    for (const note of nodes(open, node => node.props.className === 'dshDeskAccountPriceNote')) {
      walk(note, node => { noteText.push(...node.children.filter(child => typeof child === 'string')) })
    }
    expect(noteText.join(' ')).not.toContain('longContext')
    expect(noteText).toEqual(expect.arrayContaining([
      'peakPrice', 'weekdayMon', 'weekdayFri', '01:00–04:00', '06:00–10:00'
    ]))
    expect(nodes(open, node => node.children.includes('priceUnavailable'))).toHaveLength(1)
    expect(nodes(open, node => node.props.className === 'dshDeskAccountRateUnit')).toHaveLength(2)
    expect(nodes(open, node => node.type === 'svg')).toHaveLength(1)
    expect(nodes(open, node => node.props.className === 'dshDeskAccountChartTip').flatMap(node => node.children)).toContain('30')
    expect(nodes(open, node => node.props.className === 'dshDeskAccountStatValue').map(node => node.children)).toEqual([['30'], ['700'], ['1']])
    click(open, 'rangeYesterday')
    const yesterday = rerender().tree
    expect(nodes(yesterday, node => node.props.className === 'dshDeskAccountStatValue').map(node => node.children)).toEqual([['0'], ['600'], ['0']])
    expect(nodes(yesterday, node => node.children.includes('chartEmpty'))).toHaveLength(1)
    click(yesterday, 'rangeToday')
    const today = rerender().tree
    expect(nodes(today, node => node.props.className === 'dshDeskAccountStatValue').map(node => node.children)).toEqual([['30'], ['100'], ['1']])
    expect(nodes(today, node => node.type === 'svg')).toHaveLength(1)
    click(today, 'rangeAll')
    const entire = rerender().tree
    expect(nodes(entire, node => node.props.className === 'dshDeskAccountStatValue').map(node => node.children)).toEqual([['30'], ['700'], ['1']])
    expect(nodes(open, node => node.children.includes('−30'))).toHaveLength(0)
    click(entire, 'consumption')
    const usage = rerender().tree
    expect(nodes(usage, node => node.type === 'article')).toHaveLength(0)
    expect(nodes(usage, node => node.children.includes('demo-chat')).length).toBeGreaterThan(0)
    expect(nodes(usage, node => node.children.includes('−30'))).toHaveLength(1)
    click(usage, 'recharge')
    const grants = rerender().tree
    expect(nodes(grants, node => node.children.includes('+100'))).toHaveLength(1)
    expect(nodes(grants, node => node.children.includes('+600'))).toHaveLength(1)
    expect(nodes(grants, node => node.children.includes('kindCheckin'))).toHaveLength(1)
    expect(nodes(grants, node => node.children.includes('kindSignup'))).toHaveLength(1)
    expect(nodes(grants, node => node.props.role === 'tab' && node.props['aria-selected'] === 'true').map(node => node.children[0])).toEqual(['recharge'])
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
    const names = (tree: unknown) => nodes(tree, node => node.props.className === 'dshDeskAccountModelName').map(node => node.children[0])
    const home = rerender().tree
    expect(nodes(home, node => node.props['aria-pressed'] === 'true').map(node => node.children[0])).toContain('sortByVendor')
    expect(nodes(home, node => node.props.className === 'dshDeskAccountVendorName').map(node => node.children[0])).toEqual(['OpenAI', 'Anthropic', 'vendorOther'])
    expect(names(home)).toEqual(['Mini', 'GPT', 'o1', 'Claude', 'Plain'])
    click(home, 'sortByPrice')
    const priced = rerender().tree
    expect(nodes(priced, node => node.props['aria-pressed'] === 'true').map(node => node.children[0])).toContain('sortByPrice')
    expect(nodes(priced, node => node.props.className === 'dshDeskAccountVendorName')).toHaveLength(0)
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
    click(rerender().tree, 'needVerify')
    const tree = rerender().tree
    expect(nodes(tree, node => node.props.role === 'alert')).toHaveLength(0)
    expect(nodes(tree, node => node.children.includes('descVerifyUnknown'))).toHaveLength(1)
  })

  it('keeps unknown credits distinct from zero and uses signed-in empty model copy', async () => {
    const { rerender } = await mountReady({ status: async () => emptyStatus({ signedIn: true, email: 'a@example.com' }) })
    const tree = rerender().tree
    const balance = nodes(tree, node => node.props.className === 'dshDeskAccountBalance')[0]
    expect(balance?.children).toEqual(['—'])
    expect(nodes(tree, node => node.props.className === 'dshDeskAccountCaption')[0]?.children).toEqual(['balanceUnread'])
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
    const caption = nodes(rerender().tree, node => node.props.className === 'dshDeskAccountCaption')[0]
    expect(caption?.children).toEqual(['checked_in'])
    expect(caption?.props.role).toBe('status')
    const checked = nodes(rerender().tree, node => node.children.includes('checkedInDone'))[0]
    expect(checked?.props.disabled).toBe(true)
    expect(nodes(rerender().tree, node => node.props.className === 'dshDeskAccountBalance')[0]?.children).toEqual(['4'])
  })

  it('opens the listed Alipay packages and starts a purchase', async () => {
    const qrImage = 'data:image/png;base64,aaaa'
    const purchase = vi.fn(async () => ({
      ok: true,
      message: '',
      order: { orderId: '11111111-1111-4111-8111-111111111111', yuan: 39, credits: 39000, status: 'pending', qrImage }
    }))
    const { rerender } = await mountReady({
      status: async () => emptyStatus({ signedIn: true, email: 'a@example.com', balance: 4 }),
      purchase
    })
    expect(nodes(rerender().tree, node => node.props['data-yuan'] === '39')).toHaveLength(0)
    click(rerender().tree, 'rechargeAction')
    const packs = nodes(rerender().tree, node => node.props.className === 'dshDeskAccountPack')
    expect(packs.map(node => node.props['data-yuan'])).toEqual(['39', '99', '199', '299'])
    expect(packs.map(node => node.props['data-credits'])).toEqual(['39000', '99000', '199000', '299000'])
    invoke(packs[0], 'onClick')
    await flush()
    expect(purchase).toHaveBeenCalledWith(39)
    const waiting = rerender().tree
    expect(nodes(waiting, node => node.children.includes('rechargeWaiting'))).toHaveLength(1)
    const image = nodes(waiting, node => node.type === 'img' && node.props.className === 'dshDeskAccountQr')[0]
    expect(image?.props.src).toBe(qrImage)
    expect(image?.props.alt).toBe('rechargeScan')
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
        profile: { models: 'failed', balance: 'failed' }
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

  it('opens the account page in the main content area and returns to the previous panel', () => {
    loaded.window.dshDesktop.account = api()
    const button = react.render(AccountButton, buttonProps)
    expect(nodes(button.tree, node => (node.type as { name?: string }).name === 'Modal')).toHaveLength(0)
    for (const effect of button.effects) effect()
    const opener = () => nodes(react.render(AccountButton, buttonProps).tree, node => node.props['data-dsh-desktop-account'] === 'true')[0]
    invoke(opener(), 'onClick')
    expect(layout.calls).toEqual(['desktop-account'])
    expect(opener()?.props['data-selected']).toBe('true')
    expect(opener()?.props['aria-pressed']).toBe('true')
    invoke(opener(), 'onClick')
    expect(layout.calls).toEqual(['desktop-account', null])
    expect(opener()?.props['data-selected']).toBe('false')
    loaded.window.dispatchEvent({ type: 'dsh-desktop-account-open' } as unknown as Event)
    expect(layout.calls).toEqual(['desktop-account', null, 'desktop-account'])
    invoke(opener(), 'onClick')
    layout.active = 'desktop-workbenches'
    invoke(opener(), 'onClick')
    invoke(opener(), 'onClick')
    expect(layout.calls.at(-2)).toBe('desktop-account')
    expect(layout.calls.at(-1)).toBe('desktop-workbenches')
    const page = react.render(AccountPanel, panelInject())
    expect(nodes(page.tree, node => (node.type as { name?: string }).name === 'Modal')).toHaveLength(0)
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

  it('verifies with the token taken from a pasted registration link', async () => {
    const verify = vi.fn(async () => emptyStatus({ message: 'accepted' }))
    const { rerender } = await mountReady({ verify })
    click(rerender().tree, 'needVerify')
    const link = 'http://127.0.0.1:8787/v1/auth/verify?token=_vKpIesyKlQTFEDlJ8wdw3BP1cASYOv_6SIfZKlH6qI'
    invoke(field(rerender().tree, 'token'), 'onChange', ` ${link}&extra=1 `)
    expect(field(rerender().tree, 'token')?.props.label).toBe('verifyLink')
    submit(rerender().tree)
    await flush()
    expect(verify).toHaveBeenCalledWith('_vKpIesyKlQTFEDlJ8wdw3BP1cASYOv_6SIfZKlH6qI')
    expect(screenOf(rerender().tree)).toBe('auth')
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
    expect(loaded.window.localStorage.getItem('dsh-desktop-account-email')).toBe('user@example.com')
    expect(JSON.stringify(loaded.window.localStorage.getItem('dsh-desktop-account-email'))).not.toContain('onlyletters')
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
    expect(loaded.window.localStorage.getItem('dsh-desktop-account-email')).toBe('next@example.com')
    loaded.window.localStorage.setItem('dsh-desktop-account-email', 'not-an-email')
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
    expect(nodes(button.tree, node => node.props['data-dsh-desktop-account'] === 'true')[0]?.props['data-signed-in']).toBe('false')
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
    submit(rerender().tree)
    await flush()
    expect(events).toEqual([{ type: 'dsh-desktop-restart-required', detail: { source: 'account', restartRequired: true } }])
    expect(layout.calls).toEqual([null])
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
    expect(nodes(tree, node => node.props.className === 'dshDeskAccountBack')[0]?.props.disabled).toBe(true)
    invoke(nodes(tree, node => node.props.className === 'dshDeskAccountBack')[0], 'onClick')
    expect(layout.calls).toEqual([])
  })

  it('leaves the account page when no Harness restart is required', async () => {
    const { rerender } = await mountReady()
    const back = nodes(rerender().tree, node => node.props.className === 'dshDeskAccountBack')[0]
    expect(back?.props.disabled).toBe(false)
    expect(back?.props['aria-label']).toBe('back')
    invoke(back, 'onClick')
    expect(layout.calls).toEqual([null])
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
    expect(nodes(updated.tree, node => node.props['data-dsh-desktop-account'] === 'true')[0]?.props['data-signed-in']).toBe('true')
  })

  it.each(['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'])('shows partial account failure while staying signed in (%s)', async language => {
    const dictionary = dictionaries[language] ?? {}
    const { view, rerender } = mountAccount(api({
      status: async () => emptyStatus({
        signedIn: true,
        email: 'owner@example.com',
        message: 'profile_unavailable',
        balance: null,
        profile: { models: 'failed', balance: 'failed' }
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
    expect(nodes(tree, node => node.props.className === 'dshDeskAccountBalance')[0]?.children).toEqual(['—'])
    expect(nodes(tree, node => node.children.includes(dictionary.balanceUnread))).toHaveLength(1)
    expect(nodes(tree, node => node.children.includes(dictionary.modelsUnread))).toHaveLength(1)
    expect(nodes(tree, node => node.children.includes(dictionary.retry))).toHaveLength(1)
    expect(nodes(tree, node => node.children.includes(dictionary.logout))).toHaveLength(1)
  })

})
