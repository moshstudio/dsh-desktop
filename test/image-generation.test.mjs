import { createServer } from 'node:http'
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as nativeExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import sharp from 'sharp'
import { apply, CONFIGURED_IMAGE_PROMPT, IMAGE_PROMPT_SECTION, imageTool, UNCONFIGURED_IMAGE_PROMPT } from '../packages/dsh-taichi-image-generation/index.js'
import { previewImage } from '../packages/dsh-taichi-image-generation/lib/preview.js'
import { writerEnvironment } from '../packages/dsh-taichi-image-generation/lib/commit.js'

const cleanups = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks() })
async function temp() { const p = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-taichi-image-'))); cleanups.push(() => rm(p, { recursive: true, force: true })); return p }

async function server() {
  const calls = []
  const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#11223380' } }).png().toBuffer()
  let status = 200
  const http = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    calls.push({ url: req.url, method: req.method, auth: req.headers.authorization, body: body ? JSON.parse(body) : undefined })
    if (req.url === '/v1/images/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{
        id: 'gpt-image-2', name: 'GPT Image 2', show_in_picker: true, credits: 150,
        sizes: [{ aspect_ratio: '1:1', quality: '1k', size: '1024x1024' }, { aspect_ratio: '16:9', quality: '2k', size: '2048x1152' }],
        quality_map: { '2k': 'gpt-image-2-vip' }
      }] }))
      return
    }
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(status === 402
      ? { error: { message: 'insufficient credits', type: 'insufficient_quota', code: 'insufficient_quota' } }
      : { created: 1, data: [{ b64_json: png.toString('base64') }] }))
  })
  await new Promise((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', resolve) })
  cleanups.push(() => { http.closeAllConnections(); return new Promise(resolve => http.close(resolve)) })
  return { calls, png, baseUrl: `http://127.0.0.1:${http.address().port}`, setStatus: value => { status = value } }
}

async function fixture() {
  const workspace = await temp()
  const ctx = new Context()
  for (const [plugin, config] of [[SystemPrompt, {}], [ToolRuntime, {}], [nativeExecutor, {}], [SkillRegistry, {}], [LocalSandboxProvider, {}], [LocalSubprocessRuntime, {}]]) {
    const fork = ctx.plugin(plugin, config)
    await fork
    cleanups.push(() => fork.dispose())
  }
  const log = vi.fn()
  let mode = 'workspace-write'
  const services = {
    sandbox: ctx.sandbox,
    subprocess: ctx.subprocess,
    logger: { info: log },
    sandboxPolicy: { resolve: () => ({ mode, workspaceRoot: workspace }) }
  }
  const id = SessionId(randomUUID())
  const agent = { session: Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), isSeeded: false, cwd: workspace }) }
  return { ctx, workspace, services, log, agent, setMode: value => { mode = value } }
}

const signedEnv = baseUrl => ({ TAICHI_GATEWAY_URL: baseUrl, TAICHI_GATEWAY_ACCESS_TOKEN: 'desktop-access-token' })

