import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-taichi-imagegen-components-'))

const features = ['image', 'video', 'canvas', 'gallery', 'templates', 'skills', 'ppt', 'ecommerce', 'outfit', 'prompt', 'storage', 'diagnostics']
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const ctx = new Context()
const active = new Set()
const mounted = new Set()
ctx.provide('webServer', { register(route) { assert(!active.has(route.path)); active.add(route.path); return () => active.delete(route.path) } })
ctx.provide('taichiImagegenComponents', { mount(feature, child) { child.effect(() => { mounted.add(feature); return () => mounted.delete(feature) }) } })
const routes = features.map(feature => ({ path: '/api/dsh-taichi-imagegen/' + ({ image: 'tasks/list', prompt: 'prompt-enhance', skills: 'canvas/skills/list', ecommerce: 'listing-copy' }[feature] ?? feature + '/list'), method: 'GET', handler() {} }))
ctx.provide('taichiImagegenRoutes', { routes })
const fibers = new Map()
for (const feature of features) {
  assert(patch.includes('id: taichi-imagegen-' + feature))
  const plugin = await import('dsh-taichi-image-generation/' + feature)
  assert.equal(plugin.name, 'taichi-imagegen-' + feature)
  assert.notEqual(plugin.name, 'imagegen-' + feature)
  assert(!plugin.name.startsWith('imagegen-'))
  assert(manifest.exports['./' + feature])
  fibers.set(feature, ctx.plugin(plugin))
}
await new Promise(resolve => setImmediate(resolve))
assert.equal(active.size, features.length)
assert.equal(mounted.size, features.length)
await fibers.get('video').dispose()
assert.equal(active.size, features.length - 1)
assert(!mounted.has('video'))
assert(active.has('/api/dsh-taichi-imagegen/tasks/list'))
fibers.set('video', ctx.plugin(await import('dsh-taichi-image-generation/video')))
await new Promise(resolve => setImmediate(resolve))
assert.equal(active.size, features.length)
for (const fiber of fibers.values()) await fiber.dispose()
assert.equal(active.size, 0)
assert.equal(mounted.size, 0)
console.log('PASS: 12 real Cordis components mount, unload independently, remount and clean up')

// A feature row must activate while the root services are still absent.
// Desktop fails startup when a required loader row is left pending.
const early = new Context()
early.provide('webServer', { register() { return () => {} } })
const earlyImage = early.plugin(await import('dsh-taichi-image-generation/image'))
await new Promise(resolve => setImmediate(resolve))
assert.equal(earlyImage.state, 2)
await earlyImage.dispose()
console.log('PASS: feature entry activates before imagegen services exist')

// Exercise the actual root composition and tool registrations, not only route fixtures.
const core = await import('../lib/index.js')
const host = new Context()
const registeredRoutes = new Set()
const tools = new Set()
const commands = new Set()
const register = set => value => { const key = value.name ?? value.path; assert(!set.has(key)); set.add(key); return () => set.delete(key) }
host.provide('webServer', { register: register(registeredRoutes) })
host.provide('systemPrompt', { section: () => () => {} })
host.provide('commands', { register: register(commands) })
host.provide('tools', { register: register(tools) })
host.provide('attachments', {})
host.provide('settings', { installSection() {}, describe() {} })
const root = host.plugin(core, { enabled: false })
const children = new Map()
for (const feature of features) children.set(feature, host.plugin(await import('dsh-taichi-image-generation/' + feature)))
await new Promise(resolve => setImmediate(resolve))
assert(registeredRoutes.has('/api/dsh-taichi-imagegen/generate'))
assert(registeredRoutes.has('/api/dsh-taichi-imagegen/video/generate'))
assert(!registeredRoutes.has('/api/dsh-imagegen/generate'))
assert.equal(core.name, 'taichi-imagegen')
assert.notEqual(core.name, 'imagegen')
assert(tools.has('taichi_generate_image'))
assert(tools.has('taichi_generate_video'))
assert(!tools.has('generate_image'))
assert(!tools.has('generate_video'))
assert(commands.has('taichi_edit_image'))
assert(!commands.has('edit_image'))
await children.get('video').dispose()
assert(!registeredRoutes.has('/api/dsh-taichi-imagegen/video/generate'))
assert(!tools.has('taichi_generate_video'))
assert(tools.has('taichi_generate_image'))
await root.dispose()
await new Promise(resolve => setImmediate(resolve))
assert.equal(registeredRoutes.size, 0)
assert.equal(tools.size, 0)
assert.equal(commands.size, 0)
for (const child of children.values()) await child.dispose()
console.log('PASS: actual root composition owns all endpoints; video tools unload independently; core removal suspends dependents')

// A model refresh can settle after its fiber was replaced. The stale callback
// must not read that fiber's services; doing so crashes host startup.
const reads = []
const generations = []
const releases = []
let applying = false
const PromiseAll = Promise.all.bind(Promise)
Promise.all = (values) => {
  const tracked = PromiseAll(values)
  if (!applying) return tracked
  let release = () => {}
  const gate = new Promise(resolve => { release = resolve })
  releases.push(release)
  const originalThen = tracked.then.bind(tracked)
  tracked.then = (onFulfilled, onRejected) => originalThen(
    typeof onFulfilled === 'function' ? (value) => gate.then(() => onFulfilled(value)) : onFulfilled,
    onRejected,
  )
  return tracked
}
const wrapped = {
  ...core,
  apply(ctx, config) {
    const generation = generations.length + 1
    generations.push(generation)
    applying = true
    try {
      return core.apply(new Proxy(ctx, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver)
          return property === 'systemPrompt'
            ? new Proxy(value, { get: (service, key) => key === 'section' ? (...args) => (reads.push(generation), service.section(...args)) : Reflect.get(service, key, service) })
            : typeof value === 'function' ? value.bind(target) : value
        },
      }), config)
    } finally {
      applying = false
    }
  },
}
const reloaded = new Context()
reloaded.provide('webServer', { register: () => () => {} })
reloaded.provide('systemPrompt', { section() { return () => {} } })
reloaded.provide('commands', { register: () => () => {} })
reloaded.provide('tools', { register: () => () => {} })
reloaded.provide('attachments', {})
reloaded.provide('settings', { installSection() {}, describe() {} })
try {
  const first = reloaded.plugin(wrapped, { enabled: true, announceToAgent: true })
  await new Promise(resolve => setImmediate(resolve))
  releases[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(reads, [1, 1])
  await first.dispose()
  const replacement = reloaded.plugin(wrapped, { enabled: true, announceToAgent: true })
  await new Promise(resolve => setImmediate(resolve))
  releases[1]()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(reads, [1, 1, 2, 2])
  await replacement.dispose()
} finally {
  Promise.all = PromiseAll
}
console.log('PASS: a model refresh settling on a disposed fiber does not read its services')
