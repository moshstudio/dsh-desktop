import type { Translate } from './locale'

export interface LongContextPrice {
  minInputTokens: number
  input: number
  output: number
  cache: number
  cacheWrite: number
}

export interface PeakPrice {
  multiplier: number
  weekdays: number[]
  windows: Array<[string, string]>
}

export interface ModelPrice {
  inputPerMillion: number
  outputPerMillion: number
  cachePerMillion?: number
  cacheWrite5mPerMillion?: number
  cacheWrite1hPerMillion?: number
  listInputPerMillion?: number
  listOutputPerMillion?: number
  savingsRatio?: number
  longContext?: LongContextPrice
  peak?: PeakPrice
}

export interface CatalogModel {
  id: string
  name: string
  vendor?: string
  price?: ModelPrice
}

export interface MediaTier {
  tier: string
  credits: number
}

export interface MediaModel {
  id: string
  name: string
  credits?: number
  qualityCredits?: MediaTier[]
}

export interface CreditUse {
  id: string
  amount: number
  createdAt: string
  model?: string
}

export type GrantKind = 'checkin' | 'signup' | 'purchase' | 'adjustment'

export interface CreditGrant {
  id: string
  amount: number
  createdAt: string
  kind: GrantKind
}

export interface CreditDay {
  date: string
  consumed: number
  recharged: number
  count: number
}

export interface CreditSummary {
  consumed: number
  recharged: number
  usageCount: number
  consumption: CreditUse[]
  recharge: CreditGrant[]
  daily: CreditDay[]
}

export interface ProfileFlags {
  /** True when that profile read failed, not when the list has rows. */
  models: boolean
  balance: boolean
  images: boolean
  videos: boolean
}

export interface VendorGroup {
  key: string
  label: string
  models: CatalogModel[]
}

export type RangeKind = 'today' | 'yesterday' | '7' | '30' | 'all'

export interface RangeStats {
  consumed: number
  recharged: number
  count: number
  points: CreditDay[]
}

interface ProfileSource {
  profile?: {
    models?: string
    balance?: string
    images?: string
    videos?: string
  }
  message?: string
  models?: unknown
  balance?: unknown
}

const VENDOR_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  gemini: 'Google',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  alibaba: 'Qwen',
  moonshot: 'Moonshot',
  kimi: 'Moonshot',
  zhipu: 'Zhipu',
  glm: 'Zhipu',
  minimax: 'MiniMax',
  mistral: 'Mistral',
  meta: 'Meta',
  llama: 'Meta',
  xai: 'xAI',
  grok: 'xAI',
  cohere: 'Cohere',
  doubao: 'Doubao',
  bytedance: 'Doubao',
  hunyuan: 'Hunyuan',
  tencent: 'Hunyuan',
  baidu: 'Baidu',
  wenxin: 'Baidu',
  yi: '01.AI',
  spark: 'iFlytek',
  iflytek: 'iFlytek',
  baichuan: 'Baichuan',
  stepfun: 'StepFun',
  perplexity: 'Perplexity',
  amazon: 'Amazon'
}

const VENDOR_FAMILIES: Array<[RegExp, string]> = [
  [/^(gpt|chatgpt|o1|o3|o4)([-.]|$)/iu, 'openai'],
  [/^claude/iu, 'anthropic'],
  [/^(gemini|gemma)/iu, 'google'],
  [/^deepseek/iu, 'deepseek'],
  [/^(qwen|qwq)/iu, 'qwen'],
  [/^(glm|zhipu)/iu, 'zhipu'],
  [/^(kimi|moonshot)/iu, 'moonshot'],
  [/^(mistral|mixtral|codestral)/iu, 'mistral'],
  [/^llama/iu, 'meta'],
  [/^grok/iu, 'xai'],
  [/^doubao/iu, 'doubao'],
  [/^hunyuan/iu, 'hunyuan'],
  [/^(ernie|wenxin)/iu, 'baidu'],
  [/^yi[-.]/iu, 'yi'],
  [/^spark/iu, 'spark'],
  [/^baichuan/iu, 'baichuan'],
  [/^step-/iu, 'stepfun'],
  [/^(minimax|abab)/iu, 'minimax'],
  [/^sonar/iu, 'perplexity']
]

const WEEKDAY_KEYS = ['weekdayMon', 'weekdayTue', 'weekdayWed', 'weekdayThu', 'weekdayFri', 'weekdaySat', 'weekdaySun'] as const

const GRANT_KEYS: Record<GrantKind, string> = {
  checkin: 'kindCheckin',
  signup: 'kindSignup',
  purchase: 'kindPurchase',
  adjustment: 'kindAdjustment'
}

