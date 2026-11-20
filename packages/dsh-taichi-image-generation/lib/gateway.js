import { ImageError, MAX_IMAGE_BYTES } from './errors.js'

const FALLBACK_SIZES = {
  '1:1': '1024x1024',
  '16:9': '1536x864',
  '9:16': '864x1536',
  '4:3': '1024x768',
  '3:4': '768x1024'
}

export function gatewayConfig(env = process.env) {
  const base = typeof env.TAICHI_GATEWAY_URL === 'string' ? env.TAICHI_GATEWAY_URL.trim().replace(/\/$/u, '') : ''
  const token = typeof env.TAICHI_GATEWAY_ACCESS_TOKEN === 'string' ? env.TAICHI_GATEWAY_ACCESS_TOKEN.trim() : ''
  return { base, token, signedIn: base !== '' && token !== '' }
}

export function sizeFor(model, aspect = '1:1') {
  const sizes = Array.isArray(model?.sizes) ? model.sizes : []
  const match = sizes.find(item => item?.aspect_ratio === aspect && item?.quality === '1k')
    ?? sizes.find(item => item?.aspect_ratio === aspect)
  const size = typeof match?.size === 'string' ? match.size : (FALLBACK_SIZES[aspect] ?? FALLBACK_SIZES['1:1'])
  const quality = typeof match?.quality === 'string' ? match.quality : '1k'
  const mapped = model?.quality_map?.[quality]
  const modelId = typeof mapped === 'string' && mapped !== '' ? mapped : model?.id
  if (typeof modelId !== 'string' || modelId === '') throw new ImageError('MODEL', 'No image model is available.', 404)
  return { model: modelId, size }
}

export async function readBounded(response, maxBytes, signal) {
  if (!response.body) throw new ImageError('RESPONSE', 'The image service returned an empty response.', 502)
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  try {
    while (true) {
      signal?.throwIfAborted()
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > maxBytes) throw new ImageError('TOO_LARGE', 'The image response exceeds 20 MB.', 502)
      chunks.push(part.value)
    }
    return Buffer.concat(chunks, bytes)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

async function gatewayFetch(path, env, signal, init = {}) {
  const { base, token, signedIn } = gatewayConfig(env)
  if (!signedIn) throw new ImageError('AUTH', 'Sign in to Taichi before generating images.', 401)
  let response
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { accept: 'application/json', authorization: `Bearer ${token}`, ...init.headers },
      signal
    })
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error
    throw new ImageError('UNAVAILABLE', 'The image service is unavailable.', 502)
  }
  const raw = await readBounded(response, MAX_IMAGE_BYTES + 8 * 1024 * 1024, signal)
  let body = {}
  if (raw.length > 0) {
    try { body = JSON.parse(raw.toString('utf8')) } catch { throw new ImageError('RESPONSE', 'The image service returned an unreadable response.', 502) }
  }
  if (response.status === 401) throw new ImageError('AUTH', 'Sign in to Taichi before generating images.', 401)
  if (response.status === 402) throw new ImageError('QUOTA', 'Not enough credits to generate an image.', 402)
  if (!response.ok) throw new ImageError('UNAVAILABLE', 'The image service rejected the request.', response.status >= 500 ? 502 : 400)
  return body
}

export async function listModels(env = process.env, signal) {
  const body = await gatewayFetch('/v1/images/models', env, signal)
  return Array.isArray(body.data) ? body.data : []
}

export async function generateImage({ prompt, model, size, signal, env = process.env }) {
  const body = await gatewayFetch('/v1/images/generations', env, signal, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt, n: 1, size, output_format: 'png' })
  })
  const encoded = body?.data?.[0]?.b64_json
  if (typeof encoded !== 'string' || encoded === '') throw new ImageError('RESPONSE', 'The image service did not return an image.', 502)
  const data = Buffer.from(encoded, 'base64')
  if (data.length === 0 || data.length > MAX_IMAGE_BYTES) throw new ImageError('TOO_LARGE', 'The generated image exceeds 20 MB.', 502)
  return data
}
