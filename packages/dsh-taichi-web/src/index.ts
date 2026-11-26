/**
 * Register Taichi gateway Search and Fetch APIs in `ctx.web` as `taichi-search`
 * and `taichi-fetch`. Protocol matches DeepSeek `/v1/tools`; credentials come
 * from `TAICHI_GATEWAY_URL` and `TAICHI_GATEWAY_ACCESS_TOKEN`.
 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-web'
import z from '@deepseek-ai/schemastery'
import { TaichiFetchProvider } from './fetch.ts'
import { TaichiSearchProvider } from './search.ts'

export { TAICHI_FETCH_PROVIDER_ID, TAICHI_SEARCH_PROVIDER_ID, resolveTaichiWebGateway } from './env.ts'
export { TaichiFetchProvider } from './fetch.ts'
export { mapSearchResponse, TaichiSearchProvider } from './search.ts'

export const name = 'dsh-taichi-web'
export const inject = ['web']

export interface Config {
  count: Volatile<number>
  searchRequestsPerSecond: Volatile<number>
}

export const Config = z.object({
  count: z.number().step(1).min(1).max(50).default(10).volatile(),
  searchRequestsPerSecond: z.number().step(1).min(1).default(5).volatile(),
})

export function apply(ctx: Context, config: Config): void {
  const resolveEnv = (): NodeJS.ProcessEnv => process.env
  ctx.web.registerSearchProvider(new TaichiSearchProvider(resolveEnv, {
    get count() { return config.count.get() },
    get searchRequestsPerSecond() { return config.searchRequestsPerSecond.get() },
  }))
  ctx.web.registerFetchProvider(new TaichiFetchProvider(resolveEnv))
}
