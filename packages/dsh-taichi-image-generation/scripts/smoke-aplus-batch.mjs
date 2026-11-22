/**
 * A+ batch behaviour that the full studio smoke cannot reach: that sandbox
 * never signs the panel in, so the generate button stays disabled and the
 * click never happens.
 *
 * This mounts the workspace directly, signed in, with one deferred generate
 * call. It checks the three things a shopper hits: a missing product image
 * asks first, the buttons show they are working, and a finished thumb opens
 * the shared preview.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'
import { JSDOM } from 'jsdom'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)

const bundled = await esbuild.build({
  absWorkingDir: root,
  stdin: {
    contents: `
      import { createRoot } from 'react-dom/client'
      import { createElement } from 'react'
      import { AplusWorkspace } from './src/client/AplusWorkspace.tsx'
      export function renderAplus(host, props) {
        const root = createRoot(host)
        root.render(createElement(AplusWorkspace, props))
        return () => root.unmount()
      }
    `,
    resolveDir: root,
    loader: 'tsx',
    sourcefile: 'aplus-batch-entry.tsx',
  },
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  write: false,
  external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
  plugins: [{
    name: 'css-modules',
    setup(build) {
      build.onLoad({ filter: /\.module\.css$/ }, () => ({
        contents: 'module.exports = new Proxy({}, { get: (_target, key) => String(key) })',
        loader: 'js',
      }))
    },
  }],
})

const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { pretendToBeVisual: true })
const { window } = dom
globalThis.window = window
globalThis.document = window.document

const react = require('react')
const reactDom = require('react-dom')
const reactDomClient = require('react-dom/client')
const jsxRuntime = require('react/jsx-runtime')
const primitives = {
  Button: ({ children, onClick, ...rest }) => react.createElement('button', { type: 'button', onClick, ...rest }, children),
  Modal: ({ open, title, children, footer, closeLabel, onClose }) => open === false
    ? null
    : react.createElement('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      react.createElement('h2', null, title),
      children,
      footer ?? null,
      react.createElement('button', { type: 'button', 'aria-label': closeLabel, onClick: onClose }, closeLabel),
    ),
}

const module = { exports: {} }
const runner = new Function('exports', 'require', 'module', 'window', 'document', 'navigator', bundled.outputFiles[0].text)
runner(module.exports, spec => {
  if (spec === 'react') return react
  if (spec === 'react-dom') return reactDom
  if (spec === 'react-dom/client') return reactDomClient
  if (spec === 'react/jsx-runtime') return jsxRuntime
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected require: ${spec}`)
}, module, window, window.document, window.navigator)

let releaseGenerate
const generateGate = new Promise(resolve => { releaseGenerate = resolve })
const calls = []
const previews = []
const historyIds = []
let finished = 0
const api = {
  async generate(request) {
    calls.push(request)
    await generateGate
    finished += 1
    const id = `hist-${finished}`
    return {
      images: [{ mime: 'image/png', b64: 'abc' }],
      history: [{ id, createdAt: finished, prompt: request.prompt, images: [{ url: `/history/${id}`, mime: 'image/png' }] }],
    }
  },
}

const host = window.document.getElementById('host')
module.exports.renderAplus(host, {
  api,
  active: true,
  modelGroups: [{ id: 'default', name: 'Default', models: ['gpt-image-2'] }],
  defaultChannelId: 'default',
  channels: [],
  connected: true,
  onPreview: (images, index) => { previews.push({ images, index }) },
  onHistory: entries => { historyIds.push(entries[0]?.id) },
})

const click = element => {
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
}

await new Promise(resolve => setTimeout(resolve, 30))
const generateAll = host.querySelector('[data-testid="aplus-generate-all"]')
assert.ok(generateAll !== null, 'generate-selected is rendered')
assert.equal(generateAll.disabled, false, 'generate-selected is enabled when a model is signed in')
click(generateAll)
await new Promise(resolve => setTimeout(resolve, 30))
const dialog = window.document.querySelector('[role="dialog"][aria-label="未选择商品图"]')
assert.ok(dialog !== null, 'missing product image asks before the batch starts')
assert.equal(calls.length, 0, 'the warning does not start generation')
const dismiss = [...dialog.querySelectorAll('button')].find(button => button.textContent === '返回选图')
assert.ok(dismiss !== undefined, 'the warning can be dismissed')
click(dismiss)
await new Promise(resolve => setTimeout(resolve, 30))
assert.equal(window.document.querySelector('[role="dialog"][aria-label="未选择商品图"]'), null, 'dismissing the warning closes it')
assert.equal(calls.length, 0, 'dismissing the warning still does not generate')

click(host.querySelector('[data-testid="aplus-generate-all"]'))
await new Promise(resolve => setTimeout(resolve, 30))
const proceed = [...window.document.querySelectorAll('[role="dialog"][aria-label="未选择商品图"] button')]
  .find(button => button.textContent === '仍要生成')
assert.ok(proceed !== undefined, 'the warning can continue without an image')
click(proceed)
await new Promise(resolve => setTimeout(resolve, 30))
const busy = host.querySelector('[data-testid="aplus-generate-all"]')
assert.equal(busy.getAttribute('aria-busy'), 'true', 'the batch button enters a loading state as soon as generation starts')
assert.match(busy.textContent ?? '', /生成中/, 'the batch button label says it is generating')
assert.ok(host.querySelector('[data-module] button[aria-busy="true"]') !== null, 'a module button that is in flight also shows loading')
assert.equal(calls.length > 0, true, 'confirming the warning starts generation')

releaseGenerate()
await new Promise(resolve => setTimeout(resolve, 50))
const preview = host.querySelector('[data-aplus-preview]')
assert.ok(preview !== null, 'a finished module exposes a preview control')
click(preview)
await new Promise(resolve => setTimeout(resolve, 20))
assert.equal(previews.length, 1, 'clicking a finished image opens the preview')
assert.equal(previews[0].index >= 0, true, 'the preview opens on the clicked module')
assert.equal(previews[0].images.length > 0, true, 'the preview receives the finished image')
assert.equal(historyIds.length, calls.length, 'each finished module publishes the history snapshot')
assert.equal(new Set(historyIds).size, calls.length, 'each snapshot is the entry just stored')

// A picked product image has to leave with the next generate call. The
// thumbnail alone is not evidence: the model only keeps that product when the
// request carries the bytes and the prompt names them.
globalThis.FileReader = window.FileReader
const productInput = host.querySelector('input[type="file"][accept="image/*"]')
assert.ok(productInput !== null, 'the product picker is available after a text-only batch')
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
Object.defineProperty(productInput, 'files', {
  configurable: true,
  value: [new window.File([png], 'sku.png', { type: 'image/png' })],
})
productInput.dispatchEvent(new window.Event('change', { bubbles: true }))
const productReady = async () => {
  const started = Date.now()
  while (Date.now() - started < 2000) {
    if (host.querySelector('button[aria-label="移除商品图"]') !== null) return true
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  return false
}
assert.equal(await productReady(), true, 'selecting a product image shows it on the form')
const beforeProduct = calls.length
const regenerate = [...host.querySelectorAll('[data-module] button')].find(button => (button.textContent ?? '').includes('重新生成'))
assert.ok(regenerate !== undefined, 'a finished module can be generated again with the product image')
click(regenerate)
const productSent = async () => {
  const started = Date.now()
  while (Date.now() - started < 2000) {
    if (calls.length > beforeProduct) return true
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  return false
}
assert.equal(await productSent(), true, 'regenerating after a pick sends another request')
const withProduct = calls.at(-1)
assert.equal(withProduct.mode, 'edit', 'a picked product image switches the module to edit mode')
assert.equal(typeof withProduct.image, 'string', 'the product image is a field on the generate request')
assert.match(withProduct.image, /^data:image\/png;base64,/, 'the product image travels as the picked file bytes')
assert.match(withProduct.prompt, /sku\.png/, 'the prompt names the picked product file')
assert.match(withProduct.prompt, /必须保留该商品/, 'the prompt tells the model to keep that product')
assert.equal(withProduct.refName, 'sku.png', 'history keeps the product file name')

console.log('aplus batch: confirm, loading, preview, and product reference passed')
