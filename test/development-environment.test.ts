import { describe, expect, it } from 'vitest'
import { DEVELOPMENT_GATEWAY_URL, developmentEnvironment, PRODUCTION_GATEWAY_URL, resolveGatewayUrl, skipBlockingWindowsDevHmr } from '../src/main/development-environment'

describe('development worktree isolation', () => {
  it('keeps defaults and ignores development overrides in production', () => {
    expect(developmentEnvironment(false, 43129, { DSH_DEV_PROFILE: '../unsafe', DSH_DEV_HARNESS_PORT: 'invalid' }))
      .toEqual({ profile: 'taichi-dsh', harnessPort: 43129, mobilePort: 43127 })
    expect(developmentEnvironment(true, 43129, {}))
      .toEqual({ profile: 'taichi-dsh-dev', harnessPort: 43130, mobilePort: 43128 })
  })

  it('uses distinct profile and loopback ports for a second worktree', () => {
    expect(developmentEnvironment(true, 43129, {
      DSH_DEV_PROFILE: 'dsh-desktop-dev-workbench', DSH_DEV_HARNESS_PORT: '43132', DSH_DEV_MOBILE_PORT: '43133'
    })).toEqual({ profile: 'dsh-desktop-dev-workbench', harnessPort: 43132, mobilePort: 43133 })
  })

  it.each(['../profile', '/tmp/profile', 'a/b', 'a\\b', 'taichi-dsh', '..'])('rejects unsafe profile %s', profile => {
    expect(() => developmentEnvironment(true, 43129, { DSH_DEV_PROFILE: profile })).toThrow('DSH_DEV_PROFILE')
  })

  it.each(['0', '1023', '65536', '-1', '12.5', 'invalid', ' 43132 '])('rejects invalid port %s', value => {
    expect(() => developmentEnvironment(true, 43129, { DSH_DEV_HARNESS_PORT: value })).toThrow('DSH_DEV_HARNESS_PORT')
    expect(() => developmentEnvironment(true, 43129, { DSH_DEV_MOBILE_PORT: value })).toThrow('DSH_DEV_MOBILE_PORT')
  })

  it('skips the blocking HMR service only for unpackaged Windows development', () => {
    expect(skipBlockingWindowsDevHmr(true, 'win32')).toBe(false)
    expect(skipBlockingWindowsDevHmr(false, 'darwin')).toBe(false)
    expect(skipBlockingWindowsDevHmr(false, 'linux')).toBe(false)
    expect(skipBlockingWindowsDevHmr(false, 'win32')).toBe(true)
  })

  it('uses a healthy local gateway before production for every launch', async () => {
    expect(DEVELOPMENT_GATEWAY_URL).toBe('http://127.0.0.1:8787')
    expect(PRODUCTION_GATEWAY_URL).toBe('https://taichi-gateway.moshangwangluo.com')
    const calls: string[] = []
    const fetchImpl: typeof fetch = async input => {
      calls.push(String(input))
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    await expect(resolveGatewayUrl({}, { fetchImpl })).resolves.toBe(DEVELOPMENT_GATEWAY_URL)
    expect(calls).toEqual([`${DEVELOPMENT_GATEWAY_URL}/health`])
  })

  it('uses production when the local gateway is missing or unhealthy', async () => {
    const refused: typeof fetch = async () => { throw new Error('connect ECONNREFUSED') }
    const unavailable: typeof fetch = async () => new Response(JSON.stringify({ ok: false }), { status: 503 })
    const stranger: typeof fetch = async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })
    await expect(resolveGatewayUrl({}, { fetchImpl: refused })).resolves.toBe(PRODUCTION_GATEWAY_URL)
    await expect(resolveGatewayUrl({}, { fetchImpl: unavailable })).resolves.toBe(PRODUCTION_GATEWAY_URL)
    await expect(resolveGatewayUrl({}, { fetchImpl: stranger })).resolves.toBe(PRODUCTION_GATEWAY_URL)
  })

  it('stops waiting for a local gateway that never answers', async () => {
    const stalled: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
    })
    await expect(resolveGatewayUrl({}, { fetchImpl: stalled, timeoutMs: 20 })).resolves.toBe(PRODUCTION_GATEWAY_URL)
  })

  it('keeps an explicit gateway address ahead of the probe', async () => {
    const fetchImpl: typeof fetch = async () => { throw new Error('probe should not run') }
    await expect(resolveGatewayUrl({ TAICHI_GATEWAY_URL: ' https://gateway.example/ ' }, { fetchImpl })).resolves.toBe('https://gateway.example')
    await expect(resolveGatewayUrl({ TAICHI_GATEWAY_URL: '   ' }, { fetchImpl: async () => new Response(JSON.stringify({ ok: true })) })).resolves.toBe(DEVELOPMENT_GATEWAY_URL)
  })

  it('rejects colliding service ports', () => {
    expect(() => developmentEnvironment(true, 43129, { DSH_DEV_MOBILE_PORT: '43130' })).toThrow('must differ')
  })
})
