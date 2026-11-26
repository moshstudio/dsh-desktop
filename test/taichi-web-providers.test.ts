import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveTaichiWebGateway } from '../packages/dsh-taichi-web/src/env.ts'
import { TaichiFetchProvider } from '../packages/dsh-taichi-web/src/fetch.ts'
import { TaichiSearchProvider } from '../packages/dsh-taichi-web/src/search.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('taichi web providers', () => {
  it('exposes a string title and bilingual description for the picker', () => {
    // dsh-web types title as string; the settings card renders it as a React
    // child. A {en,zh} object crashes plugins.item (React #31) and blanks the page.
    const search = new TaichiSearchProvider(() => ({}), { count: 10, searchRequestsPerSecond: 5 })
    const fetch = new TaichiFetchProvider(() => ({}))
    for (const provider of [search, fetch]) {
      expect(typeof provider.title).toBe('string')
      expect(provider.title.length).toBeGreaterThan(0)
      expect(provider.description).toMatchObject({
        en: expect.any(String),
        zh: expect.any(String),
      })
    }
  })

  it('is unavailable without url or token', () => {
    expect(resolveTaichiWebGateway({}).ok).toBe(false)
    expect(new TaichiSearchProvider(() => ({}), { count: 10, searchRequestsPerSecond: 5 }).available()).toBe(false)
    expect(new TaichiFetchProvider(() => ({})).available()).toBe(false)
  })

  it('searches with bearer auth and maps results', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [{ url: 'https://example.com', title: 'Ex', snippet: 'snip', summary: 'sum', date: null }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new TaichiSearchProvider(() => ({
      TAICHI_GATEWAY_URL: 'https://gw.example',
      TAICHI_GATEWAY_ACCESS_TOKEN: 'tok',
    }), { count: 10, searchRequestsPerSecond: 5 })
    const result = await provider.search({ query: 'q', maxResults: 3 })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://gw.example/v1/tools/search')
    expect(init?.headers).toMatchObject({ authorization: 'Bearer tok' })
    expect(JSON.parse(String(init?.body))).toMatchObject({ query: 'q', count: 3, need_content: false })
    expect(result.sources[0]?.url).toBe('https://example.com')
  })

  it('fetches markdown content', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: '# Hi' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new TaichiFetchProvider(() => ({
      TAICHI_GATEWAY_URL: 'https://gw.example/',
      TAICHI_GATEWAY_ACCESS_TOKEN: 'tok',
    }))
    const result = await provider.fetch({ url: 'https://page.example' })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://gw.example/v1/tools/fetch')
    expect(result).toEqual({
      url: 'https://page.example',
      statusCode: 200,
      body: { kind: 'text', content: '# Hi' },
      truncated: false,
    })
  })

  it('maps 401 to WEB_PROVIDER_ERROR with sign-in guidance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'x' }), { status: 401 })))
    const provider = new TaichiFetchProvider(() => ({
      TAICHI_GATEWAY_URL: 'https://gw.example',
      TAICHI_GATEWAY_ACCESS_TOKEN: 'tok',
    }))
    await expect(provider.fetch({ url: 'https://page.example' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
    })
    try {
      await provider.fetch({ url: 'https://page.example' })
    } catch (error) {
      expect(String(error)).toMatch(/sign in/i)
    }
  })

  it('maps 402 to WEB_PROVIDER_ERROR with credit guidance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'x' }), { status: 402 })))
    const provider = new TaichiFetchProvider(() => ({
      TAICHI_GATEWAY_URL: 'https://gw.example',
      TAICHI_GATEWAY_ACCESS_TOKEN: 'tok',
    }))
    await expect(provider.fetch({ url: 'https://page.example' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
    })
    try {
      await provider.fetch({ url: 'https://page.example' })
    } catch (error) {
      expect(String(error)).toMatch(/credit/i)
    }
  })
})
