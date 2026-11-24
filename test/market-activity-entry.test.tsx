// @vitest-environment jsdom
import React, { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import {
  createMarketPanelSeat,
  MarketActivityButton,
  requestActivitySidebar,
} from '../packages/taichi-dshmarket/src/client/activity-entry.tsx'
import type { MarketPanelLayout, MarketPanelSeat } from '../packages/taichi-dshmarket/src/client/activity-entry.tsx'

const PANEL_ID = 'taichi-dshmarket'

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  if (root) await act(async () => { root?.unmount() })
  container?.remove()
  root = undefined
  container = undefined
})

function createLayout(initial: string | null = null) {
  let activePanelId: string | null = initial
  const listeners = new Set<() => void>()
  const selected: Array<string | null> = []
  const layout: MarketPanelLayout & { selected: Array<string | null> } = {
    selected,
    selectPanel(id) {
      selected.push(id)
      activePanelId = id
      for (const listener of listeners) listener()
    },
    panelInfo: {
      getSnapshot: () => ({ activePanelId }),
      subscribe(listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
  }
  return layout
}

function mount(panel: MarketPanelSeat, bindTip?: (props: Record<string, unknown>) => Record<string, unknown>) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const slotProps = bindTip === undefined ? {} : { bindTip, component: () => { throw new Error('the slot places the button') } }
  return act(async () => {
    root?.render(
      <div data-dsh-activity-main="">
        <MarketActivityButton t={key => key === 'nav' ? '插件市场' : key} panel={panel} {...slotProps} />
      </div>
    )
  })
}

it('asks the rail to hide the sidebar instead of toggling it itself', () => {
  const seen: string[] = []
  const onSidebar = (event: Event) => {
    seen.push((event as CustomEvent<{ mode?: string }>).detail?.mode ?? '')
  }
  document.addEventListener('dsh-activity-sidebar', onSidebar)
  try {
    requestActivitySidebar('hidden')
  } finally {
    document.removeEventListener('dsh-activity-sidebar', onSidebar)
  }
  expect(seen).toEqual(['hidden'])
})

it('places a rail button that opens the market panel', async () => {
  const layout = createLayout()
  const panel = createMarketPanelSeat(() => layout, PANEL_ID)
  panel.attach()
  await mount(panel)
  const button = container?.querySelector('[data-dsh-activity-main] > button')
  expect(button?.getAttribute('data-dsh-activity')).toBe('')
  expect(button?.getAttribute('aria-label')).toBe('插件市场')
  expect(button?.getAttribute('aria-current')).toBeNull()
  expect(button?.getAttribute('data-selected')).toBe('false')
  expect(button?.querySelector('svg')).not.toBeNull()
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  // Opening announces home first (a no-op while closed), then selects the panel.
  expect(layout.selected).toEqual([PANEL_ID])
  const current = container?.querySelector('[data-dsh-activity-main] > button')
  expect(current?.getAttribute('aria-current')).toBe('page')
  expect(current?.getAttribute('data-selected')).toBe('true')
})

it('clears other rail pages before claiming the market seat', async () => {
  const layout = createLayout()
  const panel = createMarketPanelSeat(() => layout, PANEL_ID)
  panel.attach()
  await mount(panel)
  const seen: string[] = []
  const onHome = () => { seen.push('home') }
  document.addEventListener('dsh-activity-home', onHome)
  try {
    await act(async () => {
      container?.querySelector('[data-dsh-activity-main] > button')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  } finally {
    document.removeEventListener('dsh-activity-home', onHome)
  }
  expect(seen).toEqual(['home'])
  expect(layout.selected).toEqual([PANEL_ID])
})

it('asks the rail to hide the conversation sidebar when opening the market page', async () => {
  const layout = createLayout()
  const panel = createMarketPanelSeat(() => layout, PANEL_ID)
  panel.attach()
  await mount(panel)
  const seen: string[] = []
  const onSidebar = (event: Event) => {
    seen.push((event as CustomEvent<{ mode?: string }>).detail?.mode ?? '')
  }
  document.addEventListener('dsh-activity-sidebar', onSidebar)
  try {
    await act(async () => {
      container?.querySelector('[data-dsh-activity-main] > button')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  } finally {
    document.removeEventListener('dsh-activity-sidebar', onSidebar)
  }
  expect(seen).toEqual(['hidden'])
  expect(layout.selected).toEqual([PANEL_ID])
  expect(document.documentElement.getAttribute('data-taichi-dshmarket-page')).toBe('')
})

it('leaves the market when Home asks for the conversation', async () => {
  const layout = createLayout(PANEL_ID)
  const panel = createMarketPanelSeat(() => layout, PANEL_ID)
  panel.attach()
  await mount(panel)
  expect(container?.querySelector('[data-dsh-activity-main] > button')?.getAttribute('aria-current')).toBe('page')
  await act(async () => {
    document.dispatchEvent(new Event('dsh-activity-home'))
  })
  expect(layout.selected).toEqual([null])
  expect(container?.querySelector('[data-dsh-activity-main] > button')?.getAttribute('aria-current')).toBeNull()
})

it('does not clear another rail page when Home is announced', async () => {
  const layout = createLayout('taichi-image')
  const panel = createMarketPanelSeat(() => layout, PANEL_ID)
  panel.attach()
  await mount(panel)
  await act(async () => {
    document.dispatchEvent(new Event('dsh-activity-home'))
  })
  expect(layout.selected).toEqual([])
  expect(container?.querySelector('[data-dsh-activity-main] > button')?.getAttribute('data-selected')).toBe('false')
})

it('opens once the layout service arrives after the button is mounted', async () => {
  let layout: ReturnType<typeof createLayout> | undefined
  const panel = createMarketPanelSeat(() => layout, PANEL_ID)
  await mount(panel)
  const button = container?.querySelector('[data-dsh-activity-main] > button')
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(button?.getAttribute('data-selected')).toBe('false')
  layout = createLayout()
  await act(async () => { panel.attach() })
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(layout.selected).toEqual([PANEL_ID])
  expect(container?.querySelector('[data-dsh-activity-main] > button')?.getAttribute('aria-current')).toBe('page')
})

it('keeps the slotted button as the column item when the rail passes its tooltip binder', async () => {
  const layout = createLayout()
  const panel = createMarketPanelSeat(() => layout, PANEL_ID)
  panel.attach()
  await mount(panel, props => ({ ...props, 'data-tip': 'rail' }))
  const button = container?.querySelector('[data-dsh-activity-main] > button')
  expect(button?.getAttribute('data-tip')).toBe('rail')
  expect(container?.querySelectorAll('button')).toHaveLength(1)
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(layout.selected).toEqual([PANEL_ID])
})
