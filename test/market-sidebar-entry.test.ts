import { expect, it, vi } from 'vitest'
import { createSidebarEntry } from '../packages/taichi-dshmarket/src/client/sidebar-entry.ts'
import { createSectionGate } from '../packages/taichi-dshmarket/src/client/section-gate.ts'

function setup(fetchImpl: typeof fetch) {
  const registered: boolean[] = []
  const gate = createSectionGate(() => {
    registered.push(true)
    return () => { registered.push(false) }
  }, true)
  const entry = createSidebarEntry({
    gate,
    fetch: fetchImpl,
    hasOtherSeat: () => true,
  })
  return { entry, registered, gate }
}

it('shows the sidebar icon by default before any saved choice', async () => {
  const { entry, registered, gate } = setup(() => Promise.resolve(new Response(
    JSON.stringify({ enabled: true, chosen: false }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )))
  entry.markSupported()
  expect(gate.visible()).toBe(true)
  expect(registered).toEqual([true])
  await entry.load()
  expect(entry.enabled()).toBe(true)
  expect(entry.shown()).toBe(true)
})

it('hides the sidebar icon only after a saved off choice', async () => {
  const { entry, gate } = setup(() => Promise.resolve(new Response(
    JSON.stringify({ enabled: false, chosen: true }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )))
  entry.markSupported()
  expect(gate.visible()).toBe(true)
  await entry.load()
  expect(entry.enabled()).toBe(false)
  expect(entry.shown()).toBe(false)
})

it('keeps the icon visible when the server has no saved answer', async () => {
  const { entry } = setup(() => Promise.resolve(new Response(
    JSON.stringify({ enabled: true, chosen: false }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )))
  entry.markSupported()
  await entry.load()
  expect(entry.shown()).toBe(true)
})

it('survives a failed load without hiding the default icon', async () => {
  const { entry, gate } = setup(() => Promise.reject(new Error('offline')))
  entry.markSupported()
  await entry.load()
  expect(entry.ready()).toBe(true)
  expect(gate.visible()).toBe(true)
  expect(entry.shown()).toBe(true)
})
