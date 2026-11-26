import { createServer, type Server, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectImageBatch, runImageCalls } from '../packages/dsh-taichi-image-generation/src/engine.ts'
import { batchCells } from '../packages/dsh-taichi-image-generation/src/client/batch-board.ts'
import { ImageGenerationRuntime } from '../packages/dsh-taichi-image-generation/src/generation-runtime.ts'
import { GenerationTaskQueue } from '../packages/dsh-taichi-image-generation/src/task-queue.ts'
import type { GenerateRequest } from '../packages/dsh-taichi-image-generation/src/protocol.ts'
import { chatComplete } from '../packages/dsh-taichi-image-generation/src/prompt-enhancer.ts'
import { registerAgentImageTools } from '../packages/dsh-taichi-image-generation/src/agent-image-tools.ts'
import { resolveImageRequest } from '../packages/dsh-taichi-image-generation/src/image-request-options.ts'
import {
  ensureImageModels,
  ensureVideoModels,
  generateTaichiImage,
  generateTaichiVideo,
  overlayTaichiSettings,
  resetImageModelCache,
  resolveTaichiChatConfig,
  TAICHI_CHANNEL_ID,
  TAICHI_VIDEO_GENERATIONS_PATH,
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

describe('image batch', () => {
  it('keeps successful calls when one call rejects', () => {
    const kept = { b64: 'aaa', mime: 'image/png' }
    const batch = collectImageBatch([
      { status: 'rejected', reason: Object.assign(new Error('额度不足'), { code: 'QUOTA' }) },
      { status: 'fulfilled', value: [kept] },
    ])
    expect(batch.images).toEqual([kept])
    expect(batch.slots).toEqual([{ error: '额度不足' }, { imageIndex: 0 }])
  })

  it('throws the first failure when every call rejects', () => {
    let caught: unknown
    try {
      collectImageBatch([
        { status: 'rejected', reason: Object.assign(new Error('额度不足'), { code: 'QUOTA' }) },
        { status: 'rejected', reason: new Error('later') },
      ])
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({ message: '额度不足', code: 'QUOTA' })
  })

  it('reports a later call as soon as it finishes, then keeps request order', async () => {
    let releaseFirst: () => void = () => {}
    const first = new Promise<[{ b64: string; mime: string }]>(resolve => {
      releaseFirst = () => resolve([{ b64: 'a', mime: 'image/png' }])
    })
    const seen: string[][] = []
    const pending = runImageCalls([
      () => first,
      async () => [{ b64: 'b', mime: 'image/png' }],
    ], undefined, progress => {
      seen.push(progress.images.map(image => image.b64))
      expect(progress.slots).toEqual(
        progress.images.some(image => image.b64 === 'a')
          ? [{ index: 0, imageIndex: 0 }, { index: 1, imageIndex: 1 }]
          : [{ index: 1, imageIndex: 0 }],
      )
    })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(seen.map(batch => batch.join(','))).toContain('b')
    releaseFirst()
    const result = await pending
    expect(result.images.map(image => image.b64)).toEqual(['a', 'b'])
    expect(result.slots).toBeUndefined()
  })

  it('keeps an unfinished picture pending when its sibling is already back', () => {
    const cells = batchCells({
      images: [{ b64: 'b', mime: 'image/png' }],
      slots: [{ index: 1, imageIndex: 0 }],
    }, 2, false)
    expect(cells[0]).toMatchObject({ index: 0, pending: true })
    expect(cells[1]).toMatchObject({ index: 1, pending: false, image: { b64: 'b' } })
  })

  it('reads a finished partial batch by position when slots omit index', () => {
    const cells = batchCells({
      images: [{ b64: 'b', mime: 'image/png' }],
      slots: [{ error: 'nope' }, { imageIndex: 0 }],
    }, 2, true)
    expect(cells[0]).toMatchObject({ index: 0, pending: false, error: 'nope' })
    expect(cells[1]).toMatchObject({ index: 1, pending: false, image: { b64: 'b' } })
  })
})

describe('generation task progress', () => {
  const request: GenerateRequest = {
    mode: 'text',
    model: 'm',
    prompt: 'p',
    size: '1:1',
    quality: '1k',
    n: 2,
    detail: '',
  }

  it('publishes each finished picture while the task is still running', async () => {
    let release = (): void => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const queue = new GenerationTaskQueue(async (_request, _signal, report) => {
      report?.({
        images: [{ b64: 'b', mime: 'image/png' }],
        slots: [{ index: 1, imageIndex: 0 }],
      })
      await gate
      return { images: [{ b64: 'a', mime: 'image/png' }, { b64: 'b', mime: 'image/png' }] }
    })
    const finished = new Promise<void>(resolve => {
      queue.subscribe(task => {
        if (task.status === 'completed') resolve()
      })
    })
    const submitted = queue.submit(request)
    await new Promise(resolve => setTimeout(resolve, 20))
    const running = queue.get(submitted.id)
    expect(running?.status).toBe('running')
    expect(running?.result?.images.map(image => image.b64)).toEqual(['b'])
    expect(running?.result?.slots).toEqual([{ index: 1, imageIndex: 0 }])
    expect(queue.summaries().find(item => item.id === submitted.id)).toMatchObject({ readyImages: 1, readySlots: 1, resultAvailable: true })
    release()
    await finished
    const done = queue.get(submitted.id)
    expect(done?.status).toBe('completed')
    expect(done?.result?.images.map(image => image.b64)).toEqual(['a', 'b'])
    expect(done?.result?.slots).toBeUndefined()
  })

  it('drops a partial result when the task is cancelled', async () => {
    let release = (): void => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const queue = new GenerationTaskQueue(async (_request, signal, report) => {
      report?.({
        images: [{ b64: 'a', mime: 'image/png' }],
        slots: [{ index: 0, imageIndex: 0 }],
      })
      await gate
      if (signal.aborted) throw new Error('aborted')
      return { images: [{ b64: 'a', mime: 'image/png' }] }
    })
    const submitted = queue.submit(request)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(queue.get(submitted.id)?.result?.images).toHaveLength(1)
    const cancelled = queue.cancel(submitted.id)
    expect(cancelled?.status).toBe('cancelled')
    expect(cancelled?.result).toBeUndefined()
    release()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(queue.get(submitted.id)?.status).toBe('cancelled')
    expect(queue.get(submitted.id)?.result).toBeUndefined()
  })
})

describe('taichi image gateway', () => {
  const hits: Hit[] = []
  let server: Server | undefined
  let base = ''
  let status = 200
  let videoCreateStatus = 200
  let payload: unknown = { data: [{ b64_json: Buffer.from('png').toString('base64') }] }
  let generationIndex = 0
  let onGenerate: ((index: number, res: ServerResponse) => Promise<void>) | undefined
  const previousUrl = process.env.TAICHI_GATEWAY_URL
  const previousToken = process.env.TAICHI_GATEWAY_ACCESS_TOKEN

  afterEach(async () => {
    resetImageModelCache()
    videoCreateStatus = 200
    generationIndex = 0
    onGenerate = undefined
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
      if (req.url === '/v1/videos/models') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          object: 'list',
          data: [
            { id: 'grok', name: 'Grok', credits: 4800, default_duration: 10, duration_options: [10, 15] },
            { id: 'veo', name: 'Veo3', credits: 2600, default: true, fixed_duration: 8 },
            { id: 'muse-video', name: 'Muse', credits: 6000, default_duration: 5, duration_options: [5, 10] },
          ],
        }))
        return
      }
      if (req.method === 'POST' && req.url === '/v1/videos') {
        res.writeHead(videoCreateStatus, { 'content-type': 'application/json' })
        res.end(JSON.stringify(videoCreateStatus === 200
          ? { id: 'task-1', object: 'video', status: 'in_progress', model: 'veo' }
          : { error: { message: '请求无效', code: 'invalid_request' } }))
        return
      }
      if (req.url === '/v1/videos/task-1') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          id: 'task-1',
          object: 'video',
          status: 'completed',
          url: `http://${req.headers.host}/clip.mp4`,
          model: 'veo',
          progress: 100,
        }))
        return
      }
      if (req.url === '/clip.mp4') {
        res.writeHead(200, { 'content-type': 'video/mp4' })
        res.end(Buffer.from('mp4'))
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
      if (req.url === '/v1/images/generations' && onGenerate !== undefined) {
        const index = generationIndex
        generationIndex += 1
        await onGenerate(index, res)
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
    expect(channel.videoModels).toEqual([])
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
    expect(result.slots).toBeUndefined()
    expect(hits.findIndex(hit => hit.url === '/v1/images/models')).toBeLessThan(hits.findIndex(hit => hit.url === '/v1/images/generations'))
  })

  it('keeps the images that succeeded when another picture in the same request fails', async () => {
    await listen()
    let started = 0
    let release = (): void => {}
    const opened = new Promise<void>(resolve => { release = resolve })
    onGenerate = async (index, res) => {
      started += 1
      if (started >= 2) release()
      await opened
      if (index === 0) {
        res.writeHead(402, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: '额度不足，无法生成图像。', code: 'QUOTA' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ b64_json: Buffer.from('png-1').toString('base64') }] }))
    }
    const runtime = new ImageGenerationRuntime(() => {
      const channel = taichiRuntimeChannel()
      return { channels: [channel], defaultChannelId: channel.id }
    }, { append: async () => [] })
    const result = await runtime.run({
      mode: 'text',
      model: '太极图像',
      upstream: 'img-base',
      channelId: TAICHI_CHANNEL_ID,
      prompt: '一只猫',
      size: '1:1',
      quality: '1k',
      n: 2,
      detail: '',
    })
    expect(started).toBe(2)
    expect(result.images.map(item => Buffer.from(item.b64, 'base64').toString())).toEqual(['png-1'])
    expect(result.slots).toEqual([
      { error: '额度不足，无法生成图像。' },
      { imageIndex: 0 },
    ])
  }, 8_000)

  it('fails the batch only when every picture fails', async () => {
    await listen()
    onGenerate = async (_index, res) => {
      res.writeHead(402, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: '额度不足，无法生成图像。', code: 'QUOTA' } }))
    }
    const runtime = new ImageGenerationRuntime(() => {
      const channel = taichiRuntimeChannel()
      return { channels: [channel], defaultChannelId: channel.id }
    }, { append: async () => [] })
    await expect(runtime.run({
      mode: 'text',
      model: '太极图像',
      upstream: 'img-base',
      channelId: TAICHI_CHANNEL_ID,
      prompt: '一只猫',
      size: '1:1',
      quality: '1k',
      n: 2,
      detail: '',
    })).rejects.toMatchObject({ code: 'QUOTA' })
  })

  it('does not keep a partial batch after cancellation', async () => {
    await listen()
    const controller = new AbortController()
    let started = 0
    let release = (): void => {}
    const opened = new Promise<void>(resolve => { release = resolve })
    onGenerate = async (_index, res) => {
      started += 1
      if (started >= 2) release()
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 30_000)
        controller.signal.addEventListener('abort', () => {
          clearTimeout(timer)
          resolve()
        }, { once: true })
      })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ b64_json: Buffer.from('png').toString('base64') }] }))
    }
    const runtime = new ImageGenerationRuntime(() => {
      const channel = taichiRuntimeChannel()
      return { channels: [channel], defaultChannelId: channel.id }
    }, { append: async () => [] })
    const pending = runtime.run({
      mode: 'text',
      model: '太极图像',
      upstream: 'img-base',
      channelId: TAICHI_CHANNEL_ID,
      prompt: '一只猫',
      size: '1:1',
      quality: '1k',
      n: 2,
      detail: '',
    }, controller.signal)
    await opened
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
  }, 8_000)

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
      const generated = await tools.get('taichi_generate_image')!.execute({ prompt: '一只猫', count: 1 }, {})
      expect(generated.status).toBe('completed')
      expect(hits[0]?.url).toBe('/v1/images/models')
      expect(hits.some(hit => hit.url === '/v1/images/generations')).toBe(true)
      const rejected = await tools.get('taichi_generate_image')!.execute({ prompt: '一只猫', size: '21:9', quality: '4k', output_format: 'svg' } as never, {}) as { status: string; error?: string }
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

  it('lists gateway video models and submits the account video contract', async () => {
    await listen()
    await ensureVideoModels()
    const channel = taichiRuntimeChannel()
    expect(channel.videoModels).toEqual([
      { alias: 'Veo3', id: 'veo' },
      { alias: 'Grok', id: 'grok' },
      { alias: 'Muse', id: 'muse-video' },
    ])
    const settings = overlayTaichiSettings({}) as { defaultVideoModel?: string }
    expect(settings.defaultVideoModel).toBe('Veo3')
    const clip = await generateTaichiVideo({
      modelId: 'veo',
      prompt: '一段海浪',
      aspectRatio: '16:9',
      seconds: 8,
      mode: 'text',
    })
    expect(clip.bytes.toString()).toBe('mp4')
    expect(hits.find(hit => hit.method === 'POST' && hit.url === TAICHI_VIDEO_GENERATIONS_PATH)).toMatchObject({
      authorization: 'Bearer account-token',
      body: { model: 'veo', prompt: '一段海浪', orientation: 'landscape', seconds: 8, size: '16:9' },
    })
    expect(hits.some(hit => hit.url === '/v1/videos/task-1')).toBe(true)
  })

  it('sends a taichi-channel video request to the gateway', async () => {
    await listen()
    videoCreateStatus = 400
    const runtime = new ImageGenerationRuntime(() => {
      const channel = taichiRuntimeChannel()
      return { channels: [channel], defaultChannelId: channel.id }
    }, { append: async () => [] })
    await expect(runtime.runVideo({
      mode: 'text',
      model: 'Veo3',
      prompt: '一段海浪',
      aspectRatio: '16:9',
      resolution: '720P',
      seconds: 8,
    })).rejects.toMatchObject({ code: 'invalid_request', message: '请求无效' })
    expect(hits.some(hit => hit.method === 'POST' && hit.url === TAICHI_VIDEO_GENERATIONS_PATH)).toBe(true)
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
