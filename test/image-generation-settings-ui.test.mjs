// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

it('opens a drawing panel that bills the mapped model and previews the result', async () => {
  const files = {
    './client.locale.js': await readFile(resolve('packages/dsh-taichi-image-generation/client.locale.js'), 'utf8'),
    './client.style.js': await readFile(resolve('packages/dsh-taichi-image-generation/client.style.js'), 'utf8'),
    './client.panel.js': await readFile(resolve('packages/dsh-taichi-image-generation/client.panel.js'), 'utf8')
  }
  const source = await readFile(resolve('packages/dsh-taichi-image-generation/client.js'), 'utf8')
  const manifest = JSON.parse(await readFile(resolve('packages/dsh-taichi-image-generation/package.json'), 'utf8'))
  expect(manifest.peerDependencies['@deepseek-ai/dsh-client-ui-primitives']).toBe('^0.2.2-rc.1')
  expect(manifest.peerDependencies.react).toBe('^18.2.0')
  expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-primitives')
  expect(manifest.dependencies?.['@deepseek-ai/dsh-client-ui-primitives']).toBeUndefined()
  const require = Object.assign(name => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {
      IconChevronDownOutlineRegular: () => null,
      IconCloseOutlineRegular: () => null,
      IconDownloadOutlineRegular: () => null,
      IconFullscreenOutlineRegular: () => null,
      IconRefreshOutlineRegular: () => null,
      IconSparkleRegular: () => null,
      IconUserOutlineRegular: () => null,
      ImageLightbox: () => null,
      Menu: ({ anchor }) => anchor,
      Tag: ({ children }) => React.createElement('span', null, children),
      TextShimmer: ({ children }) => React.createElement('span', null, children),
      Button: ({ children, variant, size, icon, ...props }) => React.createElement('button', props, icon, children),
      SegmentedControl: ({ label, options, value, onChange }) => React.createElement('div', { role: 'group', 'aria-label': label },
        options.map(option => React.createElement('button', {
          key: option.value,
          type: 'button',
          'aria-pressed': String(option.value === value),
          onClick: () => { if (option.value !== value) onChange(option.value) }
        }, option.label)))
    }
    throw new Error(name)
  }, {
    async: async specifier => {
      let plugin
      new Function('window', files[specifier])({ __ModuleLoader__: { load({ factory }) { plugin = factory(require) } } })
      return plugin
    }
  })
  let plugin
  new Function('window', source)({ __ModuleLoader__: { load({ factory }) { plugin = factory(require) } } })
  const entries = []
  const selectPanel = vi.fn()
  await plugin.apply({
    inject(_services, run) { run({
      locale: { register() {}, bind: () => key => key },
      layout: { selectPanel, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
      uiConversation: { events: { register() {} } },
      slots: {
        inject(_name, register) { register() },
        register(options, Component) { entries.push({ options, Component }) }
      }
    }) }
  })
  const panel = entries.find(item => item.options.key === 'desktop-image')
  const navigation = entries.find(item => item.options.name === 'sidebar.panellist')
  expect(navigation.options).toMatchObject({ id: 'desktop-image', order: 11 })
  expect(entries.some(item => item.options.name === 'sidebar.settings.action')).toBe(false)
  expect(entries.some(item => item.options.key === 'generated-image')).toBe(true)
  const models = { signedIn: true, models: [{
    id: 'gpt-image-2', name: 'GPT Image 2', show_in_picker: true,
    sizes: [{ aspect_ratio: '16:9', quality: '1k', size: '1536x864' }, { aspect_ratio: '16:9', quality: '2k', size: '2048x1152' }],
    quality_map: { '2k': 'gpt-image-2-vip' }
  }] }
  const fetchMock = vi.fn(async (_url, init) => {
    if (!init?.body) return { ok: true, text: async () => JSON.stringify(models) }
    return { ok: true, text: async () => JSON.stringify({ media_type: 'image/png', width: 8, height: 8, b64_json: 'aW1hZ2U=' }) }
  })
  vi.stubGlobal('fetch', fetchMock)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const propsOf = node => node[Object.keys(node).find(name => name.startsWith('__reactProps'))]
  try {
    fetchMock.mockImplementationOnce(async () => ({ ok: true, text: async () => JSON.stringify({ signedIn: false, models: [] }) }))
    await act(async () => root.render(React.createElement(panel.Component, { t: key => key, ...panel.options.inject() })))
    await act(async () => {})
    expect(container.querySelector('[role=status]').textContent).toBe('signIn')
    const signIn = [...container.querySelectorAll('button')].find(button => button.textContent === 'signInAction')
    await act(async () => propsOf(signIn).onClick())
    expect(selectPanel).toHaveBeenCalledExactlyOnceWith('desktop-account')
    await act(async () => root.unmount())
    const signedRoot = createRoot(container)
    try {
      await act(async () => signedRoot.render(React.createElement(panel.Component, { t: key => key, ...panel.options.inject() })))
      await act(async () => {})
      expect(container.querySelector('textarea')).not.toBeNull()
      const quality = [...container.querySelectorAll('[aria-label=quality] button')].find(button => button.textContent === '2k')
      await act(async () => propsOf(quality).onClick())
      const prompt = container.querySelector('textarea')
      await act(async () => propsOf(prompt).onChange({ target: { value: 'a coastline' } }))
      await act(async () => propsOf(container.querySelector('form')).onSubmit({ preventDefault() {} }))
      const sent = fetchMock.mock.calls.at(-1)[1]
      const body = JSON.parse(sent.body)
      expect(body).toEqual({ prompt: 'a coastline', model: 'gpt-image-2-vip', size: '2048x1152' })
      expect(sent.signal).toBeInstanceOf(AbortSignal)
      expect(container.querySelector('img').getAttribute('src')).toContain('data:image/png;base64,aW1hZ2U=')
      let signal
      fetchMock.mockImplementation((_url, init) => {
        if (!init?.body) return Promise.resolve({ ok: true, text: async () => JSON.stringify(models) })
        signal = init.signal
        return new Promise((_resolve, reject) => {
          const fail = () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          }
          if (init?.signal?.aborted) fail()
          else init?.signal?.addEventListener('abort', fail, { once: true })
        })
      })
      await act(async () => { void propsOf(container.querySelector('form')).onSubmit({ preventDefault() {} }) })
      await act(async () => {})
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal.aborted).toBe(false)
      const cancel = [...container.querySelectorAll('button')].find(button => button.textContent === 'cancel')
      await act(async () => propsOf(cancel).onClick())
      await act(async () => {})
      expect(signal.aborted).toBe(true)
      expect(container.querySelector('[role=alert]')).toBeNull()
    } finally {
      await act(async () => signedRoot.unmount())
    }
  } finally {
    container.remove()
    vi.unstubAllGlobals()
  }
})
