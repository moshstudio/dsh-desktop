import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { projectRoot } from './patch-path'

interface SessionTarget {
  kind: 'session'
  value: { sessionId: string; displayTitle: string; unread: boolean; onUnreadChange: (id: string, unread: boolean) => void }
}

function jsx(type: unknown, props: Record<string, unknown>) {
  return { type, props }
}

async function loadBundle<T>(name: string, testExports: string, modules: Record<string, unknown>) {
  const source = await readFile(path.join(projectRoot, 'node_modules/@deepseek-ai', name, 'lib/client.js'), 'utf8')
  const marker = 'exports.apply=apply;'
  if (!source.includes(marker)) throw new Error(`Cannot find factory export in ${name}`)
  let result: T | undefined
  vm.runInNewContext(source.replace(marker, `${marker}${testExports}`), {
    window: { __ModuleLoader__: { load({ factory }: { factory: (id: (name: string) => unknown) => T }) {
      result = factory(id => {
        if (!(id in modules)) throw new Error(`Unexpected module ${id}`)
        return modules[id]
      })
    } } }
  })
  if (result === undefined) throw new Error(`${name} did not load`)
  return result
}

const primitives = { useRowDragPreview: () => ({}), StateDot: Symbol('StateDot'), relativeTime: () => ({ unit: 'now', n: 0 }) }
const react = { useEffect: () => {}, useLayoutEffect: () => {}, useMemo: (fn: () => unknown) => fn(), useRef: (current: unknown) => ({ current }) }
const modules = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx },
  '@deepseek-ai/cordis': { Service: class {} },
  '@deepseek-ai/dsh-client-ui-primitives': primitives,
  '@deepseek-ai/dsh-client-store': { defineStore: (value: unknown) => value }
}

type Gesture = ReturnType<typeof gesture>
type RowProps = { children: ReturnType<typeof jsx>[]; onContextMenu?: (event: Gesture) => void; onKeyDown: (event: Gesture) => void }
const workspace = await loadBundle<{
  createWorkspaceViewStore: () => {
    init: () => { unreadSessionIds: string[] }; persist: string
    actions: Record<'markSessionUnread' | 'markSessionRead', (draft: { unreadSessionIds?: string[] }, id: string) => void>
  }
  SessionNodeItem: (props: Record<string, unknown>) => { props: { anchor: { props: RowProps } } }
  SessionMenu: (props: Record<string, unknown>) => unknown
}>('dsh-client-ui-workspace', 'Object.assign(exports,{createWorkspaceViewStore,SessionNodeItem,SessionMenu});', modules)
const contextMenu = await loadBundle<{
  createContextMenuBindings: (open: (target: SessionTarget, point: { x: number; y: number }) => void, active: () => boolean) => unknown
}>('dsh-client-ui-context-menu', 'exports.createContextMenuBindings=createContextMenuBindings;', modules)

function gesture(key = '', coordinates = { clientX: 42, clientY: 65 }) {
  const currentTarget = { focus: vi.fn(), getBoundingClientRect: () => ({ left: 8, bottom: 23 }) }
  return {
    key, ...coordinates, nativeEvent: {}, target: currentTarget, currentTarget, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true }, stopPropagation: vi.fn()
  }
}

function row(blank: boolean, unread: boolean) {
  const open = vi.fn<(target: SessionTarget, point: { x: number; y: number }) => void>()
  const onOpen = vi.fn()
  const onUnreadChange = vi.fn()
  const renderFactorySlot = vi.fn<(slot: string, props: { target: SessionTarget }) => void>()
  const { props: { anchor: { props } } } = workspace.SessionNodeItem({
    node: { id: 'session-1', title: 'Session title', blank, updatedAt: 1, runningSubagentCount: 0 },
    now: 1, unread, onUnreadChange, onOpen, renderSlot: () => null, renderFactorySlot,
    useContextMenu: () => contextMenu.createContextMenuBindings(open, () => true),
    useContextMenuTarget: () => false, useSessionAccess: () => false, t: (key: string) => key
  })
  return { props, open, onOpen, onUnreadChange, renderFactorySlot }
}

describe('workspace session unread markers', () => {
  it('uses the existing persisted view key and upgrades older snapshots on write', () => {
    const spec = workspace.createWorkspaceViewStore()
    expect(spec.persist).toBe('dsh.workspace.view.v5')
    expect(spec.init().unreadSessionIds).toEqual([])
    const olderSnapshot: { unreadSessionIds?: string[] } = {}
    spec.actions.markSessionUnread(olderSnapshot, 'session-1')
    spec.actions.markSessionUnread(olderSnapshot, 'session-1')
    spec.actions.markSessionUnread(olderSnapshot, 'session-2')
    expect(olderSnapshot.unreadSessionIds).toEqual(['session-1', 'session-2'])
    spec.actions.markSessionRead(olderSnapshot, 'session-1')
    expect(olderSnapshot.unreadSessionIds).toEqual(['session-2'])
  })

  it.each([true, false])('passes unread=%s through right-click, keyboard and the menu button to the legacy menu slot', unread => {
    const { props, open, onOpen, onUnreadChange, renderFactorySlot } = row(false, unread)
    const expected = { kind: 'session', value: { sessionId: 'session-1', displayTitle: 'Session title', unread, onUnreadChange } }
    const event = gesture()
    expect(props.onContextMenu).toBeTypeOf('function')
    props.onContextMenu?.(event)
    expect(open).toHaveBeenNthCalledWith(1, expected, { x: 42, y: 65 })
    expect(event.defaultPrevented).toBe(true)
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    props.onKeyDown(Object.assign(gesture('F10'), { shiftKey: true }))
    expect(open).toHaveBeenNthCalledWith(2, expected, { x: 8, y: 23 })
    expect(renderFactorySlot).toHaveBeenCalledWith('contextMenu.button', expect.objectContaining({ target: expected }))
    const renderSlot = vi.fn<(slot: string, value: SessionTarget['value']) => void>()
    const target = open.mock.calls[0]?.[0]
    workspace.SessionMenu({ target, dismiss: vi.fn(), renderSlot })
    expect(renderSlot).toHaveBeenCalledWith('sidebar.workspaces.session.menu.item', expected.value, expect.anything())
    renderSlot.mock.calls[0]?.[1].onUnreadChange('session-1', !unread)
    expect(onUnreadChange).toHaveBeenCalledWith('session-1', !unread)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('preserves Enter and Space navigation without opening a menu for blank rows', () => {
    const { props, open, onOpen, renderFactorySlot } = row(true, false)
    expect(props.onContextMenu).toBeUndefined()
    props.onKeyDown(gesture('ContextMenu'))
    expect(open).not.toHaveBeenCalled()
    expect(renderFactorySlot).not.toHaveBeenCalled()
    props.onKeyDown(gesture('Enter'))
    props.onKeyDown(gesture(' '))
    expect(onOpen.mock.calls).toEqual([['session-1'], ['session-1']])
  })

  it('renders both visual and screen-reader unread indicators', () => {
    const { props } = row(false, true)
    expect(props.children[0]?.props.children).toMatchObject({ props: { children: [
      { type: primitives.StateDot, props: { state: 'done' } },
      { props: { children: 'status.unread' } }
    ] } })
    expect(props.children[1]?.props.style).toEqual({ fontWeight: 600 })
    expect(row(false, false).props.children[1]?.props.style).toBeUndefined()
  })
})