const MEDIA_TIERS = ['1k', '2k', '4k'] as const

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object') return undefined
  return value as Record<string, unknown>
}

function creditCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function positiveFactor(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function wholeCredit(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function clockText(value: unknown): string | undefined {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/u.test(value) ? value : undefined
}

function readSavingsRatio(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1 ? value : undefined
}

function assignCredit(price: ModelPrice, key: 'cachePerMillion' | 'cacheWrite5mPerMillion' | 'cacheWrite1hPerMillion', value: unknown): void {
  const amount = creditCount(value)
  if (amount !== undefined) price[key] = amount
}

function assignHigherCredit(price: ModelPrice, key: 'listInputPerMillion' | 'listOutputPerMillion', value: unknown, sell: number): void {
  const amount = creditCount(value)
  if (amount !== undefined && amount > sell) price[key] = amount
}

function readLongContext(value: unknown): LongContextPrice | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const minInputTokens = positiveInt(record.minInputTokens)
  const input = positiveFactor(record.input)
  const output = positiveFactor(record.output)
  const cache = positiveFactor(record.cache)
  const cacheWrite = positiveFactor(record.cacheWrite)
  if (minInputTokens === undefined || input === undefined || output === undefined || cache === undefined || cacheWrite === undefined) return undefined
  return { minInputTokens, input, output, cache, cacheWrite }
}

function readPeak(value: unknown): PeakPrice | undefined {
  const record = asRecord(value)
  if (record === undefined || !Array.isArray(record.weekdays) || !Array.isArray(record.windows) || record.windows.length === 0) return undefined
  const multiplier = positiveFactor(record.multiplier)
  if (multiplier === undefined || record.weekdays.length === 0) return undefined
  const weekdays: number[] = []
  for (const day of record.weekdays) {
    if (!Number.isInteger(day) || day < 0 || day > 6 || weekdays.includes(day)) return undefined
    weekdays.push(day)
  }
  const windows: Array<[string, string]> = []
  for (const item of record.windows) {
    if (!Array.isArray(item)) return undefined
    const start = clockText(item[0])
    const end = clockText(item[1])
    if (start === undefined || end === undefined) return undefined
    windows.push([start, end])
  }
  return { multiplier, weekdays, windows }
}

export function modelPrice(value: unknown): ModelPrice | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const inputPerMillion = creditCount(record.inputPerMillion)
  const outputPerMillion = creditCount(record.outputPerMillion)
  if (inputPerMillion === undefined || outputPerMillion === undefined) return undefined
  const price: ModelPrice = { inputPerMillion, outputPerMillion }
  assignCredit(price, 'cachePerMillion', record.cachePerMillion)
  assignCredit(price, 'cacheWrite5mPerMillion', record.cacheWrite5mPerMillion)
  assignCredit(price, 'cacheWrite1hPerMillion', record.cacheWrite1hPerMillion)
  assignHigherCredit(price, 'listInputPerMillion', record.listInputPerMillion, inputPerMillion)
  assignHigherCredit(price, 'listOutputPerMillion', record.listOutputPerMillion, outputPerMillion)
  const savingsRatio = readSavingsRatio(record.savingsRatio)
  if (savingsRatio !== undefined) price.savingsRatio = savingsRatio
  const longContext = readLongContext(record.longContext)
  const peak = readPeak(record.peak)
  if (longContext) price.longContext = longContext
  if (peak) price.peak = peak
  return price
}

export function mediaQualityCredits(value: unknown): MediaTier[] | undefined {
  if (!Array.isArray(value)) return undefined
  const byTier = new Map<string, number>()
  for (const item of value) {
    const record = asRecord(item)
    if (record === undefined) continue
    const tier = typeof record.tier === 'string' ? record.tier.trim().toLowerCase() : ''
    if (!(MEDIA_TIERS as readonly string[]).includes(tier)) continue
    if (typeof record.credits !== 'number' || !Number.isInteger(record.credits) || record.credits < 0) continue
    byTier.set(tier, record.credits)
  }
  const tiers = MEDIA_TIERS.flatMap(tier => {
    const credits = byTier.get(tier)
    return credits === undefined ? [] : [{ tier, credits }]
  })
  return tiers.length > 0 ? tiers : undefined
}

