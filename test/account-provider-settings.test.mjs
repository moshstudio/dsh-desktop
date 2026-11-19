import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const clientPath = require.resolve('@deepseek-ai/dsh-client-ui-settings-models/package.json').replace('package.json', 'lib/client.js')

function loadSettingsModels(sourceText) {
  const source = sourceText.replace(
    'exports.apply = apply;',
    'exports.joinProviderDirectory = joinProviderDirectory; exports.section = Loaded; exports.apply = apply;'
  )
  let api
  const jsx = (type, props) => {
    if (type === undefined) throw new Error('Undefined rendered component')
    return typeof type === 'function' ? type(props) : { type, props }
  }
  const states = []
  let cursor = 0
  const modules = {
    react: {
      useState(initial) {
        const index = cursor++
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
      },
      useId: () => 'add',
      useMemo: fn => fn(),
      useEffect() {},
      useRef(value) {
        const index = cursor++
        if (!(index in states)) states[index] = { current: value }
        return states[index]
      }
    },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    '@deepseek-ai/dsh-client-ui-primitives': {
      IconPlusOutlineRegular: () => ({ type: 'svg', props: {} }),
      Button: props => ({ type: 'button', props }),
      Modal: props => props.open ? { type: 'dialog', props } : null,
      SegmentedControl: () => null
    },
    '@deepseek-ai/dsh-client-store': {}
  }
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load({ factory }) {
    api = factory(id => modules[id])
  } } } })
  if (!api?.joinProviderDirectory || !api.section) throw new Error('settings models exports were not captured')
  return api
}

const entry = (provider, extra = {}) => ({
  provider,
  displayName: extra.displayName ?? provider,
  settingsNs: extra.settingsNs ?? `ns-${provider}`,
  settingsPath: extra.settingsPath ?? [],
  ...extra.declared === undefined ? {} : { declared: extra.declared }
})

it('pins the host account provider ahead of DeepSeek account and official routes', async () => {
  const { joinProviderDirectory } = loadSettingsModels(await readFile(clientPath, 'utf8'))
  const joined = joinProviderDirectory(
    [
      { id: 'openai', name: 'OpenAI' },
      { id: 'deepseek-official', name: 'DeepSeek' },
      { id: 'taichi', name: 'taichi' }
    ],
    [
      entry('deepseek-official', { displayName: 'DeepSeek' }),
      entry('openai', { displayName: 'OpenAI' }),
      entry('deepseek-account', { displayName: 'DeepSeek Account' }),
      entry('anthropic'),
      entry('groq')
    ]
  )
  expect(joined.map(row => row.provider)).toEqual([
    'taichi',
    'deepseek-account',
    'deepseek-official',
    'openai',
    'anthropic',
    'groq'
  ])
})

it('keeps the host account row visible without edit, removal, or a key prompt', async () => {
  const { section } = loadSettingsModels(await readFile(clientPath, 'utf8'))
  const row = (provider, extra = {}) => ({
    entry: {
      provider,
      displayName: provider,
      settingsNs: 'llm-pi-ai',
      settingsPath: provider === 'own' ? ['providers', 'own'] : ['providers', provider],
      active: true,
      declared: true
    },
    configured: true,
    removable: true,
    apiKeyEnv: `${provider.toUpperCase()}_API_KEY`,
    credential: { configured: false, writable: true },
    ...extra
  })
  const snapshot = {
    status: 'ready',
    error: null,
    credentialError: null,
    writable: true,
    rows: [row('own'), row('deepseek-account'), row('taichi')],
    namespaces: new Map([['llm-pi-ai', { schema: {}, value: {}, user: {}, base: {}, revision: 1 }]])
  }
  const tree = section({
    injected: {
      controller: { load() {}, store: { getSnapshot: () => snapshot } },
      useSnapshot: select => select(snapshot),
      operations: {},
      schema: { rehydrate: () => ({}), nodeAtPath: () => undefined, getPath: () => undefined, hasPath: () => false },
      t: key => key
    },
    renderSlot: () => null
  })
  const cards = flatten(tree).filter(node => node.props?.className?.includes('rowCard') || node.props?.className?.includes('setupCard'))
  expect(cards.map(rowName)).toEqual(['own', 'deepSeekAccount', 'taichi'])
  expect(cards.map(card => String(card.props.className).includes('setupCard'))).toEqual([false, false, false])
  expect(labels(cards[0])).toContain('editProvider')
  expect(labels(cards[0])).toContain('removeProvider')
  expect(labels(cards[1])).not.toContain('editProvider')
  expect(labels(cards[1])).not.toContain('removeProvider')
  expect(labels(cards[2])).not.toContain('editProvider')
  expect(labels(cards[2])).not.toContain('removeProvider')
  expect(labels(cards[2])).not.toContain('credentialMissing')
  expect(textOf(cards[2])).not.toContain('customTag')
  expect(textOf(cards[0])).toContain('customTag')
})

function flatten(node) {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(flatten)
  return [node, ...flatten(node.props?.children)]
}

function labels(node) {
  return flatten(node).flatMap(item => {
    const label = item.props?.['aria-label']
    return typeof label === 'string' ? [label] : []
  })
}

function rowName(card) {
  return flatten(card).find(node => String(node.props?.className).includes('rowName'))?.props.children
}

function textOf(node) {
  return flatten(node).flatMap(item => typeof item.props?.children === 'string' ? [item.props.children] : []).join(' ')
}
