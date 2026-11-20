// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { ModelPicker } from '../packages/dsh-taichi-image-generation/src/client/ModelPicker.tsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const labels = {
  channelLabel: '渠道',
  modelLabel: '模型',
  emptyLabel: '请先配置图像模型',
  channelPlaceholder: '默认渠道',
  ariaLabel: '图像模型',
}

let root
let container

afterEach(async () => {
  if (root !== undefined) await act(async () => { root.unmount() })
  container?.remove()
  root = undefined
  container = undefined
  document.body.replaceChildren()
})

async function renderPicker(props) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(ModelPicker, { ...labels, ...props }))
  })
}

function trigger() {
  const button = document.querySelector('button[aria-haspopup="menu"]')
  if (!(button instanceof HTMLButtonElement)) throw new Error('model picker trigger missing')
  return button
}

function menus() {
  return [...document.querySelectorAll('[data-model-picker-menu]')]
}

function itemLabels(scope = document) {
  return [...scope.querySelectorAll('[role="menuitemradio"]')].map(node => node.textContent)
}

async function openPicker() {
  await act(async () => { trigger().click() })
}

it('opens a single channel straight onto its models with the channel name on top', async () => {
  const onChange = []
  await renderPicker({
    groups: [{ id: 'taichi', name: '太极', models: ['flux', 'sdxl'] }],
    value: { channelId: 'taichi', model: 'flux' },
    onChange: value => { onChange.push(value) },
  })

  await openPicker()

  expect(menus()).toHaveLength(1)
  expect(menus()[0]?.getAttribute('data-model-picker-layout')).toBe('models')
  const title = document.querySelector('[data-model-picker-channel]')
  expect(title?.textContent).toBe('太极')
  expect(itemLabels()).toEqual(['flux', 'sdxl'])
  expect(title?.compareDocumentPosition(document.querySelector('[role="menuitemradio"]')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(document.body.textContent?.includes('渠道')).toBe(false)

  await act(async () => {
    document.querySelectorAll('[role="menuitemradio"]')[1]?.click()
  })
  expect(onChange).toEqual([{ channelId: 'taichi', model: 'sdxl' }])
  expect(menus()).toHaveLength(0)
})

it('uses the channel placeholder when the only channel has no name', async () => {
  await renderPicker({
    groups: [{ id: '', name: '  ', models: [] }],
    value: { channelId: '', model: '' },
    onChange: () => {},
  })

  await openPicker()

  expect(document.querySelector('[data-model-picker-channel]')?.textContent).toBe('默认渠道')
  expect(itemLabels()).toEqual([])
  expect(document.body.textContent?.includes('请先配置图像模型')).toBe(true)
})

it('keeps the channel column when more than one channel is configured', async () => {
  const onChange = []
  await renderPicker({
    groups: [
      { id: 'a', name: '渠道甲', models: ['甲一', '甲二'] },
      { id: 'b', name: '渠道乙', models: ['乙一'] },
    ],
    value: { channelId: 'a', model: '甲一' },
    onChange: value => { onChange.push(value) },
  })

  await openPicker()

  expect(menus()).toHaveLength(1)
  expect(menus()[0]?.getAttribute('data-model-picker-layout')).toBe('channels')
  expect(itemLabels()).toEqual(['渠道甲', '渠道乙'])
  expect(document.querySelector('[data-model-picker-channel]')).toBeNull()

  await act(async () => {
    document.querySelectorAll('[role="menuitemradio"]')[1]?.click()
  })

  expect(menus()).toHaveLength(2)
  expect(itemLabels(menus()[1])).toEqual(['乙一'])

  await act(async () => {
    menus()[1]?.querySelector('[role="menuitemradio"]')?.click()
  })
  expect(onChange).toEqual([{ channelId: 'b', model: '乙一' }])
  expect(menus()).toHaveLength(0)
})
