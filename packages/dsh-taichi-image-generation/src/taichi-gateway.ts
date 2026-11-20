/**
 * Taichi gateway is the only image and video upstream.
 *
 * Image models and generations use the account gateway the desktop already
 * signs (`TAICHI_GATEWAY_URL` + `TAICHI_GATEWAY_ACCESS_TOKEN`). Custom provider
 * channels are not part of this deployment. The video route is reserved: the
 * gateway does not implement it yet, so callers stop before any network call.
 */

import {
  findCatalogModel,
  referenceLimitOf,
  resolveImageRequest,
  ImageOptionError,
  type ImageCatalogModel,
  type ImageOutputFormat,
  type ResolvedImageRequest,
} from './image-request-options.ts'
import { isLikelyImageModelId } from './model-catalog.ts'

export const TAICHI_CHANNEL_ID = 'taichi'
export const TAICHI_CHANNEL_NAME = '太极'
export const TAICHI_VIDEO_MODEL = 'taichi-video'
export const TAICHI_IMAGE_MODELS_PATH = '/v1/images/models'
export const TAICHI_IMAGE_GENERATIONS_PATH = '/v1/images/generations'
/** Reserved. The gateway has no video handler yet. */
export const TAICHI_VIDEO_GENERATIONS_PATH = '/v1/videos/generations'

const MODEL_TTL_MS = 60_000
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024
const CHAT_MODELS_PATH = '/v1/models'

export class TaichiGatewayError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'TaichiGatewayError'
    this.code = code
  }
}

export type TaichiImageModel = ImageCatalogModel
export type { ImageOutputFormat }

export interface TaichiChannel {
  id: string
  preset: 'taichi'
  name: string
  apiUrl: string
  apiUrlFull: false
  apiKey: string
  models: { alias: string; id: string }[]
  videoModels: { alias: string; id: string }[]
}

type GatewayEnv = NodeJS.ProcessEnv

let cachedModels: TaichiImageModel[] = []
let cachedAt = 0
let refresh: Promise<void> | undefined
let cachedChatModels: string[] = []
let chatCachedAt = 0
let chatRefresh: Promise<string> | undefined

export function gatewayConfig(env: GatewayEnv = process.env): { base: string; token: string; signedIn: boolean } {
  const base = typeof env.TAICHI_GATEWAY_URL === 'string' ? env.TAICHI_GATEWAY_URL.trim().replace(/\/$/u, '') : ''
  const token = typeof env.TAICHI_GATEWAY_ACCESS_TOKEN === 'string' ? env.TAICHI_GATEWAY_ACCESS_TOKEN.trim() : ''
  return { base, token, signedIn: base !== '' && token !== '' }
}

export function videoReservedMessage(): string {
  return '请先登录后再使用。'
}

function pickerModels(models: readonly TaichiImageModel[]): TaichiImageModel[] {
  return models.filter(model => model.show_in_picker !== false && model.id.trim() !== '')
}

function aliasesOf(models: readonly TaichiImageModel[]): { alias: string; id: string }[] {
  const used = new Set<string>()
  const out: { alias: string; id: string }[] = []
  for (const model of pickerModels(models)) {
    const id = model.id.trim()
    const preferred = model.name.trim() || id
    const alias = used.has(preferred) ? id : preferred
    if (used.has(alias)) continue
    used.add(alias)
    out.push({ alias, id })
  }
  return out
}

export function cachedImageModels(): TaichiImageModel[] {
  return cachedModels
}

export function taichiRuntimeChannel(env: GatewayEnv = process.env): TaichiChannel {
  const { base, token } = gatewayConfig(env)
  return {
    id: TAICHI_CHANNEL_ID,
    preset: 'taichi',
    name: TAICHI_CHANNEL_NAME,
    apiUrl: base === '' ? '' : `${base}/v1`,
    apiUrlFull: false,
    apiKey: token,
    models: aliasesOf(cachedModels),
    videoModels: [{ alias: TAICHI_VIDEO_MODEL, id: TAICHI_VIDEO_MODEL }],
  }
}

/** Replace a stored settings document with the single Taichi channel. */
export function overlayTaichiSettings(value: unknown, env: GatewayEnv = process.env): unknown {
  const channel = taichiRuntimeChannel(env)
  const { apiKey: _apiKey, ...published } = channel
  const base = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  // The access token stays in the host environment. The panel only needs this
  // boolean: a stored channel secret is never written for the desktop account.
  return {
    ...base,
    channels: [published],
    defaultChannelId: TAICHI_CHANNEL_ID,
    defaultModel: published.models[0]?.alias ?? '',
    defaultVideoModel: TAICHI_VIDEO_MODEL,
    imageCatalog: pickerModels(cachedModels),
    accountSignedIn: gatewayConfig(env).signedIn,
    channelSecrets: {},
    apiUrl: '',
    apiKey: '',
    imageModels: [],
    promptApiUrl: '',
    promptApiKey: '',
  }
}

const BLOCKED_SETTING_FIELDS = new Set([
  'channels',
  'channelSecrets',
  'apiUrl',
  'apiKey',
  'imageModels',
  'promptApiUrl',
  'promptApiKey',
  'defaultChannelId',
])

