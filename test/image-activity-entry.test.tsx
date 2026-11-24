// @vitest-environment jsdom
import React, { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { ImageGenController } from '../packages/dsh-taichi-image-generation/src/client/controller.ts'
import { ImageActivityButton } from '../packages/dsh-taichi-image-generation/src/client/activity-entry.tsx'

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  if (root) await act(async () => { root?.unmount() })
  container?.remove()
  root = undefined
  container = undefined
})

function mount(controller: ImageGenController, bindTip?: (props: Record<string, unknown>) => Record<string, unknown>) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const slotProps = bindTip === undefined ? {} : { bindTip, component: () => { throw new Error('the slot places the button') } }
  return act(async () => {
    root?.render(
      <div data-dsh-activity-main="">
        <ImageActivityButton controller={controller} {...slotProps} />
      </div>
    )
  })
}

it('places a rail button on the activity slot and opens the studio from it', async () => {
  const controller = new ImageGenController()
  await mount(controller)
  const button = container?.querySelector('[data-dsh-activity-main] > button')
  expect(button?.getAttribute('data-dsh-activity')).toBe('')
  expect(['图片', 'Image']).toContain(button?.getAttribute('aria-label'))
  expect(button?.getAttribute('aria-current')).toBeNull()
  expect(button?.getAttribute('data-selected')).toBe('false')
  expect(button?.querySelector('rect')).not.toBeNull()
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(controller.getSnapshot().panelOpen).toBe(true)
  const current = container?.querySelector('[data-dsh-activity-main] > button')
  expect(current?.getAttribute('aria-current')).toBe('page')
  expect(current?.getAttribute('data-selected')).toBe('true')
  expect(current?.querySelector('path')?.getAttribute('fill-rule')).toBe('evenodd')
  expect(current?.querySelector('rect')).toBeNull()
})

it('closes the studio when Home asks for the conversation', async () => {
  const controller = new ImageGenController()
  controller.open()
  await mount(controller)
  await act(async () => {
    document.dispatchEvent(new Event('dsh-activity-home'))
  })
  expect(controller.getSnapshot().panelOpen).toBe(false)
  expect(container?.querySelector('[data-dsh-activity-main] > button')?.getAttribute('aria-current')).toBeNull()
})

it('keeps the slotted button as the column item when the rail passes its tooltip binder', async () => {
  const controller = new ImageGenController()
  await mount(controller, props => ({ ...props, 'data-tip': 'rail' }))
  const button = container?.querySelector('[data-dsh-activity-main] > button')
  expect(button?.getAttribute('data-tip')).toBe('rail')
  expect(container?.querySelectorAll('button')).toHaveLength(1)
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(controller.getSnapshot().panelOpen).toBe(true)
})

it('asks the rail to expand the sidebar before claiming the studio seat', async () => {
  const controller = new ImageGenController()
  await mount(controller)
  const seen: Array<{ name: string, mode?: string }> = []
  const onHome = () => { seen.push({ name: 'home' }) }
  const onSidebar = (event: Event) => {
    seen.push({ name: 'sidebar', mode: (event as CustomEvent<{ mode?: string }>).detail?.mode })
  }
  document.addEventListener('dsh-activity-home', onHome)
  document.addEventListener('dsh-activity-sidebar', onSidebar)
  try {
    await act(async () => {
      container?.querySelector('[data-dsh-activity-main] > button')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  } finally {
    document.removeEventListener('dsh-activity-home', onHome)
    document.removeEventListener('dsh-activity-sidebar', onSidebar)
  }
  expect(seen).toEqual([{ name: 'home' }, { name: 'sidebar', mode: 'expanded' }])
  expect(controller.getSnapshot().panelOpen).toBe(true)
})
