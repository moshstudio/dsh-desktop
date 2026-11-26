import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GatewayClient } from '../src/main/enterprise/gateway-client'
import { DesktopAccountService } from '../src/main/enterprise/account-service'
import { restoreBuiltinAccount } from '../src/main/enterprise/provider-config'
import { AccountSessionStore } from '../src/main/enterprise/session-store'

const directories: string[] = []
const listed = (id: string) => ({
  id,
  context_length: 200_000,
  top_provider: { max_completion_tokens: 8192 }
})
const box = {
  seal: async (plain: string) => Buffer.from(plain).toString('base64'),
  open: async (sealed: string) => Buffer.from(sealed, 'base64').toString()
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('gateway request deadline', () => {
  it.each(['headers', 'body'])('aborts a real HTTP request stalled at %s', async stage => {
    const server = createServer((_request, response) => {
      if (stage === 'body') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.write('{')
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing server address')
      const client = new GatewayClient(`http://127.0.0.1:${address.port}`, fetch, 100)
      await expect(client.models('access')).rejects.toThrow(/GET \/v1\/models timed out/u)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  it('retains the original transport error as cause', async () => {
    const failure = new Error('connection reset')
    const client = new GatewayClient('https://gateway.test', async () => { throw failure })
    await expect(client.balance('access')).rejects.toMatchObject({ cause: failure })
  })
})

describe('account profile partial failures', () => {
  it.each(['transport', 'http', 'empty', 'invalid'])('keeps authentication and existing provider after %s model failure, then recovers on prepareHost', async failure => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-account-reliable-'))
    directories.push(home)
    const profileDir = join(home, 'profile')
    const sessionFile = join(home, 'session.json')
    await restoreBuiltinAccount(profileDir, {
      baseURL: 'https://gateway.test/v1', models: [{ id: 'existing', name: 'existing', contextWindow: 200_000, maxTokens: 8192 }]
    })
    const patchPath = join(profileDir, 'cordis.patch.yml')
    const previous = await readFile(patchPath, 'utf8')
    const original = new Error('model connection lost')
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let recovered = false
    const fetchImpl: typeof fetch = async input => {
      const url = String(input)
      if (url.endsWith('/login') || url.endsWith('/refresh')) {
        return Response.json({ accessToken: 'access', refreshToken: 'refresh' })
      }
      if (url.endsWith('/models')) {
        if (recovered) return Response.json({ data: [listed('recovered')] })
        if (failure === 'transport') throw original
        if (failure === 'http') return Response.json({ error: 'models_offline', data: [{ id: 'wrong' }] }, { status: 503 })
        if (failure === 'empty') return Response.json({ data: [] })
        return Response.json({ invalid: true })
      }
      return Response.json({ balance: 0 })
    }
    const account = new DesktopAccountService({ gatewayUrl: 'https://gateway.test', sessionFile, profileDir, secretBox: box, hostReady: () => true, fetchImpl })
    await expect(account.login('owner@example.com', 'password')).resolves.toMatchObject({
      signedIn: true, balance: 0, models: [], needsRestart: true, message: 'profile_unavailable'
    })
    expect(await new AccountSessionStore(sessionFile, box).read()).toEqual({ email: 'owner@example.com', refreshToken: 'refresh' })
    const afterFailure = await readFile(patchPath, 'utf8')
    // Model sync failed, so the existing LLM provider stays. Web defaults still apply after sign-in.
    expect(afterFailure).toContain('existing')
    expect(afterFailure).toContain('https://gateway.test/v1')
    expect(afterFailure).toContain('searchProvider: taichi-search')
    expect(afterFailure).toContain('fetchProvider: taichi-fetch')
    expect(afterFailure).not.toContain('wrong')
    expect(afterFailure).not.toBe(previous)
    expect(diagnostic).toHaveBeenCalled()
    if (failure === 'transport') expect(diagnostic.mock.calls[0]?.[1]).toMatchObject({ cause: { kind: 'Error' } })
    recovered = true
    await expect(account.prepareHost()).resolves.toEqual({ TAICHI_GATEWAY_ACCESS_TOKEN: 'access' })
    expect(account.status()).toMatchObject({ models: [{ id: 'recovered', name: 'recovered' }], message: '' })
    expect(await readFile(patchPath, 'utf8')).toContain('recovered')
  })

  it.each(['transport', 'http', 'invalid'])('reports unknown balance after %s failure without retaining the previous account balance', async failure => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-account-balance-'))
    directories.push(home)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let failBalance = false
    const fetchImpl: typeof fetch = async input => {
      const url = String(input)
      if (url.endsWith('/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh' })
      if (url.endsWith('/models')) return Response.json({ data: [listed('demo')] })
      if (!failBalance) return Response.json({ balance: 40 })
      if (failure === 'transport') throw new Error('balance unavailable')
      if (failure === 'http') return Response.json({ balance: 99, error: 'offline' }, { status: 503 })
      return Response.json({ balance: 'unknown' })
    }
    const account = new DesktopAccountService({ gatewayUrl: 'https://gateway.test', sessionFile: join(home, 'session.json'), profileDir: join(home, 'profile'), secretBox: box, fetchImpl })
    expect((await account.login('first@example.com', 'password')).balance).toBe(40)
    failBalance = true
    await expect(account.login('second@example.com', 'password')).resolves.toMatchObject({
      signedIn: true, email: 'second@example.com', balance: null, models: [{ id: 'demo', name: 'demo' }], message: 'profile_unavailable',
      profile: { models: 'ready', balance: 'failed' }, checkedIn: false
    })
  })

  it('keeps a model failure when check-in updates the balance, then clears it on refresh', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-account-refresh-'))
    directories.push(home)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let modelsReady = false
    const fetchImpl: typeof fetch = async input => {
      const url = String(input)
      if (url.endsWith('/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh' })
      if (url.endsWith('/models')) {
        return modelsReady ? Response.json({ data: [listed('demo')] }) : Response.json({ data: [] })
      }
      if (url.endsWith('/check-in')) return Response.json({ balance: 9 })
      return Response.json({ balance: 3 })
    }
    const account = new DesktopAccountService({ gatewayUrl: 'https://gateway.test', sessionFile: join(home, 'session.json'), profileDir: join(home, 'profile'), secretBox: box, fetchImpl })
    await expect(account.login('owner@example.com', 'password')).resolves.toMatchObject({
      signedIn: true, balance: 3, models: [], message: 'profile_unavailable',
      profile: { models: 'failed', balance: 'ready' }, checkedIn: false
    })
    await expect(account.checkIn()).resolves.toMatchObject({
      balance: 9, models: [], message: 'profile_unavailable',
      profile: { models: 'failed', balance: 'ready' }, checkedIn: true
    })
    modelsReady = true
    await expect(account.refresh()).resolves.toMatchObject({
      balance: 3, models: [{ id: 'demo', name: 'demo' }], message: '',
      profile: { models: 'ready', balance: 'ready' }, checkedIn: true
    })
  })

  it.each([
    ['today', () => new Date().toISOString(), true],
    ['an earlier day', () => '2020-01-01T00:00:00.000Z', false]
  ])('reports checkedIn from a check-in grant dated %s when the signed-in summary loads', async (_label, createdAt, checkedIn) => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-account-checkin-known-'))
    directories.push(home)
    const fetchImpl: typeof fetch = async input => {
      const url = String(input)
      if (url.endsWith('/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh' })
      if (url.endsWith('/models')) return Response.json({ data: [listed('demo')] })
      if (url.endsWith('/summary')) {
        return Response.json({
          consumed: 0,
          recharged: 100,
          usageCount: 0,
          consumption: [],
          recharge: [{ id: 'checkin-1', amount: 100, createdAt: createdAt(), kind: 'checkin' }]
        })
      }
      return Response.json({ balance: 40 })
    }
    const account = new DesktopAccountService({
      gatewayUrl: 'https://gateway.test',
      sessionFile: join(home, 'session.json'),
      profileDir: join(home, 'profile'),
      secretBox: box,
      fetchImpl
    })
    await expect(account.login('owner@example.com', 'password')).resolves.toMatchObject({
      signedIn: true,
      balance: 40,
      message: '',
      checkedIn,
      credits: { recharge: [{ id: 'checkin-1', kind: 'checkin' }] }
    })
  })

  it('keeps chat models when the image catalog fails and treats an empty video list as ready', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-account-media-'))
    directories.push(home)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchImpl: typeof fetch = async input => {
      const url = String(input)
      if (url.endsWith('/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh' })
      if (url.endsWith('/v1/images/models')) return Response.json({ error: 'offline' }, { status: 503 })
      if (url.endsWith('/v1/videos/models')) return Response.json({ data: [] })
      if (url.endsWith('/v1/models')) return Response.json({ data: [listed('demo')] })
      return Response.json({ balance: 4 })
    }
    const account = new DesktopAccountService({
      gatewayUrl: 'https://gateway.test',
      sessionFile: join(home, 'session.json'),
      profileDir: join(home, 'profile'),
      secretBox: box,
      fetchImpl
    })
    await expect(account.login('owner@example.com', 'password')).resolves.toMatchObject({
      signedIn: true,
      models: [{ id: 'demo', name: 'demo' }],
      imageModels: [],
      videoModels: [],
      message: '',
      profile: { models: 'ready', balance: 'ready', images: 'failed', videos: 'ready' }
    })
    await expect(account.logout()).resolves.toMatchObject({
      signedIn: false,
      models: [],
      imageModels: [],
      videoModels: []
    })
  })
})


