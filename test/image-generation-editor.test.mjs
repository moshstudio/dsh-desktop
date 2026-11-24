// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ImageGenPanel } from '../packages/dsh-taichi-image-generation/src/client/ImageGenPanel.tsx'

// The host normally supplies these controls. Keep their native events while
// exercising the real editor, model picker and request state.
vi.mock('@deepseek-ai/dsh-client-store', () => ({}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, disabled, onClick, ...props }) => React.createElement('button', { disabled, onClick, 'aria-label': props['aria-label'] }, children),
  Pill: ({ children, onClick }) => React.createElement('button', { onClick }, children),
  Menu: ({ anchor }) => anchor,
  IconChevronDownOutlineRegular: () => null, IconListPenOutlineRegular: () => null,
  SegmentedControl: () => null, Modal: () => null,
}))
vi.mock('../packages/dsh-taichi-image-generation/src/client/ModuleTabs.tsx', () => ({ ModuleTabs: () => null, alignHistoryToModuleTabs: () => {} }))
vi.mock('../packages/dsh-taichi-image-generation/src/client/InspirationGallery.tsx', () => ({ InspirationGallery: () => null }))

it('keeps normal editor controls and a live request summary around its native disclosure', async () => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const model = 'gpt-image-2'
  const config = {
    channels: [{ id: 'preview', name: 'Preview', apiUrl: 'https://example.test', models: [{ alias: model, id: model }] }],
    defaultChannelId: 'preview', defaultModel: model,
    imageCatalog: [{ id: model, name: model, quality_options: ['1k'], sizes: [{ aspect_ratio: '1:1', quality: '1k', size: '1024x1024' }], output_formats: ['png', 'gif'] }],
  }
  const unsubscribe = () => () => {}
  const scope = { getSnapshot: () => ({ value: config }), subscribe: unsubscribe, getSecretSetSnapshot: () => true, subscribeSecretSets: unsubscribe }
  const api = new Proxy({}, { get: () => async () => [] })
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  try {
    await act(async () => root.render(React.createElement(ImageGenPanel, { api, scope, active: false })))
    const prompt = container.querySelector('aside textarea')
    expect(prompt?.labels[0]?.textContent.trim()).toBeTruthy()
    const aside = prompt.closest('aside')
    const details = aside.querySelector('details')
    const toggle = details.querySelector('summary')
    expect(details.open).toBe(false)
    act(() => toggle.click())
    expect(details.open).toBe(true)
    expect(details.querySelector('[aria-label="清晰度"], [aria-label="Quality"]')).toBeTruthy()
    const format = details.querySelector('[aria-label="输出格式"], [aria-label="Output"]')
    const compare = details.querySelector('input[type="checkbox"]')
    const count = aside.querySelector('[aria-label="生成数量"], [aria-label="Count"]')
    const picker = aside.querySelector('button[aria-label*="gpt-image-2"]')
    const action = [...aside.querySelectorAll('button')].find(button => ['开始生成', 'Generate'].includes(button.textContent.trim()))
    const footer = action.closest('section, footer')
    expect(footer.textContent).toContain(model)
    for (const control of [picker, count, prompt, details]) {
      expect(control).toBeTruthy()
      expect(footer.contains(control)).toBe(false)
    }
    expect(action).toBeTruthy()
    const gif = [...format.querySelectorAll('button')].find(button => /gif/i.test(button.textContent))
    act(() => gif.click())
    expect(compare.disabled).toBe(true)
    expect(count.disabled).toBe(true)
    expect(footer.textContent).toMatch(/gif/i)
    act(() => toggle.click())
    expect(details.open).toBe(false)
    expect(footer.textContent).toMatch(/gif/i)
  } finally {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})