export function accountModels(value: unknown): CatalogModel[] {
  if (!Array.isArray(value)) return []
  const models: CatalogModel[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0) {
      models.push({ id: item, name: item })
      continue
    }
    const record = asRecord(item)
    if (record === undefined || typeof record.id !== 'string' || record.id.length === 0) continue
    const name = typeof record.name === 'string' && record.name.length > 0 ? record.name : record.id
    const vendor = typeof record.vendor === 'string' && record.vendor.trim().length > 0 ? record.vendor.trim() : undefined
    const price = modelPrice(record.price)
    const model: CatalogModel = { id: record.id, name }
    if (vendor) model.vendor = vendor
    if (price) model.price = price
    models.push(model)
  }
  return models
}

export function accountMedia(value: unknown): MediaModel[] {
  if (!Array.isArray(value)) return []
  const models: MediaModel[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0) {
      models.push({ id: item, name: item })
      continue
    }
    const record = asRecord(item)
    if (record === undefined || typeof record.id !== 'string' || record.id.length === 0) continue
    const name = typeof record.name === 'string' && record.name.length > 0 ? record.name : record.id
    const model: MediaModel = { id: record.id, name }
    if (typeof record.credits === 'number' && Number.isFinite(record.credits) && record.credits >= 0) model.credits = record.credits
    const qualityCredits = mediaQualityCredits(record.qualityCredits)
    if (qualityCredits) model.qualityCredits = qualityCredits
    models.push(model)
  }
  return models
}

export function profileFlags(status: ProfileSource | null | undefined): ProfileFlags {
  const profile = status?.profile
  if (profile && (profile.models === 'ready' || profile.models === 'failed') && (profile.balance === 'ready' || profile.balance === 'failed')) {
    return {
      models: profile.models === 'failed',
      balance: profile.balance === 'failed',
      images: profile.images === 'failed',
      videos: profile.videos === 'failed'
    }
  }
  const failed = status?.message === 'profile_unavailable'
  return {
    models: failed && (!Array.isArray(status?.models) || status.models.length === 0),
    balance: failed && status?.balance == null,
    images: false,
    videos: false
  }
}

function modelVendorKey(model: CatalogModel): string {
  if (typeof model.vendor === 'string' && model.vendor.trim().length > 0) return model.vendor.trim().toLowerCase()
  const slash = model.id.indexOf('/')
  if (slash > 0) return model.id.slice(0, slash).toLowerCase()
  for (const [pattern, vendor] of VENDOR_FAMILIES) {
    if (pattern.test(model.id) || pattern.test(model.name)) return vendor
  }
  return ''
}

export function vendorLabel(t: Translate, key: string): string {
  if (!key) return t('vendorOther')
  return VENDOR_LABELS[key] ?? `${key.charAt(0).toUpperCase()}${key.slice(1)}`
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true })
}

interface OrderedModel {
  model: CatalogModel
  index: number
}

function compareByPrice(left: OrderedModel, right: OrderedModel): number {
  const leftIn = left.model.price?.inputPerMillion
  const rightIn = right.model.price?.inputPerMillion
  if (leftIn === undefined || rightIn === undefined) {
    if (!(leftIn === undefined && rightIn === undefined)) return leftIn === undefined ? 1 : -1
  } else if (leftIn !== rightIn) return leftIn - rightIn
  const leftOut = left.model.price?.outputPerMillion ?? Number.POSITIVE_INFINITY
  const rightOut = right.model.price?.outputPerMillion ?? Number.POSITIVE_INFINITY
  if (leftOut !== rightOut) return leftOut - rightOut
  const byName = compareText(left.model.name, right.model.name)
  return byName !== 0 ? byName : left.index - right.index
}

export function mediaByPrice(models: MediaModel[]): MediaModel[] {
  return models
    .map((model, index) => ({ model, index }))
    .sort((left, right) => {
      const leftCredits = left.model.credits
      const rightCredits = right.model.credits
      if (leftCredits === undefined || rightCredits === undefined) {
        if (!(leftCredits === undefined && rightCredits === undefined)) return leftCredits === undefined ? 1 : -1
      } else if (leftCredits !== rightCredits) return leftCredits - rightCredits
      const byName = compareText(left.model.name, right.model.name)
      return byName !== 0 ? byName : left.index - right.index
    })
    .map(item => item.model)
}

function compareVendor(left: string, right: string, t: Translate): number {
  if (left === right) return 0
  if (left === 'openai') return -1
  if (right === 'openai') return 1
  if (!left) return 1
  if (!right) return -1
  return compareText(vendorLabel(t, left), vendorLabel(t, right))
}

