import {
  isRechargeYuan,
  rechargeCredits,
  type AccountCreditDay,
  type AccountCredits,
  type AccountLongContextPrice,
  type AccountMediaModel,
  type AccountModelPrice,
  type AccountOrder,
  type AccountPeakPrice
} from '../../shared/account-gateway'
import { alipayQrPayload } from './payment-link'

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

  createOrder(accessToken: string, yuan: number): Promise<GatewayResult> {
    return this.send('/v1/credits/orders', { method: 'POST', token: accessToken, body: { yuan: String(yuan) } })
  }

  order(accessToken: string, orderId: string): Promise<GatewayResult> {
    return this.send(`/v1/credits/orders/${orderId}`, { method: 'GET', token: accessToken })
  }

  balance(accessToken: string): Promise<GatewayResult> {
    return this.send('/v1/credits/balance', { method: 'GET', token: accessToken })
  }

  summary(accessToken: string): Promise<GatewayResult> {
    return this.send('/v1/credits/summary', { method: 'GET', token: accessToken })
  }

  models(accessToken: string): Promise<GatewayResult> {
    return this.send('/v1/models', { method: 'GET', token: accessToken })
  }

  imageModels(accessToken: string): Promise<GatewayResult> {
    return this.send('/v1/images/models', { method: 'GET', token: accessToken })
  }

  videoModels(accessToken: string): Promise<GatewayResult> {
    return this.send('/v1/videos/models', { method: 'GET', token: accessToken })
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

const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export function readPurchaseOrder(body: unknown): AccountOrder | undefined {
  if (!isRecord(body)) return undefined
  const yuan = body.yuan
  const credits = body.credits
  const orderId = body.orderId
  const status = body.status
  if (typeof yuan !== 'number' || !isRechargeYuan(yuan)) return undefined
  if (credits !== rechargeCredits(yuan)) return undefined
  if (typeof orderId !== 'string' || !ORDER_ID.test(orderId)) return undefined
  if (status !== 'pending' && status !== 'paid') return undefined
  const qrCode = body.qrCode
  if (qrCode === undefined) return { orderId, yuan, credits, status }
  if (typeof qrCode !== 'string') return undefined
  const allowed = alipayQrPayload(qrCode)
  if (!allowed) return undefined
  return { orderId, yuan, credits, status, qrCode: allowed }
}

export function readBalance(body: unknown): number | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const balance = (body as { balance?: unknown }).balance
  return typeof balance === 'number' && Number.isInteger(balance) ? balance : undefined
}

const GRANT_KINDS = ['checkin', 'signup', 'purchase', 'adjustment'] as const

export function readCreditSummary(body: unknown): AccountCredits | undefined {
  if (!isRecord(body)) return undefined
  const consumed = nonNegativeInt(body.consumed)
  const recharged = nonNegativeInt(body.recharged)
  const usageCount = nonNegativeInt(body.usageCount)
  if (consumed === undefined || recharged === undefined || usageCount === undefined) return undefined
  if (!Array.isArray(body.consumption) || !Array.isArray(body.recharge)) return undefined
  const consumption = body.consumption.slice(0, 50).flatMap(readCreditUse)
  const recharge = body.recharge.slice(0, 50).flatMap(readCreditGrant)
  const daily = readCreditDays(body.daily)
  if (consumption.length !== Math.min(body.consumption.length, 50) || recharge.length !== Math.min(body.recharge.length, 50) || !daily) return undefined
  return { consumed, recharged, usageCount, consumption, recharge, daily }
}

function readCreditDays(value: unknown): AccountCreditDay[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const source = value.slice(-4000)
  const days = source.flatMap(readCreditDay)
  if (days.length !== source.length) return undefined
  return days
}

function readCreditDay(value: unknown): AccountCreditDay[] {
  if (!isRecord(value) || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value.date)) return []
  const consumed = nonNegativeInt(value.consumed)
  const recharged = nonNegativeInt(value.recharged)
  const count = nonNegativeInt(value.count)
  if (consumed === undefined || recharged === undefined || count === undefined) return []
  return [{ date: value.date, consumed, recharged, count }]
}

function readCreditUse(value: unknown): AccountCredits['consumption'] {
  if (!isRecord(value)) return []
  const id = shortText(value.id, 80)
  const createdAt = timestampText(value.createdAt)
  const amount = positiveInt(value.amount)
  if (!id || !createdAt || amount === undefined) return []
  const model = shortText(value.model, 200)
  return [{ id, amount, createdAt, ...(model ? { model } : {}) }]
}

function readCreditGrant(value: unknown): AccountCredits['recharge'] {
  if (!isRecord(value)) return []
  const id = shortText(value.id, 80)
  const createdAt = timestampText(value.createdAt)
  const amount = positiveInt(value.amount)
  const kind = value.kind
  if (!id || !createdAt || amount === undefined || typeof kind !== 'string' || !GRANT_KINDS.includes(kind as typeof GRANT_KINDS[number])) return []
  return [{ id, amount, createdAt, kind: kind as typeof GRANT_KINDS[number] }]
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
  price?: AccountModelPrice
}

/** Image and video rows the account page can price. `undefined` means the body was not a list. */
export function readMediaModels(body: unknown, kind: 'image' | 'video'): AccountMediaModel[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.data)) return undefined
  const models: AccountMediaModel[] = []
  for (const item of body.data) {
    const model = readMediaModel(item, kind)
    if (model) models.push(model)
  }
  return models
}

