import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { TAICHI_SEARCH_PROVIDER_ID } from './env.ts'
import { dispatchTaichiWeb, invalidResponse, isRecord, requestAborted } from './transport.ts'

const ORIGINAL_QUESTION_MAX_CHARS = 128

export interface TaichiSearchLimits {
  count: number
  searchRequestsPerSecond: number
  originalQuestion?: () => string | undefined
}

export function mapSearchResponse(response: unknown): WebSearchResult {
  if (!isRecord(response) || !Array.isArray(response.results)) throw invalidResponse()
  const sources = response.results.map((item: unknown) => {
    if (!isRecord(item) || typeof item.url !== 'string' || item.url.length === 0
      || typeof item.title !== 'string' || typeof item.snippet !== 'string'
      || (item.summary !== undefined && typeof item.summary !== 'string')
      || (item.date !== null && typeof item.date !== 'string')) throw invalidResponse()
    return {
      url: item.url,
      ...item.title.length > 0 ? { title: item.title } : {},
      ...item.snippet.length > 0 ? { snippet: item.snippet } : {},
      ...typeof item.summary === 'string' && item.summary.length > 0 ? { summary: item.summary } : {},
      ...item.date !== null && item.date.length > 0 ? { publishedAt: item.date } : {},
    }
  })
  return { sources, truncated: false }
}

function boundedQuestion(question: string | undefined): string | undefined {
  const collapsed = question?.replace(/\s+/gu, ' ').trim() ?? ''
  if (collapsed.length === 0) return undefined
  return Array.from(collapsed).slice(0, ORIGINAL_QUESTION_MAX_CHARS).join('')
}

export class TaichiSearchProvider implements WebSearchProvider {
  readonly id = TAICHI_SEARCH_PROVIDER_ID
  readonly title = { en: 'Taichi', zh: '太极' }
  readonly description = {
    en: 'Uses the signed-in Taichi account credits. Cannot reach intranet or local addresses. Requires sign-in.',
    zh: '使用已登录的太极账号积分。无法访问内网和本机。需要登录。',
  }

  private readonly starts: number[] = []

  constructor(
    private readonly resolveEnv: () => NodeJS.ProcessEnv,
    private readonly limits: TaichiSearchLimits,
  ) {}

  available(): boolean {
    const env = this.resolveEnv()
    const url = typeof env.TAICHI_GATEWAY_URL === 'string' ? env.TAICHI_GATEWAY_URL.trim() : ''
    const token = typeof env.TAICHI_GATEWAY_ACCESS_TOKEN === 'string' ? env.TAICHI_GATEWAY_ACCESS_TOKEN.trim() : ''
    return url.length > 0 && token.length > 0
      && Number.isInteger(this.limits.count) && this.limits.count > 0
      && Number.isInteger(this.limits.searchRequestsPerSecond) && this.limits.searchRequestsPerSecond > 0
  }

  async ready(): Promise<boolean> {
    return this.available()
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const question = boundedQuestion(this.limits.originalQuestion?.())
    await this.waitForRequestSlot(this.limits.searchRequestsPerSecond, signal)
    return dispatchTaichiWeb(this.resolveEnv(), '/search', {
      query: request.query,
      count: Math.min(this.limits.count, request.maxResults ?? this.limits.count),
      need_content: false,
      ...question === undefined ? {} : { ori_question: question },
    }, mapSearchResponse, signal)
  }

  private async waitForRequestSlot(limit: number, signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted === true) throw requestAborted(signal)
      const now = performance.now()
      let oldest = this.starts[0]
      while (oldest !== undefined && oldest < now - 1000) {
        this.starts.shift()
        oldest = this.starts[0]
      }
      if (oldest === undefined || this.starts.length < limit) {
        this.starts.push(now)
        return
      }
      await abortableDelay(oldest + 1001 - now, signal)
    }
  }
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