/** Drop writes that would recreate a self-provided channel or key. */
export function withoutChannelSettings(ops: unknown[]): unknown[] {
  return ops.filter(op => {
    if (op === null || typeof op !== 'object') return false
    const path = (op as { path?: unknown }).path
    const head = Array.isArray(path) ? path[0] : undefined
    return typeof head !== 'string' || !BLOCKED_SETTING_FIELDS.has(head)
  })
}

async function readBounded(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  if (!response.body) throw new TaichiGatewayError('RESPONSE', '图像服务没有返回内容。')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      signal?.throwIfAborted()
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > maxBytes) throw new TaichiGatewayError('TOO_LARGE', '图像响应超过 20 MB。')
      chunks.push(part.value)
    }
    return Buffer.concat(chunks, bytes)
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

async function gatewayFetch(path: string, env: GatewayEnv, signal: AbortSignal | undefined, init: RequestInit = {}): Promise<unknown> {
  const { base, token, signedIn } = gatewayConfig(env)
  if (!signedIn) throw new TaichiGatewayError('AUTH', '请先登录后再生成图像。')
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { accept: 'application/json', authorization: `Bearer ${token}`, ...init.headers },
      signal,
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) throw error
    throw new TaichiGatewayError('UNAVAILABLE', '图像服务暂时不可用。')
  }
  const raw = await readBounded(response, MAX_IMAGE_BYTES + 8 * 1024 * 1024, signal)
  let body: unknown = {}
  if (raw.length > 0) {
    try { body = JSON.parse(raw.toString('utf8')) } catch {
      throw new TaichiGatewayError('RESPONSE', '图像服务返回了无法读取的内容。')
    }
  }
  if (response.status === 401) throw new TaichiGatewayError('AUTH', '请先登录后再生成图像。')
  if (response.status === 402) throw new TaichiGatewayError('QUOTA', '额度不足，无法生成图像。')
  if (!response.ok) throw new TaichiGatewayError('UNAVAILABLE', '图像服务拒绝了这次请求。')
  return body
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => typeof item === 'string' && item.trim() !== '' ? [item.trim()] : [])
}

