import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopAccountService } from '../src/main/enterprise/account-service'
import { alipayQrPayload } from '../src/main/enterprise/payment-link'

const directories: string[] = []
const box = {
  seal: async (plain: string) => Buffer.from(plain).toString('base64'),
  open: async (sealed: string) => Buffer.from(sealed, 'base64').toString()
}
const listed = { id: 'demo', context_length: 200_000, top_provider: { max_completion_tokens: 8192 } }
const orderId = '11111111-1111-4111-8111-111111111111'

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('account purchase', () => {
  it('asks the gateway for a listed amount and keeps other amounts local', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-account-purchase-'))
    directories.push(home)
    const bodies: string[] = []
    const packageBodies: string[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh' })
      if (url.endsWith('/models')) return Response.json({ data: [listed] })
      if (url.endsWith('/packages')) {
        packageBodies.push(`${init?.method ?? 'GET'} /v1/credits/packages`)
        return Response.json({ packages: [{ yuan: 50, credits: 40_000 }], paymentAvailable: true })
      }
      if (url.endsWith('/orders') && init?.method === 'POST') {
        bodies.push(String(init.body))
        return Response.json({
          orderId,
          yuan: 99,
          credits: 99_000,
          qrCode: 'https://openapi.alipay.com/gateway.do?method=alipay.trade.page.pay&sign_type=RSA2&sign=test',
          status: 'pending'
        })
      }
      if (url.endsWith(`/orders/${orderId}`)) {
        return Response.json({ orderId, yuan: 99, credits: 99_000, status: 'paid' })
      }
      return Response.json({ balance: 0 })
    }
    const account = new DesktopAccountService({
      gatewayUrl: 'https://gateway.test',
      sessionFile: join(home, 'session.json'),
      profileDir: join(home, 'profile'),
      secretBox: box,
      fetchImpl
    })
    await account.login('owner@example.com', 'password')
    await expect(account.purchase(10.5)).resolves.toEqual({ ok: false, message: 'invalid_amount', order: null })
    expect(bodies).toEqual([])
    await expect(account.packages()).resolves.toEqual({
      packages: [{ yuan: 50, credits: 40_000 }],
      paymentAvailable: true,
      message: ''
    })
    expect(packageBodies).toEqual(['GET /v1/credits/packages'])
    await expect(account.purchase(99)).resolves.toMatchObject({
      ok: true,
      order: { orderId, yuan: 99, credits: 99_000, status: 'pending', qrCode: 'https://openapi.alipay.com/gateway.do?method=alipay.trade.page.pay&sign_type=RSA2&sign=test' }
    })
    expect(bodies).toEqual(['{"yuan":"99"}'])
    await expect(account.purchaseStatus(orderId)).resolves.toEqual({
      ok: true,
      message: '',
      order: { orderId, yuan: 99, credits: 99_000, status: 'paid' }
    })
  })

  it('keeps payment failures distinct and does not invent package prices', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-account-purchase-'))
    directories.push(home)
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh' })
      if (url.endsWith('/models')) return Response.json({ data: [listed] })
      if (url.endsWith('/packages')) return Response.json({ error: 'payment_provider_unavailable' }, { status: 503 })
      if (url.endsWith('/orders') && init?.method === 'POST') return Response.json({ error: 'payment_unconfigured' }, { status: 503 })
      return Response.json({ balance: 0 })
    }
    const account = new DesktopAccountService({
      gatewayUrl: 'https://gateway.test',
      sessionFile: join(home, 'session.json'),
      profileDir: join(home, 'profile'),
      secretBox: box,
      fetchImpl
    })
    await account.login('owner@example.com', 'password')
    await expect(account.packages()).resolves.toEqual({ packages: null, paymentAvailable: false, message: 'payment_provider_unavailable' })
    await expect(account.purchase(50)).resolves.toEqual({ ok: false, message: 'payment_unconfigured', order: null })
    await expect(account.purchase(0)).resolves.toEqual({ ok: false, message: 'invalid_amount', order: null })
  })

  it('rejects a malformed package list instead of rendering a local price', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-account-purchase-'))
    directories.push(home)
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh' })
      if (url.endsWith('/models')) return Response.json({ data: [listed] })
      if (url.endsWith('/packages')) return Response.json({ packages: [{ yuan: 39, credits: 39_000 }, { yuan: 39, credits: 1 }], paymentAvailable: true })
      return Response.json({ balance: 0 })
    }
    const account = new DesktopAccountService({
      gatewayUrl: 'https://gateway.test',
      sessionFile: join(home, 'session.json'),
      profileDir: join(home, 'profile'),
      secretBox: box,
      fetchImpl
    })
    await account.login('owner@example.com', 'password')
    await expect(account.packages()).resolves.toEqual({ packages: null, paymentAvailable: false, message: 'order_response_invalid' })
  })

  it('rejects an order whose amount or code does not match the request', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-account-purchase-'))
    directories.push(home)
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh' })
      if (url.endsWith('/models')) return Response.json({ data: [listed] })
      if (url.endsWith('/orders') && init?.method === 'POST') {
        return Response.json({ orderId, yuan: 80, credits: 70_000, qrCode: 'https://example.com/not-alipay', status: 'pending' })
      }
      return Response.json({ balance: 0 })
    }
    const account = new DesktopAccountService({
      gatewayUrl: 'https://gateway.test',
      sessionFile: join(home, 'session.json'),
      profileDir: join(home, 'profile'),
      secretBox: box,
      fetchImpl
    })
    await account.login('owner@example.com', 'password')
    await expect(account.purchase(50)).resolves.toEqual({ ok: false, message: 'order_response_invalid', order: null })
  })

  it('only loads an official Alipay website payment page', () => {
    const page = 'https://openapi.alipay.com/gateway.do?method=alipay.trade.page.pay&sign_type=RSA2&sign=test'
    expect(alipayQrPayload(page)).toBe(page)
    expect(alipayQrPayload('http://openapi.alipay.com/gateway.do?method=alipay.trade.page.pay&sign_type=RSA2&sign=test')).toBeUndefined()
    expect(alipayQrPayload('https://user:secret@openapi.alipay.com/gateway.do?method=alipay.trade.page.pay&sign_type=RSA2&sign=test')).toBeUndefined()
    expect(alipayQrPayload('https://qr.alipay.com/bax00000test')).toBeUndefined()
    expect(alipayQrPayload('https://openapi.alipay.com/gateway.do?method=alipay.trade.precreate&sign_type=RSA2&sign=test')).toBeUndefined()
    expect(alipayQrPayload('not a url')).toBeUndefined()
  })
})