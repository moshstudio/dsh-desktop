/** Real Host/auth/client composition smoke with a local provider, no billable generation.
 * node scripts/verify/verify-image-generation.mjs [--keep]
 * --keep writes a private browser launch URL under the printed temporary directory.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { imagePreviewFixture } from './image-preview-fixture.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const home = await mkdtemp(path.join(tmpdir(), 'dsh-image-host-'))
const preview = await imagePreviewFixture(home)
const calls = []
const mock = createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk
  calls.push({ method: request.method, path: request.url, auth: request.headers.authorization })
  const allowed = request.headers.authorization === 'Bearer smoke-image-token'
  response.writeHead(allowed ? 200 : 401, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(allowed && request.url === '/v1/images/models'
    ? { object: 'list', data: [{ id: 'gpt-image-2', name: 'GPT Image 2', show_in_picker: true, credits: 150, sizes: [] }] }
    : { error: { message: 'unauthorized', type: 'authentication_error', code: 'unauthorized' } }))
})
await new Promise((resolve, reject) => { mock.once('error', reject); mock.listen(0, '127.0.0.1', resolve) })
const mockBase = `http://127.0.0.1:${mock.address().port}`
const portServer = createServer()
await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve))
const port = portServer.address().port
await new Promise(resolve => portServer.close(resolve))
const base = `http://127.0.0.1:${port}`
const node = process.env.IMAGE_SMOKE_NODE || process.execPath
const bin = process.env.IMAGE_SMOKE_DSH || path.join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const patch = process.env.IMAGE_SMOKE_PATCH || path.join(root, 'build/dsh-desktop.patch.yml')
const child = spawn(node, [bin, 'web', '--patch', patch, '--no-open', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: root, env: { ...process.env, DSH_HOME: home, NO_COLOR: '1', DSH_TELEMETRY_DISABLED: '1', TAICHI_GATEWAY_URL: mockBase, TAICHI_GATEWAY_ACCESS_TOKEN: 'smoke-image-token' }, stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''; let cleaned = false
async function cleanup() {
  if (cleaned) return; cleaned = true
  child.kill('SIGTERM'); mock.closeAllConnections(); mock.close()
  await rm(home, { recursive: true, force: true })
}
process.on('SIGINT', () => { void cleanup().then(() => process.exit(0)) })
process.on('SIGTERM', () => { void cleanup().then(() => process.exit(0)) })
try {
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Host startup timed out')), 60_000)
    const scan = buffer => {
      output += buffer.toString()
      const match = /dsh web:\s*(\S+)/.exec(output)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    }
    child.stdout.on('data', scan); child.stderr.on('data', scan)
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Host exited ${code}`)) })
  })
  const exchange = await fetch(url, { redirect: 'manual' })
  const cookie = exchange.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.ok(cookie)
  const previewPath = `preview?session=${preview.sessionId}&asset=${preview.image.sha256}`
  assert.equal((await fetch(`${base}/api/taichi-image.${previewPath}`)).status, 401)
  const imageResponse = await fetch(`${base}/api/taichi-image.${previewPath}`, { headers: { Cookie: cookie } })
  assert.equal(imageResponse.status, 200)
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), preview.png)
  const models = await fetch(`${base}/api/taichi-image.models`, { headers: { Cookie: cookie } })
  assert.equal(models.status, 200)
  assert.equal(models.headers.get('cache-control'), 'no-store')
  const catalog = await models.json()
  assert.equal(catalog.signedIn, true)
  assert.equal(catalog.models[0].id, 'gpt-image-2')
  assert.equal(JSON.stringify(catalog).includes('smoke-image-token'), false)
  assert.equal(calls.length, 1)
  const page = await (await fetch(base, { headers: { Cookie: cookie } })).text()
  assert.ok(page.includes('dsh-taichi-image-generation'), 'Image client entry must be present in the composed page')
  assert.ok(!/taichi-image.*(?:failed|Error)/i.test(output), 'Image plugin must load successfully')
  console.log('PASS: Host composition, authentication, signed-in model list without token echo, and authenticated historical PNG preview.')
  if (process.argv.includes('--keep')) {
    await writeFile(path.join(home, 'browser-url.txt'), url, { mode: 0o600 })
    await writeFile(path.join(home, 'smoke-context.json'), JSON.stringify({ base, mockBase, sessionId: preview.sessionId }), { mode: 0o600 })
    console.log(`Browser fixture ready: ${home}`)
    await new Promise(() => {})
  }
} catch (error) {
  console.error(error)
  console.error(output.replace(/([?&]token=)[^\s"']+/g, '$1[REDACTED]'))
  process.exitCode = 1
} finally { await cleanup() }
