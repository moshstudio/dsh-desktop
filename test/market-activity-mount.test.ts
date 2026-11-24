// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Menu: () => null,
  DisclosureRow: () => null,
  Tooltip: () => null,
  Toast: () => null,
}))

import { apply } from '../packages/taichi-dshmarket/src/client/index.ts'

interface Registration { name?: unknown; key?: unknown; id?: unknown }

const waiting = new Map<string, Array<() => unknown>>()
const declared = new Set<string>()
const registered: Registration[] = []

function slots() {
  return {
    inject(name: string, callback: () => unknown) {
      if (declared.has(name)) callback()
      else {
        const queued = waiting.get(name) ?? []
        queued.push(callback)
        waiting.set(name, queued)
      }
    },
    register(meta: Registration) {
      if (!declared.has(String(meta.name))) {
        throw new Error(`slot "${String(meta.name)}" is not declared (a parent entry's children table must declare it)`)
      }
      registered.push(meta)
      return () => {}
    },
  }
}

function declare(name: string) {
  declared.add(name)
  const queued = waiting.get(name) ?? []
  waiting.delete(name)
  for (const callback of queued) callback()
}

afterEach(() => {
  declared.clear()
  waiting.clear()
  registered.splice(0)
  vi.restoreAllMocks()
})

it('mounts when main is not declared yet, then registers the market page once it is', () => {
  const errors: unknown[] = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args[0]) })
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
  apply({
    effect: (callback: () => unknown) => { callback() },
    on: () => () => {},
    locale: {
      register: () => undefined,
      bind: () => (key: string) => key,
      subscribe: () => () => {},
      getSnapshot: () => ({ active: 'zh' }),
    },
    slots: slots(),
    theme: { getTheme: () => null, setTheme: () => {} },
    inject: () => {},
  } as never)
  expect(errors.join('\n')).not.toContain('mounting failed')
  expect(registered.some(entry => entry.name === 'main')).toBe(false)
  declare('main')
  expect(registered).toContainEqual(expect.objectContaining({ name: 'main', key: 'taichi-dshmarket' }))
})

it('registers the activity-rail icon and never the old sidebar.panellist row', async () => {
  const errors: unknown[] = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args[0]) })
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(
    JSON.stringify({ enabled: true, chosen: false }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )))
  apply({
    effect: (callback: () => unknown) => { callback() },
    on: () => () => {},
    locale: {
      register: () => undefined,
      bind: () => (key: string) => key,
      subscribe: () => () => {},
      getSnapshot: () => ({ active: 'zh' }),
    },
    slots: slots(),
    theme: { getTheme: () => null, setTheme: () => {} },
    inject: () => {},
  } as never)
  declare('main')
  declare('shell.activity.main')
  await Promise.resolve()
  expect(errors.join('\n')).not.toContain('mounting failed')
  expect(registered).toContainEqual(expect.objectContaining({
    name: 'shell.activity.main',
    id: 'taichi-dshmarket',
  }))
  expect(registered.some(entry => entry.name === 'sidebar.panellist')).toBe(false)
})