function readMediaModel(value: unknown, kind: 'image' | 'video'): AccountMediaModel | undefined {
  if (!isRecord(value) || typeof value.id !== 'string') return undefined
  const id = value.id.trim()
  if (id.length === 0) return undefined
  if (kind === 'image' && value.show_in_picker === false) return undefined
  const published = typeof value.name === 'string' ? value.name.trim() : ''
  const credits = nonNegativeNumber(value.credits)
  const qualityCredits = kind === 'image' ? readQualityCredits(value.quality_credits) : undefined
  return {
    id,
    name: published.length > 0 ? published : id,
    ...(credits !== undefined ? { credits } : {}),
    ...(qualityCredits ? { qualityCredits } : {})
  }
}

const QUALITY_TIERS = ['1k', '2k', '4k'] as const

function readQualityCredits(value: unknown): AccountMediaModel['qualityCredits'] {
  if (!isRecord(value)) return undefined
  const tiers: NonNullable<AccountMediaModel['qualityCredits']> = []
  for (const tier of QUALITY_TIERS) {
    const credits = nonNegativeInt(value[tier])
    if (credits === undefined) continue
    tiers.push({ tier, credits })
  }
  return tiers.length > 0 ? tiers : undefined
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
  const price = readModelPrice(value.pricing)
  return {
    id: value.id,
    name,
    contextWindow,
    maxTokens,
    ...(input ? { input } : {}),
    ...(reasoningEfforts ? { reasoningEfforts } : {}),
    ...(price ? { price } : {})
  }
}

function readModelPrice(value: unknown): AccountModelPrice | undefined {
  if (!isRecord(value)) return undefined
  const inputPerMillion = nonNegativeNumber(value.input_credits_per_million)
  const outputPerMillion = nonNegativeNumber(value.output_credits_per_million)
  if (inputPerMillion === undefined || outputPerMillion === undefined) return undefined
  const cachePerMillion = nonNegativeNumber(value.cache_credits_per_million)
  const cacheWrite5mPerMillion = nonNegativeNumber(value.cache_write_5m_credits_per_million)
  const cacheWrite1hPerMillion = nonNegativeNumber(value.cache_write_1h_credits_per_million)
  const listInputPerMillion = higherCredit(value.input_list_credits_per_million, inputPerMillion)
  const listOutputPerMillion = higherCredit(value.output_list_credits_per_million, outputPerMillion)
  const savingsRatio = readSavingsRatio(value.savings_ratio)
  const longContext = readLongContextPrice(value.long_context)
  const peak = readPeakPrice(value.peak)
  return {
    inputPerMillion,
    outputPerMillion,
    ...(cachePerMillion !== undefined ? { cachePerMillion } : {}),
    ...(cacheWrite5mPerMillion !== undefined ? { cacheWrite5mPerMillion } : {}),
    ...(cacheWrite1hPerMillion !== undefined ? { cacheWrite1hPerMillion } : {}),
    ...(listInputPerMillion !== undefined ? { listInputPerMillion } : {}),
    ...(listOutputPerMillion !== undefined ? { listOutputPerMillion } : {}),
    ...(savingsRatio !== undefined ? { savingsRatio } : {}),
    ...(longContext ? { longContext } : {}),
    ...(peak ? { peak } : {})
  }
}

function higherCredit(value: unknown, sell: number): number | undefined {
  const amount = nonNegativeNumber(value)
  return amount !== undefined && amount > sell ? amount : undefined
}

function readSavingsRatio(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1 ? value : undefined
}

function readLongContextPrice(value: unknown): AccountLongContextPrice | undefined {
  if (!isRecord(value)) return undefined
  const minInputTokens = capacity(value.min_input_tokens)
  const input = positiveNumber(value.input)
  const output = positiveNumber(value.output)
  const cache = positiveNumber(value.cache)
  const cacheWrite = positiveNumber(value.cache_write)
  if (minInputTokens === undefined || input === undefined || output === undefined || cache === undefined || cacheWrite === undefined) return undefined
  return { minInputTokens, input, output, cache, cacheWrite }
}

function readPeakPrice(value: unknown): AccountPeakPrice | undefined {
  if (!isRecord(value) || !Array.isArray(value.weekdays) || !Array.isArray(value.windows) || value.windows.length === 0) return undefined
  const multiplier = positiveNumber(value.multiplier)
  if (multiplier === undefined || value.weekdays.length === 0) return undefined
  const weekdays: number[] = []
  for (const day of value.weekdays) {
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6 || weekdays.includes(day)) return undefined
    weekdays.push(day)
  }
  const windows: Array<[string, string]> = []
  for (const window of value.windows) {
    if (!Array.isArray(window)) return undefined
    const start = clockText(window[0])
    const end = clockText(window[1])
    if (start === undefined || end === undefined) return undefined
    windows.push([start, end])
  }
  return { multiplier, weekdays, windows }
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

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function nonNegativeInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function shortText(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined
}

function timestampText(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40) return undefined
  return Number.isNaN(Date.parse(value)) ? undefined : value
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function clockText(value: unknown): string | undefined {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/u.test(value) ? value : undefined
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
