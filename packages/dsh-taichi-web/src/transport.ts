import { WebError } from '@deepseek-ai/dsh-web'
import { resolveTaichiWebGateway, TAICHI_WEB_TOOLS_PREFIX, type TaichiWebGateway } from './env.ts'

const USER_AGENT = 'dsh-taichi-web/0.1.0'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function invalidResponse(): WebError {
  return new WebError('Taichi gateway returned an invalid response body', 'WEB_PROVIDER_ERROR')
}

export function requestAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('Taichi web request aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw requestAborted(signal)
}

function statusMessage(status: number, body: unknown): string {
  let message = `Taichi gateway error (HTTP ${status})`
  if (isRecord(body)) {
    const detail = typeof body.error === 'string'
      ? body.error
      : isRecord(body.error)
        ? body.error.message
        : body.message
    if (typeof detail === 'string' && detail.length > 0) message += `: ${detail}`
  }
  return message
}

function mapHttpFailure(status: number, message: string): WebError {
  if (status === 401) {
    return new WebError(
      `${message}\n\nTaichi rejected the signed-in account used for this web request. `
      + 'Guide the user to sign in to Taichi again; the endpoint does not need changing.',
      'WEB_PROVIDER_ERROR',
    )
  }
  if (status === 402) {
    return new WebError(
      `${message}\n\nTaichi reports insufficient credits for this web request. `
      + 'Guide the user to check their credit balance or recharge.',
      'WEB_PROVIDER_ERROR',
    )
  }
  return new WebError(message, 'WEB_PROVIDER_ERROR')
}

export async function dispatchTaichiWeb<T>(
  env: NodeJS.ProcessEnv,
  path: '/search' | '/fetch',
  body: object,
  decode: (payload: unknown) => T,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal)
  const gateway = resolveTaichiWebGateway(env)
  if (!gateway.ok) {
    throw new WebError(
      'Taichi web access has no gateway URL or access token to send',
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
  return dispatchResolved(gateway, path, body, decode, signal)
}

async function dispatchResolved<T>(
  gateway: Extract<TaichiWebGateway, { ok: true }>,
  path: '/search' | '/fetch',
  body: object,
  decode: (payload: unknown) => T,
  signal?: AbortSignal,
): Promise<T> {
  const endpoint = `${gateway.baseURL}${TAICHI_WEB_TOOLS_PREFIX}${path}`
  throwIfAborted(signal)
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${gateway.token}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify(body),
      ...signal !== undefined ? { signal } : {},
    })
  } catch (error: unknown) {
    if (signal?.aborted === true || isAbortError(error)) throw requestAborted(signal, error)
    throw new WebError(`Taichi web request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }

  if (!response.ok) {
    let parsed: unknown
    let aborted: WebError | undefined
    try {
      parsed = await response.json()
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) aborted = requestAborted(signal, error)
    }
    if (aborted !== undefined) throw aborted
    throw mapHttpFailure(response.status, statusMessage(response.status, parsed))
  }

  try {
    const payload: unknown = await response.json()
    throwIfAborted(signal)
    return decode(payload)
  } catch (error: unknown) {
    if (signal?.aborted === true || isAbortError(error)) throw requestAborted(signal, error)
    if (error instanceof WebError) throw error
    throw new WebError(
      `Taichi gateway returned an unprocessable response body: ${String(error)}`,
      'WEB_PROVIDER_ERROR',
      { cause: error },
    )
  }
}