describe('taichi image generation', () => {
  it('asks for sign-in before calling the gateway', async () => {
    const f = await fixture()
    const s = await server()
    await expect(imageTool(f.services, {}).execute({ prompt: 'a red square' }, { agent: f.agent, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'AUTH' })
    expect(s.calls).toHaveLength(0)
  })

  it('sends an OpenAI images request with the host token and saves a PNG', async () => {
    const f = await fixture()
    const s = await server()
    const value = await imageTool(f.services, signedEnv(s.baseUrl)).execute(
      { prompt: 'a red square', aspect_ratio: '16:9', style_context: 'flat' },
      { agent: f.agent, signal: new AbortController().signal }
    )
    expect(s.calls.map(call => call.url)).toEqual(['/v1/images/models', '/v1/images/generations'])
    expect(s.calls[1]).toMatchObject({
      method: 'POST',
      auth: 'Bearer desktop-access-token',
      body: { model: 'gpt-image-2-vip', prompt: 'a red square\nflat', n: 1, size: '2048x1152', output_format: 'png' }
    })
    expect(value).toMatchObject({ provider: 'taichi', model: 'gpt-image-2-vip', media_type: 'image/png', workspace_path: `.workbuddy/generated-images/${value.sha256}.png` })
    const saved = await readFile(path.join(f.workspace, value.workspace_path))
    expect(saved.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(JSON.stringify(f.log.mock.calls)).not.toContain('desktop-access-token')
  })

  it('does not write an image when the gateway reports insufficient credits', async () => {
    const f = await fixture()
    const s = await server()
    s.setStatus(402)
    await expect(imageTool(f.services, signedEnv(s.baseUrl)).execute({ prompt: 'a red square' }, { agent: f.agent, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'QUOTA' })
    expect(await readdir(f.workspace)).toEqual([])
  })

  it('refuses a read-only workspace before the paid request', async () => {
    const f = await fixture()
    const s = await server()
    f.setMode('read-only')
    await expect(imageTool(f.services, signedEnv(s.baseUrl)).execute({ prompt: 'a red square' }, { agent: f.agent, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'POLICY' })
    expect(s.calls).toHaveLength(0)
  })

  it('switches the prompt when the host session is present and previews only a saved result', async () => {
    const routes = new Map()
    const attach = (f) => Object.assign(f.ctx, {
      connection: { fetch: { register(route) { routes.set(route.path, route) } } },
      logger: f.services.logger,
      sandboxPolicy: f.services.sandboxPolicy
    })
    const unsigned = await fixture()
    const unsignedHost = attach(unsigned)
    await apply(unsignedHost, {}, {})
    expect([...routes.keys()]).toEqual(['/api/taichi-image.models', '/api/taichi-image.generate', '/api/taichi-image.preview'])
    const unsignedPrompt = await unsignedHost.systemPrompt.assemble({})
    expect(unsignedPrompt.sections.find(section => section.name === IMAGE_PROMPT_SECTION).text).toBe(UNCONFIGURED_IMAGE_PROMPT)
    const f = await fixture()
    const s = await server()
    const signedHost = attach(f)
    await apply(signedHost, {}, signedEnv(s.baseUrl))
    const signed = await signedHost.systemPrompt.assemble({})
    expect(signed.sections.find(section => section.name === IMAGE_PROMPT_SECTION).text).toBe(CONFIGURED_IMAGE_PROMPT)
    const value = await imageTool(f.services, signedEnv(s.baseUrl)).execute({ prompt: 'a red square' }, { agent: f.agent, signal: new AbortController().signal })
    const events = [
      { type: 'tool/call', data: { callId: 'call-1', name: 'image_generate' } },
      { type: 'tool/result', surfaceOp: 'append', data: { message: { source: { callId: 'call-1' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: JSON.stringify(value) }] }] } } }
    ]
    signedHost.sessionController = { inspect: async () => ({ events, meta: { cwd: f.workspace } }) }
    const response = await previewImage(signedHost, new Request(`http://127.0.0.1/api/taichi-image.preview?session=session-1&asset=${value.sha256}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    const preserved = writerEnvironment({ env: { SECRET: '1', SystemRoot: 'C:\\Windows', TEMP: 'D:\\Temp' }, platform: 'win32', versions: {} })
    expect(preserved.SECRET).toBeUndefined()
    expect(preserved.TEMP).toBe('D:\\Temp')
  })

  it('reads the host session when Cordis passes an empty config', async () => {
    const routes = new Map()
    const f = await fixture()
    Object.assign(f.ctx, {
      connection: { fetch: { register(route) { routes.set(route.path, route) } } },
      logger: f.services.logger,
      sandboxPolicy: f.services.sandboxPolicy
    })
    const s = await server()
    const previous = {
      url: process.env.TAICHI_GATEWAY_URL,
      token: process.env.TAICHI_GATEWAY_ACCESS_TOKEN
    }
    process.env.TAICHI_GATEWAY_URL = s.baseUrl
    process.env.TAICHI_GATEWAY_ACCESS_TOKEN = 'desktop-access-token'
    try {
      await apply(f.ctx, {})
      const prompt = await f.ctx.systemPrompt.assemble({})
      expect(prompt.sections.find(section => section.name === IMAGE_PROMPT_SECTION).text).toBe(CONFIGURED_IMAGE_PROMPT)
      const response = await routes.get('/api/taichi-image.models').fetch()
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ signedIn: true, models: [expect.objectContaining({ id: 'gpt-image-2' })] })
      expect(s.calls.at(-1)).toMatchObject({ url: '/v1/images/models', auth: 'Bearer desktop-access-token' })
    } finally {
      if (previous.url === undefined) delete process.env.TAICHI_GATEWAY_URL
      else process.env.TAICHI_GATEWAY_URL = previous.url
      if (previous.token === undefined) delete process.env.TAICHI_GATEWAY_ACCESS_TOKEN
      else process.env.TAICHI_GATEWAY_ACCESS_TOKEN = previous.token
    }
  })
})