export function modelsByVendor(models: CatalogModel[], t: Translate): VendorGroup[] {
  const decorated = models.map((model, index) => ({ model, index, key: modelVendorKey(model) }))
  decorated.sort((left, right) => {
    const byVendor = compareVendor(left.key, right.key, t)
    if (byVendor !== 0) return byVendor
    return compareByPrice(left, right)
  })
  const groups: VendorGroup[] = []
  for (const item of decorated) {
    const last = groups[groups.length - 1]
    if (!last || last.key !== item.key) groups.push({ key: item.key, label: vendorLabel(t, item.key), models: [item.model] })
    else last.models.push(item.model)
  }
  return groups
}

export function modelsByPrice(models: CatalogModel[]): CatalogModel[] {
  return models.map((model, index) => ({ model, index })).sort(compareByPrice).map(item => item.model)
}

export function weekdayKey(day: number): string {
  return WEEKDAY_KEYS[day] ?? 'weekdayMon'
}

export function grantLabel(kind: GrantKind): string {
  return GRANT_KEYS[kind]
}

function readCreditDay(value: unknown): CreditDay | undefined {
  const record = asRecord(value)
  if (record === undefined || typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(record.date)) return undefined
  const consumed = wholeCredit(record.consumed)
  const recharged = wholeCredit(record.recharged)
  const count = wholeCredit(record.count)
  if (consumed === undefined || recharged === undefined || count === undefined) return undefined
  return { date: record.date, consumed, recharged, count }
}

function readCreditDays(value: unknown): CreditDay[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const days: CreditDay[] = []
  for (const item of value.slice(-4000)) {
    const day = readCreditDay(item)
    if (!day) return undefined
    days.push(day)
  }
  return days
}

function readCreditUse(value: unknown): CreditUse[] {
  const record = asRecord(value)
  if (record === undefined) return []
  const amount = wholeCredit(record.amount)
  if (!amount || typeof record.id !== 'string' || typeof record.createdAt !== 'string') return []
  const model = typeof record.model === 'string' && record.model.length > 0 ? record.model : undefined
  return [{ id: record.id, amount, createdAt: record.createdAt, ...(model ? { model } : {}) }]
}

function isGrantKind(value: unknown): value is GrantKind {
  return value === 'checkin' || value === 'signup' || value === 'purchase' || value === 'adjustment'
}

function readCreditGrant(value: unknown): CreditGrant[] {
  const record = asRecord(value)
  if (record === undefined || !isGrantKind(record.kind)) return []
  const amount = wholeCredit(record.amount)
  if (!amount || typeof record.id !== 'string' || typeof record.createdAt !== 'string') return []
  return [{ id: record.id, amount, createdAt: record.createdAt, kind: record.kind }]
}

export function accountCredits(value: unknown): CreditSummary | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const consumed = wholeCredit(record.consumed)
  const recharged = wholeCredit(record.recharged)
  const usageCount = wholeCredit(record.usageCount)
  if (consumed === undefined || recharged === undefined || usageCount === undefined) return undefined
  if (!Array.isArray(record.consumption) || !Array.isArray(record.recharge)) return undefined
  const daily = readCreditDays(record.daily)
  if (!daily) return undefined
  return {
    consumed,
    recharged,
    usageCount,
    consumption: record.consumption.flatMap(readCreditUse),
    recharge: record.recharge.flatMap(readCreditGrant),
    daily
  }
}

export function shanghaiToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
}

