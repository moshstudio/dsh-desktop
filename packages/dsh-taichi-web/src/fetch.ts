import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import { TAICHI_FETCH_PROVIDER_ID } from './env.ts'
import { dispatchTaichiWeb, invalidResponse, isRecord } from './transport.ts'

export class TaichiFetchProvider implements WebFetchProvider {
  readonly id = TAICHI_FETCH_PROVIDER_ID
  readonly title = { en: 'Taichi', zh: '太极' }
  readonly description = {
    en: 'Uses the signed-in Taichi account credits. Cannot reach intranet or local addresses. Requires sign-in.',
    zh: '使用已登录的太极账号积分。无法访问内网和本机。需要登录。',
  }

  constructor(private readonly resolveEnv: () => NodeJS.ProcessEnv) {}

  available(): boolean {
    const env = this.resolveEnv()
    const url = typeof env.TAICHI_GATEWAY_URL === 'string' ? env.TAICHI_GATEWAY_URL.trim() : ''
    const token = typeof env.TAICHI_GATEWAY_ACCESS_TOKEN === 'string' ? env.TAICHI_GATEWAY_ACCESS_TOKEN.trim() : ''
    return url.length > 0 && token.length > 0
  }

  async ready(): Promise<boolean> {
    return this.available()
  }

  fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    return dispatchTaichiWeb(this.resolveEnv(), '/fetch', { url: request.url }, (payload): WebFetchResult => {
      if (!isRecord(payload) || typeof payload.content !== 'string') throw invalidResponse()
      return {
        url: request.url,
        statusCode: 200,
        body: { kind: 'text', content: payload.content },
        truncated: false,
      }
    }, signal)
  }
}
