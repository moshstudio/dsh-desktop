// @vitest-environment jsdom
import React, { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { ImageGenController } from '../packages/dsh-taichi-image-generation/src/client/controller.ts'
import { ImageActivityButton } from '../packages/dsh-taichi-image-generation/src/client/activity-entry.tsx'
import { createMarketPanelSeat, MarketActivityButton } from '../packages/taichi-dshmarket/src/client/activity-entry.tsx'
import type { MarketPanelLayout } from '../packages/taichi-dshmarket/src/client/activity-entry.tsx'

const PANEL_ID = 'taichi-dshmarket'

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  if (root) await act(async () => { root?.unmount() })
  container?.remove()
  root = undefined
  container = undefined
})

function createLayout() {
  let activePanelId: string | null = null
  const listeners = new Set<() => void>()
  const layout: MarketPanelLayout = {
    selectPanel(id) {
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

it('keeps only one rail seat selected when switching between market and image', async () => {
  const layout = createLayout()
  const panel = createMarketPanelSeat(() => layout, PANEL_ID)
  panel.attach()
  const image = new ImageGenController()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <div data-dsh-activity-main="">
        <ImageActivityButton controller={image} />
        <MarketActivityButton t={key => key === 'nav' ? '插件市场' : key} panel={panel} />
      </div>
    )
  })
  const buttons = () => [...(container?.querySelectorAll('[data-dsh-activity-main] > button') ?? [])] as HTMLButtonElement[]
  const selected = () => buttons().filter(button => button.getAttribute('data-selected') === 'true')

  await act(async () => { buttons()[0]?.click() })
  expect(image.getSnapshot().panelOpen).toBe(true)
  expect(panel.active()).toBe(false)
  expect(selected()).toHaveLength(1)
  expect(selected()[0]?.getAttribute('aria-label')).toMatch(/图片|Image/)

  await act(async () => { buttons()[1]?.click() })
  expect(image.getSnapshot().panelOpen).toBe(false)
  expect(panel.active()).toBe(true)
  expect(selected()).toHaveLength(1)
  expect(selected()[0]?.getAttribute('aria-label')).toBe('插件市场')

  await act(async () => { buttons()[0]?.click() })
  expect(image.getSnapshot().panelOpen).toBe(true)
  expect(panel.active()).toBe(false)
  expect(selected()).toHaveLength(1)
  expect(selected()[0]?.getAttribute('aria-label')).toMatch(/图片|Image/)
})
