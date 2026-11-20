import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ImageGenerationRuntime } from '../packages/dsh-taichi-image-generation/src/generation-runtime.ts'
import { VideoGenError } from '../packages/dsh-taichi-image-generation/src/video-engine.ts'
import { chatComplete } from '../packages/dsh-taichi-image-generation/src/prompt-enhancer.ts'
import { registerAgentImageTools } from '../packages/dsh-taichi-image-generation/src/agent-image-tools.ts'
import { resolveImageRequest } from '../packages/dsh-taichi-image-generation/src/image-request-options.ts'
import {
  ensureImageModels,
  generateTaichiImage,
  overlayTaichiSettings,
  resetImageModelCache,
  resolveTaichiChatConfig,
  TAICHI_CHANNEL_ID,
  TAICHI_VIDEO_GENERATIONS_PATH,
  TAICHI_VIDEO_MODEL,
  taichiRuntimeChannel,
  withoutChannelSettings,
} from '../packages/dsh-taichi-image-generation/src/taichi-gateway.ts'
import { channelIsConnected } from '../packages/dsh-taichi-image-generation/src/account-channel.ts'

interface Hit {
  method: string
  url: string
  authorization: string
  body?: unknown
}

describe('taichi image gateway', () => {
  const hits: Hit[] = []
  let server: Server | undefined
  let base = ''
  let status = 200
  let payload: unknown = { data: [{ b64_json: Buffer.from('png').toString('base64') }] }
  const previousUrl = process.env.TAICHI_GATEWAY_URL
  const previousToken = process.env.TAICHI_GATEWAY_ACCESS_TOKEN

  afterEach(async () => {
    resetImageModelCache()
    if (previousUrl === undefined) delete process.env.TAICHI_GATEWAY_URL
    else process.env.TAICHI_GATEWAY_URL = previousUrl
    if (previousToken === undefined) delete process.env.TAICHI_GATEWAY_ACCESS_TOKEN
    else process.env.TAICHI_GATEWAY_ACCESS_TOKEN = previousToken
    if (server !== undefined) {
      await new Promise<void>((resolve, reject) => {
        server?.close(error => error ? reject(error) : resolve())
      })
      server = undefined
    }
  })

  async function listen(): Promise<void> {
    hits.length = 0
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      const raw = Buffer.concat(chunks).toString('utf8')
      hits.push({
        method: req.method ?? '',
        url: req.url ?? '',
        authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : '',
        ...raw === '' ? {} : { body: JSON.parse(raw) as unknown },
      })
      if (req.url === '/v1/images/models') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          data: [{
            id: 'img-base',
            name: '太极图像',
            show_in_picker: true,
            max_reference_images: 3,
            quality_options: ['1k', '2k'],
            sizes: [
              { aspect_ratio: '16:9', quality: '1k', size: '1536x864' },
              { aspect_ratio: '16:9', quality: '2k', size: '2048x1152' },
              { aspect_ratio: '1:1', quality: '1k', size: '1024x1024' },
            ],
            quality_map: { '1k': 'img-1k', '2k': 'img-2k' },
            render_quality_options: ['low', 'medium', 'high'],
            background_options: ['transparent'],
            output_formats: ['png', 'gif', 'svg'],
          }],
        }))
        return
      }
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'img-base' }, { id: 'deepseek-chat' }] }))
        return
      }
      if (req.url === '/v1/chat/completions') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: 'expanded prompt' } }] }))
        return
      }
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    })
    await new Promise<void>(resolve => { server?.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server did not bind')
    base = `http://127.0.0.1:${address.port}`
    process.env.TAICHI_GATEWAY_URL = base
    process.env.TAICHI_GATEWAY_ACCESS_TOKEN = 'account-token'
  }

  it('lists models, maps size and quality, and posts the image contract', async () => {
    await listen()
    await ensureImageModels()
    const channel = taichiRuntimeChannel()
    expect(channel.id).toBe(TAICHI_CHANNEL_ID)
    expect(channel.models).toEqual([{ alias: '太极图像', id: 'img-base' }])
    expect(channel.videoModels).toEqual([{ alias: TAICHI_VIDEO_MODEL, id: TAICHI_VIDEO_MODEL }])
    expect(JSON.stringify(overlayTaichiSettings({ channels: [{ id: 'mine', apiKey: 'secret' }] }))).not.toContain('account-token')
    expect(JSON.stringify(overlayTaichiSettings({}))).not.toContain('mine')
    const settings = overlayTaichiSettings({}) as { accountSignedIn?: boolean; imageCatalog?: Array<Record<string, unknown>> }
    expect(settings.accountSignedIn).toBe(true)
    expect(settings.imageCatalog?.[0]).toMatchObject({
      id: 'img-base',
      max_reference_images: 3,
      quality_options: ['1k', '2k'],
      render_quality_options: ['low', 'medium', 'high'],
      background_options: ['transparent'],
      output_formats: ['png', 'gif', 'svg'],
    })

    const bytes = await generateTaichiImage({ prompt: '一只猫', modelId: 'img-base', aspect: '16:9', quality: '1k' })
    expect(bytes.toString()).toBe('png')
    const generation = hits.find(hit => hit.url === '/v1/images/generations')
    expect(generation).toMatchObject({
      method: 'POST',
      authorization: 'Bearer account-token',
      body: { model: 'img-1k', prompt: '一只猫', n: 1, size: '1536x864', output_format: 'png' },
    })
    expect(generation?.body).not.toHaveProperty('image')
    expect(generation?.body).not.toHaveProperty('quality')
    expect(generation?.body).not.toHaveProperty('background')
  })

  it('rejects an unpublished ratio or tier and forwards render quality, background and gif', async () => {
    const model = {
      id: 'gpt-image-2.6',
      name: 'GPT Image 2.6',
      quality_options: ['1k'],
      sizes: [{ aspect_ratio: '1:1', quality: '1k', size: '1024x1024' }],
      render_quality_options: [],
      background_options: [],
      output_formats: ['png', 'gif', 'svg'],
    }
    expect(() => resolveImageRequest(model, { aspect: '21:9', quality: '2k' })).toThrow(/21:9/)
    expect(() => resolveImageRequest(model, { aspect: '1:1', quality: '2k' })).toThrow(/2k/)
    expect(resolveImageRequest(model, { aspect: '1:1', outputFormat: 'gif' }).outputFormat).toBe('gif')
    expect(resolveImageRequest(model, { aspect: '1:1', outputFormat: 'svg' }).outputFormat).toBe('svg')
    const flare = {
      id: 'gpt-image-2.6-flare',
      name: 'GPT Image 2.6 Flare',
      quality_options: ['1k', '2k', '4k'],
      sizes: [
        { aspect_ratio: '1:1', quality: '1k', size: '1024x1024' },
        { aspect_ratio: '1:1', quality: '2k', size: '2048x2048' },
        { aspect_ratio: '1:1', quality: '4k', size: '2880x2880' },
        { aspect_ratio: '3:1', quality: '1k', size: '2048x688' },
        { aspect_ratio: '3:1', quality: '2k', size: '3840x1280' },
      ],
      render_quality_options: ['low', 'medium', 'high'],
      background_options: ['transparent'],
      output_formats: ['png', 'gif'],
    }
    expect(() => resolveImageRequest(flare, { aspect: '3:1', quality: '4k' })).toThrow(/4k/)
    expect(() => resolveImageRequest(flare, { aspect: '1:1', quality: '2k', renderQuality: 'xhigh' })).toThrow(/xhigh/)
    expect(() => resolveImageRequest(flare, { aspect: '1:1', outputFormat: 'svg' })).toThrow(/svg/)
    expect(resolveImageRequest(flare, { aspect: '1:1', quality: '2k', renderQuality: 'high', background: 'transparent', outputFormat: 'gif' })).toEqual({
      model: 'gpt-image-2.6-flare',
      size: '2048x2048',
      outputFormat: 'gif',
      renderQuality: 'high',
      background: 'transparent',
    })
    const sunburst = { ...flare, id: 'gpt-image-2.6-sunburst', name: 'GPT Image 2.6 Sunburst' }
    expect(() => resolveImageRequest(sunburst, { aspect: '1:1', outputFormat: 'svg' })).toThrow(/svg/)
    expect(() => resolveImageRequest(sunburst, { aspect: '1:1', quality: '1k', renderQuality: 'xhigh' })).toThrow(/xhigh/)
    expect(resolveImageRequest(sunburst, { aspect: '1:1', quality: '4k', renderQuality: 'low', outputFormat: 'gif' })).toMatchObject({
      model: 'gpt-image-2.6-sunburst',
      size: '2880x2880',
      renderQuality: 'low',
      outputFormat: 'gif',
    })

    await listen()
    await ensureImageModels()
    await generateTaichiImage({
      prompt: '一只猫',
      modelId: 'img-base',
      aspect: '16:9',
      quality: '2k',
      renderQuality: 'high',
      background: 'transparent',
      outputFormat: 'gif',
    })
    const generation = hits.find(hit => hit.url === '/v1/images/generations')
    expect(generation?.body).toMatchObject({
      model: 'img-2k',
      size: '2048x1152',
      quality: 'high',
      background: 'transparent',
      output_format: 'gif',
    })
    await expect(generateTaichiImage({ prompt: '一只猫', modelId: 'img-base', aspect: '21:9', quality: '1k' })).rejects.toThrow(/21:9/)
    const runtime = new ImageGenerationRuntime(() => {
      const channel = taichiRuntimeChannel()
      return { channels: [channel], defaultChannelId: channel.id }
    }, { append: async () => [] })
    const animated = await runtime.run({
      mode: 'text',
      model: '太极图像',
      upstream: 'img-base',
      channelId: TAICHI_CHANNEL_ID,
      prompt: '一只猫',
      size: '1:1',
      quality: '1k',
      outputFormat: 'gif',
      n: 1,
      detail: '',
    })
    expect(animated.images[0]?.mime).toBe('image/gif')
    const drawn = await runtime.run({
      mode: 'text',
      model: '太极图像',
      upstream: 'img-base',
      channelId: TAICHI_CHANNEL_ID,
      prompt: '一只猫',
      size: '1:1',
      quality: '1k',
      outputFormat: 'svg',
      n: 1,
      detail: '',
    })
    expect(drawn.images[0]?.mime).toBe('image/svg+xml')
  })

  it('sends reference images on the same generations request', async () => {
    await listen()
    await ensureImageModels()
    const primary = Buffer.from('primary')
    const extra = Buffer.from('extra')
    const bytes = await generateTaichiImage({
      prompt: '改成夜景',
      modelId: 'img-base',
      aspect: '16:9',
      quality: '1k',
      mode: 'edit',
      images: [
        { mediaType: 'image/png', data: primary },
        { mediaType: 'image/jpeg', data: extra },
      ],
    })
    expect(bytes.toString()).toBe('png')
    const generation = hits.find(hit => hit.url === '/v1/images/generations')
    expect(generation).toMatchObject({
      method: 'POST',
      body: {
        model: 'img-1k',
        prompt: '改成夜景',
        n: 1,
        size: '1536x864',
        output_format: 'png',
        image: [
          `data:image/png;base64,${primary.toString('base64')}`,
          `data:image/jpeg;base64,${extra.toString('base64')}`,
        ],
      },
    })
  })

  it('repeats a reference image once per requested count', async () => {
    await listen()
    const runtime = new ImageGenerationRuntime(() => {
      const channel = taichiRuntimeChannel()
      return { channels: [channel], defaultChannelId: channel.id }
    }, { append: async () => [] })
    const reference = `data:image/png;base64,${Buffer.from('ref').toString('base64')}`
    const result = await runtime.run({
      mode: 'edit',
      model: '太极图像',
      upstream: 'img-base',
      channelId: TAICHI_CHANNEL_ID,
      prompt: '改成夜景',
      size: '16:9',
      quality: '1k',
      n: 2,
      detail: '',
      image: reference,
    })
    expect(result.images).toHaveLength(2)
    const generations = hits.filter(hit => hit.url === '/v1/images/generations')
    expect(generations).toHaveLength(2)
    expect(generations[0]?.body).toMatchObject({ n: 1, image: [reference] })
    expect(generations[1]?.body).toMatchObject({ n: 1, image: [reference] })
    expect(hits.findIndex(hit => hit.url === '/v1/images/models')).toBeLessThan(hits.findIndex(hit => hit.url === '/v1/images/generations'))
  })

  it('loads image models before an agent generation when the cache is empty', async () => {
    await listen()
    const tools = new Map<string, { execute: (args: { prompt: string; count?: number }, exec: { signal?: AbortSignal }) => Promise<{ status: string }> }>()
    const runtime = new ImageGenerationRuntime(() => {
      const channel = taichiRuntimeChannel()
      return { channels: [channel], defaultChannelId: channel.id }
    }, { append: async () => [] })
    const dispose = registerAgentImageTools({
      tools: { register: definition => { tools.set(definition.name, definition as never); return () => { tools.delete(definition.name) } } },
      attachments: { saveImages: async () => [], readImage: async () => { throw new Error('unused') } },
    } as never, runtime, () => {
      const channel = taichiRuntimeChannel()
      return {
        enabled: true,
        allowAgentImageGeneration: true,
        channels: [channel],
        defaultChannelId: channel.id,
        defaultModel: channel.models[0]?.alias ?? '',
      }
    })
    try {
      const generated = await tools.get('generate_image')!.execute({ prompt: '一只猫', count: 1 }, {})
      expect(generated.status).toBe('completed')
      expect(hits[0]?.url).toBe('/v1/images/models')
      expect(hits.some(hit => hit.url === '/v1/images/generations')).toBe(true)
      const rejected = await tools.get('generate_image')!.execute({ prompt: '一只猫', size: '21:9', quality: '4k', output_format: 'svg' } as never, {}) as { status: string; error?: string }
      expect(rejected.status).toBe('failed')
      expect(rejected.error).toMatch(/21:9/)
    } finally {
      dispose()
    }
  })

  it('uses the first non-image gateway model for prompt chat', async () => {
    await listen()
    const config = await resolveTaichiChatConfig()
    expect(config).toMatchObject({ apiUrl: `${base}/v1`, apiKey: 'account-token', model: 'deepseek-chat' })
    const answer = await chatComplete(config, { system: 'edit prompts', content: '一只猫' })
    expect(answer).toBe('expanded prompt')
    const chat = hits.find(hit => hit.url === '/v1/chat/completions')
    expect(chat).toMatchObject({
      method: 'POST',
      authorization: 'Bearer account-token',
      body: { model: 'deepseek-chat' },
    })
    expect(hits.findIndex(hit => hit.url === '/v1/models')).toBeLessThan(hits.findIndex(hit => hit.url === '/v1/chat/completions'))
  })

  it('maps gateway auth and quota failures', async () => {
    await listen()
    status = 401
    payload = {}
    await expect(generateTaichiImage({ prompt: '一只猫', modelId: 'img-base' })).rejects.toMatchObject({ code: 'AUTH' })
    status = 402
    await expect(generateTaichiImage({ prompt: '一只猫', modelId: 'img-base' })).rejects.toMatchObject({ code: 'QUOTA' })
  })

  it('does not call the reserved video route', async () => {
    await listen()
    const runtime = new ImageGenerationRuntime(() => {
      const channel = taichiRuntimeChannel()
      return { channels: [channel], defaultChannelId: channel.id }
    }, { append: async () => [] })
    await expect(runtime.runVideo({
      mode: 'text',
      model: TAICHI_VIDEO_MODEL,
      prompt: '一段海浪',
      aspectRatio: '16:9',
      resolution: '720P',
      seconds: 4,
    })).rejects.toBeInstanceOf(VideoGenError)
    await expect(runtime.runVideo({
      mode: 'text',
      model: TAICHI_VIDEO_MODEL,
      prompt: '一段海浪',
      aspectRatio: '16:9',
      resolution: '720P',
      seconds: 4,
    })).rejects.toMatchObject({ code: 'video-not-ready' })
    expect(hits.some(hit => hit.url === TAICHI_VIDEO_GENERATIONS_PATH)).toBe(false)
  })

  it('keeps a signed-in desktop account ready without a stored channel secret', () => {
    process.env.TAICHI_GATEWAY_URL = 'http://127.0.0.1:8787'
    process.env.TAICHI_GATEWAY_ACCESS_TOKEN = 'account-token'
    const signedIn = overlayTaichiSettings({}) as { accountSignedIn?: boolean }
    expect(signedIn.accountSignedIn).toBe(true)
    expect(JSON.stringify(signedIn)).not.toContain('account-token')
    delete process.env.TAICHI_GATEWAY_ACCESS_TOKEN
    const signedOut = overlayTaichiSettings({}) as { accountSignedIn?: boolean; channels?: { apiUrl?: string }[] }
    expect(signedOut.accountSignedIn).toBe(false)
    expect(signedOut.channels?.[0]?.apiUrl).toBe('http://127.0.0.1:8787/v1')
    const taichi = { id: 'taichi', preset: 'taichi', apiUrl: 'http://127.0.0.1:8787/v1' }
    expect(channelIsConnected(taichi, { accountSignedIn: true, secretSet: false, subscriptionLoggedOut: false })).toBe(true)
    expect(channelIsConnected(taichi, { accountSignedIn: false, secretSet: false, subscriptionLoggedOut: false })).toBe(false)
    expect(channelIsConnected(
      { id: 'other', preset: '', apiUrl: 'https://example.test/v1' },
      { accountSignedIn: false, secretSet: true, subscriptionLoggedOut: false },
    )).toBe(true)
    expect(channelIsConnected(
      { id: 'other', preset: '', apiUrl: 'https://example.test/v1', auth: 'subscription', subscription: 'chatgpt-sub' },
      { accountSignedIn: false, secretSet: false, subscriptionLoggedOut: true },
    )).toBe(false)
  })

  it('drops stored channel writes and the settings page', () => {
    expect(withoutChannelSettings([
      { op: 'set', path: ['channels'], value: [] },
      { op: 'set', path: ['apiKey'], value: 'secret' },
      { op: 'set', path: ['skillsEnabled'], value: false },
    ])).toEqual([{ op: 'set', path: ['skillsEnabled'], value: false }])
    const client = readFileSync(join(process.cwd(), 'packages/dsh-taichi-image-generation/src/client/index.ts'), 'utf8')
    expect(client).not.toContain("name: 'settings.section'")
  })
})