function parseModels(body: unknown): TaichiImageModel[] {
  const data = body !== null && typeof body === 'object' ? (body as { data?: unknown }).data : undefined
  if (!Array.isArray(data)) return []
  const models: TaichiImageModel[] = []
  for (const item of data) {
    if (item === null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (id === '') continue
    const name = typeof record.name === 'string' && record.name.trim() !== '' ? record.name.trim() : id
    const sizes = Array.isArray(record.sizes)
      ? record.sizes.flatMap(size => {
        if (size === null || typeof size !== 'object') return []
        const row = size as Record<string, unknown>
        return [{
          ...typeof row.aspect_ratio === 'string' ? { aspect_ratio: row.aspect_ratio } : {},
          ...typeof row.quality === 'string' ? { quality: row.quality.toLowerCase() } : {},
          ...typeof row.size === 'string' ? { size: row.size } : {},
        }]
      })
      : []
    const qualityMap = record.quality_map !== null && typeof record.quality_map === 'object' && !Array.isArray(record.quality_map)
      ? Object.fromEntries(Object.entries(record.quality_map).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : undefined
    const formats = stringList(record.output_formats).map(item => item.toLowerCase()).filter(item => item === 'png' || item === 'gif' || item === 'svg')
    models.push({
      id,
      name,
      show_in_picker: record.show_in_picker !== false,
      ...typeof record.credits === 'number' ? { credits: record.credits } : {},
      ...typeof record.max_reference_images === 'number' ? { max_reference_images: record.max_reference_images } : {},
      quality_options: stringList(record.quality_options).map(item => item.toLowerCase()),
      ...qualityMap !== undefined ? { quality_map: qualityMap } : {},
      ...sizes.length > 0 ? { sizes } : {},
      render_quality_options: stringList(record.render_quality_options).map(item => item.toLowerCase()),
      background_options: stringList(record.background_options).map(item => item.toLowerCase()),
      output_formats: formats.length > 0 ? formats : ['png'],
    })
  }
  return models
}

export async function listImageModels(env: GatewayEnv = process.env, signal?: AbortSignal): Promise<TaichiImageModel[]> {
  return parseModels(await gatewayFetch(TAICHI_IMAGE_MODELS_PATH, env, signal))
}

export function ensureImageModels(env: GatewayEnv = process.env): Promise<void> {
  if (refresh !== undefined) return refresh
  if (cachedModels.length > 0 && Date.now() - cachedAt < MODEL_TTL_MS) return Promise.resolve()
  refresh = listImageModels(env)
    .then(models => {
      cachedModels = models
      cachedAt = Date.now()
    })
    .catch(() => undefined)
    .finally(() => { refresh = undefined })
  return refresh
}

export function resetImageModelCache(): void {
  cachedModels = []
  cachedAt = 0
  refresh = undefined
  cachedChatModels = []
  chatCachedAt = 0
  chatRefresh = undefined
}

export interface TaichiReferenceImage {
  mediaType: string
  data: Buffer
}

export interface TaichiChatConfig {
  apiUrl: string
  apiKey: string
  model: string
}

/** Chat models from `GET /v1/models`, skipping ids that are image models. */
export function parseChatModelIds(body: unknown): string[] {
  const data = body !== null && typeof body === 'object' ? (body as { data?: unknown }).data : undefined
  if (!Array.isArray(data)) return []
  const ids: string[] = []
  for (const item of data) {
    const id = item !== null && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
      ? (item as { id: string }).id.trim()
      : ''
    if (id === '' || isLikelyImageModelId(id) || ids.includes(id)) continue
    ids.push(id)
  }
  return ids
}

export async function listChatModels(env: GatewayEnv = process.env, signal?: AbortSignal): Promise<string[]> {
  return parseChatModelIds(await gatewayFetch(CHAT_MODELS_PATH, env, signal))
}

/** First non-image model on the account gateway, cached separately from image models. */
export function ensureChatModel(env: GatewayEnv = process.env): Promise<string> {
  if (chatRefresh !== undefined) return chatRefresh
  if (cachedChatModels.length > 0 && Date.now() - chatCachedAt < MODEL_TTL_MS) {
    return Promise.resolve(cachedChatModels[0] ?? '')
  }
  const pending = listChatModels(env)
    .then(models => {
      cachedChatModels = models
      chatCachedAt = Date.now()
      return models[0] ?? ''
    })
    .finally(() => {
      if (chatRefresh === pending) chatRefresh = undefined
    })
  chatRefresh = pending
  return pending
}

export async function resolveTaichiChatConfig(env: GatewayEnv = process.env): Promise<TaichiChatConfig> {
  const { base, token, signedIn } = gatewayConfig(env)
  if (!signedIn) throw new TaichiGatewayError('AUTH', '请先登录后再使用。')
  const model = await ensureChatModel(env)
  if (model === '') throw new TaichiGatewayError('MODEL', '没有可用的对话模型。')
  return { apiUrl: `${base}/v1`, apiKey: token, model }
}

export interface TaichiGenerateInput {
  prompt: string
  modelId: string
  aspect?: string
  quality?: string
  renderQuality?: string
  background?: string
  outputFormat?: string
  mode?: string
  images?: TaichiReferenceImage[]
}

function referenceDataUrls(images: readonly TaichiReferenceImage[] | undefined, limit: number): string[] {
  const list = images ?? []
  if (list.length > limit) {
    throw new TaichiGatewayError('reference-limit', `参考图最多 ${limit} 张。`)
  }
  return list.map(image => {
    if (image.data.byteLength === 0 || image.data.byteLength > MAX_REFERENCE_BYTES) {
      throw new TaichiGatewayError('reference-too-large', '单张参考图不能超过 10 MB。')
    }
    const mediaType = image.mediaType.trim() === '' ? 'image/png' : image.mediaType.trim()
    return `data:${mediaType};base64,${image.data.toString('base64')}`
  })
}

function resolveKnownImage(model: ImageCatalogModel, input: TaichiGenerateInput): ResolvedImageRequest {
  try {
    return resolveImageRequest(model, {
      aspect: input.aspect,
      quality: input.quality,
      renderQuality: input.renderQuality,
      background: input.background,
      outputFormat: input.outputFormat,
      mode: input.mode === 'edit' ? 'edit' : 'text',
    })
  } catch (error) {
    if (error instanceof ImageOptionError) throw new TaichiGatewayError(error.code, error.message)
    throw error
  }
}

export async function generateTaichiImage(input: TaichiGenerateInput, env: GatewayEnv = process.env, signal?: AbortSignal): Promise<Buffer> {
  const model = findCatalogModel(cachedModels, input.modelId)
  const selected: ResolvedImageRequest = model === undefined || (model.sizes?.length ?? 0) === 0
    ? { model: input.modelId.trim(), size: '1024x1024', outputFormat: 'png' }
    : resolveKnownImage(model, input)
  if (selected.model === '') throw new TaichiGatewayError('MODEL', '没有可用的生图模型。')
  const references = referenceDataUrls(input.images, referenceLimitOf(model))
  const body = await gatewayFetch(TAICHI_IMAGE_GENERATIONS_PATH, env, signal, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: selected.model,
      prompt: input.prompt,
      n: 1,
      size: selected.size,
      output_format: selected.outputFormat,
      ...selected.renderQuality === undefined ? {} : { quality: selected.renderQuality },
      ...selected.background === undefined ? {} : { background: selected.background },
      ...references.length > 0 ? { image: references } : {},
    }),
  })
  const encoded = body !== null && typeof body === 'object'
    ? (body as { data?: { b64_json?: unknown }[] }).data?.[0]?.b64_json
    : undefined
  if (typeof encoded !== 'string' || encoded === '') {
    throw new TaichiGatewayError('RESPONSE', '图像服务没有返回图片。')
  }
  const data = Buffer.from(encoded, 'base64')
  if (data.length === 0 || data.length > MAX_IMAGE_BYTES) {
    throw new TaichiGatewayError('TOO_LARGE', '生成的图片超过 20 MB。')
  }
  return data
}