describe('host preparation state', () => {
  it.each(['http', 'transport', 'invalid', 'unauthorized'])('clears stale login state after %s refresh failure and preserves only recoverable sessions', async failure => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-account-prepare-'))
    directories.push(home)
    const sessionFile = join(home, 'session.json')
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let recovered = false
    const fetchImpl: typeof fetch = async input => {
      const url = String(input)
      if (url.endsWith('/refresh') && !recovered) {
        if (failure === 'transport') throw new Error('secret-access-token', { cause: Object.assign(new Error('secret-refresh-token'), { code: 'ECONNRESET' }) })
        if (failure === 'invalid') return Response.json({ accessToken: '' })
        return Response.json({ error: 'secret-response-token' }, { status: failure === 'unauthorized' ? 401 : 503 })
      }
      if (url.endsWith('/login') || url.endsWith('/refresh')) return Response.json({ accessToken: 'access', refreshToken: 'refresh' })
      if (url.endsWith('/models')) return Response.json({ data: [listed('demo')] })
      return Response.json({ balance: 40 })
    }
    const account = new DesktopAccountService({ gatewayUrl: 'https://gateway.test', sessionFile, profileDir: join(home, 'profile'), secretBox: box, hostReady: () => true, fetchImpl })
    expect(await account.login('owner@example.com', 'password')).toMatchObject({ signedIn: true, needsRestart: true })
    await expect(account.prepareHost()).resolves.toEqual({})
    expect(account.status()).toMatchObject({ signedIn: false, email: '', balance: null, models: [], needsRestart: false, message: failure === 'unauthorized' ? 'unauthorized' : 'unavailable' })
    const stored = await new AccountSessionStore(sessionFile, box).read()
    if (failure === 'unauthorized') expect(stored).toBeUndefined()
    else {
      expect(stored).toEqual({ email: 'owner@example.com', refreshToken: 'refresh' })
      if (failure === 'http') expect(diagnostic.mock.calls[0]?.[1]).toMatchObject({ status: 503 })
      if (failure === 'transport') expect(JSON.stringify(diagnostic.mock.calls)).toContain('ECONNRESET')
      recovered = true
      await expect(account.prepareHost()).resolves.toEqual({ TAICHI_GATEWAY_ACCESS_TOKEN: 'access' })
      expect(account.status()).toMatchObject({ signedIn: true, needsRestart: false, message: '' })
    }
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('secret-')
  })

  it('clears an old restart marker when logging out after the host stopped', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-account-logout-'))
    directories.push(home)
    let ready = true
    const fetchImpl: typeof fetch = async input => {
      const url = String(input)
      if (url.endsWith('/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh' })
      if (url.endsWith('/models')) return Response.json({ data: [listed('demo')] })
      return Response.json({ balance: 40 })
    }
    const account = new DesktopAccountService({ gatewayUrl: 'https://gateway.test', sessionFile: join(home, 'session.json'), profileDir: join(home, 'profile'), secretBox: box, hostReady: () => ready, fetchImpl })
    expect((await account.login('owner@example.com', 'password')).needsRestart).toBe(true)
    ready = false
    expect(await account.logout()).toMatchObject({ signedIn: false, needsRestart: false, message: '' })
  })
})
