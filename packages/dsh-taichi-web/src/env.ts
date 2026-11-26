export const TAICHI_SEARCH_PROVIDER_ID = 'taichi-search'
export const TAICHI_FETCH_PROVIDER_ID = 'taichi-fetch'

export const TAICHI_WEB_TOOLS_PREFIX = '/v1/tools'

export type TaichiWebGateway =
  | { ok: true; baseURL: string; token: string }
  | { ok: false }

/** Read gateway URL and access token from the Host environment. */
export function resolveTaichiWebGateway(env: NodeJS.ProcessEnv = process.env): TaichiWebGateway {
  const base = typeof env.TAICHI_GATEWAY_URL === 'string'
    ? env.TAICHI_GATEWAY_URL.trim().replace(/\/$/u, '')
    : ''
  const token = typeof env.TAICHI_GATEWAY_ACCESS_TOKEN === 'string'
    ? env.TAICHI_GATEWAY_ACCESS_TOKEN.trim()
    : ''
  if (base.length === 0 || token.length === 0) return { ok: false }
  return { ok: true, baseURL: base, token }
}
