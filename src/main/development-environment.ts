/**
 * Unpackaged Windows development deadlocks in `@deepseek-ai/dsh-hmr`:
 * the watcher never becomes ready, so profile boot never finishes.
 * Packaged launches keep the upstream service.
 */
export function skipBlockingWindowsDevHmr(packaged: boolean, platform: NodeJS.Platform): boolean {
  return !packaged && platform === 'win32'
}

/**
 * Local account HTTP API. 5432 is the gateway's Postgres; the HTTP routes listen on 8787.
 * `GET /health` returns `{ ok: true }` only when that process and its database are up.
 */
export const DEVELOPMENT_GATEWAY_URL = 'http://127.0.0.1:8787'

/** Public account gateway used when the local process is not healthy. */
export const PRODUCTION_GATEWAY_URL = 'https://taichi-gateway.moshangwangluo.com'

const LOCAL_GATEWAY_PROBE_MS = 1_000

export interface GatewayUrlProbe {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  localUrl?: string
  productionUrl?: string
}

function configuredGatewayUrl(env: NodeJS.ProcessEnv): string | undefined {
  const configured = env.TAICHI_GATEWAY_URL?.trim().replace(/\/$/u, '')
  return configured === undefined || configured === '' ? undefined : configured
}

function healthyGateway(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'ok' in body && body.ok === true
}

/** A local listener that is not the healthy account gateway must not capture the session. */
async function localGatewayReady(localUrl: string, probe: GatewayUrlProbe): Promise<boolean> {
  const fetchImpl = probe.fetchImpl ?? fetch
  const timeoutMs = probe.timeoutMs ?? LOCAL_GATEWAY_PROBE_MS
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    const response = await fetchImpl(`${localUrl}/health`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal
    })
    if (!response.ok) return false
    return healthyGateway(await response.json())
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Explicit `TAICHI_GATEWAY_URL` wins. Otherwise both unpackaged and installed
 * launches use the local gateway when its health check succeeds, and the
 * production gateway when it does not.
 */
export async function resolveGatewayUrl(env: NodeJS.ProcessEnv = process.env, probe: GatewayUrlProbe = {}): Promise<string> {
  const configured = configuredGatewayUrl(env)
  if (configured) return configured
  const localUrl = probe.localUrl ?? DEVELOPMENT_GATEWAY_URL
  const productionUrl = probe.productionUrl ?? PRODUCTION_GATEWAY_URL
  return (await localGatewayReady(localUrl, probe)) ? localUrl : productionUrl
}

/** Development overrides isolate concurrent worktrees without changing production identity. */
export function developmentEnvironment(development: boolean, defaultHarnessPort: number, env: NodeJS.ProcessEnv = process.env): {
  profile: string
  harnessPort: number
  mobilePort: number
} {
  if (!development) return { profile: 'taichi-dsh', harnessPort: defaultHarnessPort, mobilePort: 43127 }
  const profile = env.DSH_DEV_PROFILE || 'taichi-dsh-dev'
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(profile) || profile === 'taichi-dsh') {
    throw new Error('DSH_DEV_PROFILE must be a separate development directory name.')
  }
  const port = (value: string | undefined, fallback: number, name: string): number => {
    if (!value) return fallback
    const parsed = Number(value)
    if (!/^\d+$/.test(value) || !Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
      throw new Error(`${name} must be an integer from 1024 to 65535.`)
    }
    return parsed
  }
  const harnessPort = port(env.DSH_DEV_HARNESS_PORT, defaultHarnessPort + 1, 'DSH_DEV_HARNESS_PORT')
  const mobilePort = port(env.DSH_DEV_MOBILE_PORT, 43128, 'DSH_DEV_MOBILE_PORT')
  if (harnessPort === mobilePort) throw new Error('Development Harness and mobile ports must differ.')
  return { profile, harnessPort, mobilePort }
}