export function shiftDate(iso: string, days: number): string {
  const [year = 0, month = 1, day = 1] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function rangeBounds(range: RangeKind, today: string, daily: CreditDay[]): [string, string] {
  if (range === 'today') return [today, today]
  if (range === 'yesterday') {
    const day = shiftDate(today, -1)
    return [day, day]
  }
  if (range === '30') return [shiftDate(today, -29), today]
  if (range === 'all') {
    const first = daily[0]?.date
    return [first && first < today ? first : today, today]
  }
  return [shiftDate(today, -6), today]
}

export function rangeStats(credits: CreditSummary, range: RangeKind): RangeStats {
  const daily = [...credits.daily].sort((left, right) => left.date < right.date ? -1 : left.date > right.date ? 1 : 0)
  const [start, end] = rangeBounds(range, shanghaiToday(), daily)
  const byDate = new Map(daily.map(day => [day.date, day]))
  const points: CreditDay[] = []
  let consumed = 0
  let recharged = 0
  let count = 0
  let cursor = start
  while (cursor <= end && points.length < 4000) {
    const day = byDate.get(cursor) ?? { date: cursor, consumed: 0, recharged: 0, count: 0 }
    consumed += day.consumed
    recharged += day.recharged
    count += day.count
    points.push(day)
    cursor = shiftDate(cursor, 1)
  }
  return { consumed, recharged, count, points: points.length > 400 ? points.slice(-400) : points }
}

export function formatWhen(value: string): string {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ''
  const date = new Date(time)
  const part = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())} ${part(date.getHours())}:${part(date.getMinutes())}`
}

export function formatCredits(value: number): string {
  if (!Number.isInteger(value)) return String(value)
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function phrase(t: Translate, key: string, vars?: Record<string, string | number>): string {
  const translated = t(key, vars)
  const value = typeof translated === 'string' ? translated : key
  if (!vars) return value
  return value.replace(/\{(\w+)\}/gu, (match, name: string) => {
    const replacement = vars[name]
    return replacement === undefined ? match : String(replacement)
  })
}

export function savingsPercent(price: ModelPrice): number | undefined {
  if (typeof price.savingsRatio !== 'number') return undefined
  const percent = Math.round(price.savingsRatio * 100)
  return percent >= 1 && percent <= 100 ? percent : undefined
}

export function saveLabel(t: Translate, percent: number): string {
  const label = phrase(t, 'priceSave', { percent: String(percent) })
  return label.includes(String(percent)) ? label : `${label} ${percent}%`
}

// Tick spacing follows d3-array (Copyright 2010-2023 Mike Bostock, ISC):
// https://github.com/d3/d3-array/blob/main/src/ticks.js
const TICK_E10 = Math.sqrt(50)
const TICK_E5 = Math.sqrt(10)
const TICK_E2 = Math.sqrt(2)

export function tickSpec(start: number, stop: number, count: number): [number, number, number] {
  const step = (stop - start) / Math.max(0, count)
  const power = Math.floor(Math.log10(step))
  const error = step / Math.pow(10, power)
  const factor = error >= TICK_E10 ? 10 : error >= TICK_E5 ? 5 : error >= TICK_E2 ? 2 : 1
  let i1: number
  let i2: number
  let inc: number
  if (power < 0) {
    inc = Math.pow(10, -power) / factor
    i1 = Math.round(start * inc)
    i2 = Math.round(stop * inc)
    if (i1 / inc < start) ++i1
    if (i2 / inc > stop) --i2
    inc = -inc
  } else {
    inc = Math.pow(10, power) * factor
    i1 = Math.round(start / inc)
    i2 = Math.round(stop / inc)
    if (i1 * inc < start) ++i1
    if (i2 * inc > stop) --i2
  }
  if (i2 < i1 && count >= 0.5 && count < 2) return tickSpec(start, stop, count * 2)
  return [i1, i2, inc]
}

export function axisTicks(start: number, stop: number, count: number): number[] {
  const reverse = stop < start
  const spec = reverse ? tickSpec(stop, start, count) : tickSpec(start, stop, count)
  const i1 = spec[0]
  const i2 = spec[1]
  const inc = spec[2]
  if (!(i2 >= i1)) return []
  const n = i2 - i1 + 1
  const values: number[] = []
  for (let index = 0; index < n; index += 1) {
    values.push(inc < 0 ? (i1 + index) / -inc : (i1 + index) * inc)
  }
  return reverse ? values.reverse() : values
}

export function niceCeiling(max: number, count: number): number {
  let start = 0
  let stop = max
  let previous: number | undefined
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const step = tickSpec(start, stop, count)[2]
    if (step === previous || step === 0 || !Number.isFinite(step)) break
    if (step > 0) {
      const i = Math.ceil(start / step)
      const j = Math.floor(stop / step)
      start = (i - (i * step > start ? 1 : 0)) * step
      stop = (j + (j * step < stop ? 1 : 0)) * step
    } else {
      const scale = -step
      const i = Math.ceil(start * scale)
      const j = Math.floor(stop * scale)
      start = (i - (i / scale > start ? 1 : 0)) / scale
      stop = (j + (j / scale < stop ? 1 : 0)) / scale
    }
    previous = step
  }
  return Math.max(stop, max)
}

export function formatTick(value: number): string {
  const nearest = Math.round(value)
  const shown = Math.abs(value - nearest) < 1e-6 ? nearest : Math.round(value * 10) / 10
  return Number.isInteger(shown) ? formatCredits(shown) : String(shown)
}

export function initialOf(email: string): string {
  const char = email.trim().charAt(0)
  return char ? char.toLocaleUpperCase() : ''
}

export function activeRange(range: string): RangeKind {
  if (range === 'today' || range === 'yesterday' || range === '30' || range === 'all') return range
  return '7'
}
