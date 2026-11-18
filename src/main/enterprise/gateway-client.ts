export class GatewayClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 15_000
  ) {}

  register(email: string, password: string): Promise<GatewayResult> {
    return this.send('/v1/auth/register', { method: 'POST', body: { email, password } })
  }

  verify(token: string): Promise<GatewayResult> {
    return this.send('/v1/auth/verify', { method: 'POST', body: { token } })
  }

  login(email: string, password: string): Promise<GatewayResult> {
    return this.send('/v1/auth/login', { method: 'POST', body: { email, password } })
  }

  refresh(refreshToken: string): Promise<GatewayResult> {
    return this.send('/v1/auth/refresh', { method: 'POST', body: { refreshToken } })
  }

  logout(refreshToken: string): Promise<GatewayResult> {
    return this.send('/v1/auth/logout', { method: 'POST', body: { refreshToken } })
  }

  requestPasswordReset(email: string): Promise<GatewayResult> {
    return this.send('/v1/auth/password-reset', { method: 'POST', body: { email } })
  }

  confirmPasswordReset(token: string, password: string): Promise<GatewayResult> {
    return this.send('/v1/auth/password-reset', { method: 'POST', body: { token, password } })
  }

  checkIn(accessToken: string): Promise<GatewayResult> {
    return this.send('/v1/credits/check-in', { method: 'POST', token: accessToken })
  }

  balance(accessToken: string): Promise<GatewayResult> {
    return this.send('/v1/credits/balance', { method: 'GET', token: accessToken })
  }

  models(accessToken: string): Promise<GatewayResult> {
    return this.send('/v1/models', { method: 'GET', token: accessToken })
  }

  private async send(path: string, init: { method: string; body?: Record<string, string>; token?: string }): Promise<GatewayResult> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (init.body) headers['content-type'] = 'application/json'
    if (init.token) headers.authorization = `Bearer ${init.token}`
    const controller = new AbortController()
    const timeoutError = new Error(`Gateway ${init.method} ${path} timed out after ${this.timeoutMs}ms`)
    timeoutError.name = 'TimeoutError'
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(timeoutError)
        controller.abort(timeoutError)
      }, this.timeoutMs)
    })
    try {
      return await Promise.race([
        (async () => {
          const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            method: init.method,
            headers,
            signal: controller.signal,
            ...(init.body ? { body: JSON.stringify(init.body) } : {})
          })
          const text = await response.text()
          let body: unknown = undefined
          if (text.length > 0) {
            try {
              body = JSON.parse(text) as unknown
            } catch (cause) {
              throw new Error(`Gateway ${init.method} ${path} returned invalid JSON (HTTP ${response.status})`, { cause })
            }
          }
          return { status: response.status, body }
        })(),
        deadline
      ])
    } catch (cause) {
      if (cause === timeoutError) throw cause
      throw new Error(`Gateway ${init.method} ${path} request failed`, { cause })
    } finally {
      clearTimeout(timer)
    }
  }
}

export interface GatewayResult {
  status: number
  body: unknown
}

export function readTokenPair(body: unknown): { accessToken: string; refreshToken: string } | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const record = body as { accessToken?: unknown; refreshToken?: unknown }
  if (typeof record.accessToken !== 'string' || !record.accessToken.trim() ||
      typeof record.refreshToken !== 'string' || !record.refreshToken.trim()) return undefined
  return { accessToken: record.accessToken, refreshToken: record.refreshToken }
}

export function readBalance(body: unknown): number | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const balance = (body as { balance?: unknown }).balance
  return typeof balance === 'number' && Number.isInteger(balance) ? balance : undefined
}

const EFFORT_LEVELS = ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none'] as const
const LISTING_MODALITIES = ['text', 'image', 'file', 'audio', 'video'] as const

export interface GatewayModelProfile {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  input?: Array<'text' | 'image'>
  reasoningEfforts?: Record<string, string>
}

/** Models the official listing fully described. Incomplete rows are omitted so route defaults cannot fill them. */
export function readGatewayModels(body: unknown): GatewayModelProfile[] {
  if (!isRecord(body) || !Array.isArray(body.data)) return []
  return body.data.flatMap(item => {
    const profile = readGatewayModel(item)
    return profile ? [profile] : []
  })
}

function readGatewayModel(value: unknown): GatewayModelProfile | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0) return undefined
  const contextWindow = capacity(value.contextWindow, value.context_window, value.context_length, value.max_input_tokens, recordField(value.limit, 'context'))
  const maxTokens = capacity(
    value.maxOutputTokens,
    value.max_output_tokens,
    value.maxTokens,
    value.max_tokens,
    recordField(value.limit, 'output'),
    recordField(value.top_provider, 'max_completion_tokens')
  )
  if (contextWindow === undefined || maxTokens === undefined) return undefined
  const name = text(value.name, value.display_name, value.displayName) ?? value.id
  const input = readInput(value.architecture)
  const reasoningEfforts = readReasoning(value.reasoning)
  return {
    id: value.id,
    name,
    contextWindow,
    maxTokens,
    ...(input ? { input } : {}),
    ...(reasoningEfforts ? { reasoningEfforts } : {})
  }
}

function readInput(value: unknown): Array<'text' | 'image'> | undefined {
  if (!isRecord(value) || !Array.isArray(value.input_modalities)) return undefined
  const modalities = value.input_modalities
  if (modalities.length === 0 || !modalities.every(item => typeof item === 'string' && LISTING_MODALITIES.includes(item as typeof LISTING_MODALITIES[number]))) return undefined
  const input = [...new Set(modalities.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image'))]
  return input.length > 0 ? input : undefined
}

function readReasoning(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value) || typeof value.mandatory !== 'boolean') return undefined
  if (value.default_enabled !== undefined && typeof value.default_enabled !== 'boolean') return undefined
  if (value.default_effort !== undefined && value.default_effort !== null && !isEffort(value.default_effort)) return undefined
  if (value.supports_max_tokens !== undefined && typeof value.supports_max_tokens !== 'boolean') return undefined
  const disclosed = value.supported_efforts
  if (disclosed !== null && !(Array.isArray(disclosed) && disclosed.every(level => level === null || isEffort(level)))) return undefined
  const efforts: Record<string, string> = {}
  for (const level of disclosed === null ? EFFORT_LEVELS : disclosed) {
    if (!isEffort(level) || (level === 'none' && value.mandatory)) continue
    efforts[level === 'none' ? 'off' : level] = level
  }
  return Object.keys(efforts).some(level => level !== 'off') ? efforts : undefined
}

function text(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

function capacity(...candidates: unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) return candidate
  }
  return undefined
}

function recordField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

function isEffort(value: unknown): value is typeof EFFORT_LEVELS[number] {
  return typeof value === 'string' && EFFORT_LEVELS.includes(value as typeof EFFORT_LEVELS[number])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function readError(body: unknown): string {
  if (body === null || typeof body !== 'object') return 'unavailable'
  const error = (body as { error?: unknown }).error
  return typeof error === 'string' ? error : 'unavailable'
}
