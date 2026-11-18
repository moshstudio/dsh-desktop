import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validatePluginSwitch } from 'dsh-desktop-market-installer/plugin-state'
import { DesktopAccountService } from '../src/main/enterprise/account-service'
import { readGatewayModels } from '../src/main/enterprise/gateway-client'
import { ensureTaichiProvider, restoreBuiltinAccount, stripDisabledAccountRows } from '../src/main/enterprise/provider-config'
import { AccountSessionStore, type SecretBox } from '../src/main/enterprise/session-store'
import { readDisabledHostPlugins, setHostPluginEnabled } from '../src/main/profile/host-plugin-state'
import { DESKTOP_SAFE_PRODUCT_PATCH, buildDesktopProductPatch } from '../src/main/shell/product-patch'
import { ACCOUNT_ACCESS_ENV, ACCOUNT_PLUGIN_NAME } from '../src/shared/account-gateway'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const listed = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  context_length: 200_000,
  top_provider: { max_completion_tokens: 8192 },
  ...extra
})

const box: SecretBox = {
  seal: async plain => Buffer.from(plain, 'utf8').toString('base64'),
  open: async sealed => Buffer.from(sealed, 'base64').toString('utf8')
}

describe('builtin account gateway', () => {
  it('reads the display name the official listing uses when name is absent', () => {
    const models = readGatewayModels({ data: [listed('gpt-6.1-sol', { display_name: 'GPT 6.1 Sol' })] })
    expect(models.map(model => model.name)).toEqual(['GPT 6.1 Sol'])
  })

  it('mounts the account plugin in both product patches and refuses removal', async () => {
    expect(buildDesktopProductPatch()).toContain('name: dsh-desktop-account')
    expect(DESKTOP_SAFE_PRODUCT_PATCH).toContain('name: dsh-desktop-account')
    const home = await mkdtemp(join(tmpdir(), 'dsh-account-'))
    directories.push(home)
    await expect(validatePluginSwitch(home, ACCOUNT_PLUGIN_NAME, false)).rejects.toThrow(/cannot be disabled/u)
    await setHostPluginEnabled(home, ACCOUNT_PLUGIN_NAME, false)
    expect(await readDisabledHostPlugins(home)).not.toContain(ACCOUNT_PLUGIN_NAME)
  })

  it('keeps other model providers while installing the gateway provider', async () => {
    const source = `- id: custom
  config:
    root: !!js dshHomePath('kept')
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      own:
        api: openai-completions
        baseURL: https://example.test/v1
`
    const disabled = stripDisabledAccountRows(`- id: ${ACCOUNT_PLUGIN_NAME}\n  disabled: true\n${source}`)
    expect(disabled.text).not.toContain(ACCOUNT_PLUGIN_NAME)
    expect(disabled.text).toContain('dshHomePath')
    const merged = ensureTaichiProvider(source, {
      baseURL: 'https://gateway.test/v1',
      models: [{ id: 'demo-chat', name: 'demo-chat', contextWindow: 200_000, maxTokens: 8192 }]
    })
    expect(merged.text).toContain('apiKeyEnv: TAICHI_GATEWAY_ACCESS_TOKEN')
    expect(merged.text).toContain(ACCOUNT_ACCESS_ENV)
    expect(merged.text).toContain('baseURL: https://example.test/v1')
    expect(merged.text).toContain('baseURL: https://gateway.test/v1')
    expect(merged.text).toContain("dshHomePath('kept')")
  })

  it('stores only a sealed refresh token and writes the provider after login', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-account-session-'))
    directories.push(home)
    const profile = join(home, 'profile')
    const store = new AccountSessionStore(join(home, 'account-session.json'), box)
    await store.write({ refreshToken: 'refresh-secret', email: 'owner@example.com' })
    const onDisk = await readFile(join(home, 'account-session.json'), 'utf8')
    expect(onDisk).not.toContain('refresh-secret')
    expect(await store.read()).toEqual({ refreshToken: 'refresh-secret', email: 'owner@example.com' })

    const calls: string[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      calls.push(url)
      const body = JSON.parse(String(init?.body ?? '{}')) as { refreshToken?: string }
      if (url.endsWith('/login')) {
        return new Response(JSON.stringify({ accessToken: 'access-secret', refreshToken: 'refresh-next' }), { status: 200 })
      }
      if (url.endsWith('/refresh')) {
        expect(body.refreshToken).toBe('refresh-next')
        return new Response(JSON.stringify({ accessToken: 'access-host', refreshToken: 'refresh-host' }), { status: 200 })
      }
      if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [listed('demo-chat', {
        name: 'Demo Chat',
        architecture: { input_modalities: ['text', 'image', 'file'] },
        reasoning: { mandatory: false, supported_efforts: ['high', 'none'], default_effort: 'none', default_enabled: false }
      })] }), { status: 200 })
      if (url.endsWith('/balance')) return new Response(JSON.stringify({ balance: 40 }), { status: 200 })
      return new Response('{}', { status: 404 })
    }
    const account = new DesktopAccountService({
      gatewayUrl: 'https://gateway.test',
      sessionFile: join(home, 'account-session.json'),
      profileDir: profile,
      secretBox: box,
      hostReady: () => true,
      fetchImpl
    })
    const status = await account.login('owner@example.com', 'correct-horse')
    expect(status.signedIn).toBe(true)
    expect(status.needsRestart).toBe(true)
    expect(status.balance).toBe(40)
    expect(status.models).toEqual(['demo-chat'])
    const patch = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('https://gateway.test/v1')
    expect(patch).toContain('demo-chat')
    expect(patch).toContain('contextWindow: 200000')
    expect(patch).toContain('maxTokens: 8192')
    expect(patch).toContain('image')
    expect(patch).toContain('thinkingFormat: openrouter')
    expect(patch).toContain('off: none')
    expect(patch).not.toContain('1000000')
    expect(patch).not.toContain('128000')
    expect(patch).not.toContain('access-secret')
    const prepared = await account.prepareHost()
    expect(prepared).toEqual({ TAICHI_GATEWAY_ACCESS_TOKEN: 'access-host' })
    expect(calls.some(url => url.endsWith('/refresh'))).toBe(true)
    await restoreBuiltinAccount(profile)
  })

  it('reports accepted mail steps, check-in, and a restart after sign-out', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-account-flow-'))
    directories.push(home)
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/register') || url.endsWith('/verify') || url.endsWith('/password-reset')) {
        return new Response(null, { status: 202 })
      }
      if (url.endsWith('/login')) {
        return new Response(JSON.stringify({ accessToken: 'access', refreshToken: 'refresh' }), { status: 200 })
      }
      if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [listed('demo-chat')] }), { status: 200 })
      if (url.endsWith('/balance')) return new Response(JSON.stringify({ balance: 40 }), { status: 200 })
      if (url.endsWith('/check-in')) return new Response(JSON.stringify({ balance: 41 }), { status: 200 })
      if (url.endsWith('/logout')) return new Response(null, { status: 204 })
      return new Response('{}', { status: 404 })
    }
    const account = new DesktopAccountService({
      gatewayUrl: 'https://gateway.test',
      sessionFile: join(home, 'account-session.json'),
      profileDir: join(home, 'profile'),
      secretBox: box,
      hostReady: () => true,
      fetchImpl
    })
    const registered = await account.register('owner@example.com', 'correct-horse')
    expect(registered).toMatchObject({ signedIn: false, message: 'accepted' })
    const verified = await account.verify('123456')
    expect(verified.message).toBe('accepted')
    const reset = await account.requestPasswordReset('owner@example.com')
    expect(reset.message).toBe('accepted')
    const confirmed = await account.confirmPasswordReset('123456', 'new-horse')
    expect(confirmed.message).toBe('accepted')
    const signedIn = await account.login('owner@example.com', 'new-horse')
    expect(signedIn.models).toEqual(['demo-chat'])
    const checked = await account.checkIn()
    expect(checked).toMatchObject({
      signedIn: true,
      balance: 41,
      message: 'checked_in',
      models: ['demo-chat'],
      checkedIn: true,
      profile: { models: 'ready', balance: 'ready' }
    })
    const signedOut = await account.logout()
    expect(signedOut).toMatchObject({
      signedIn: false,
      needsRestart: true,
      message: 'restart_to_sign_out',
      email: '',
      balance: null,
      models: []
    })
  })

  it('does not ask for a restart when sign-out happens before the host is running', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-account-idle-'))
    directories.push(home)
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/login')) {
        return new Response(JSON.stringify({ accessToken: 'access', refreshToken: 'refresh' }), { status: 200 })
      }
      if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [] }), { status: 200 })
      if (url.endsWith('/balance')) return new Response(JSON.stringify({ balance: 1 }), { status: 200 })
      if (url.endsWith('/logout')) return new Response(null, { status: 204 })
      return new Response('{}', { status: 404 })
    }
    const account = new DesktopAccountService({
      gatewayUrl: 'https://gateway.test',
      sessionFile: join(home, 'account-session.json'),
      profileDir: join(home, 'profile'),
      secretBox: box,
      hostReady: () => false,
      fetchImpl
    })
    await account.login('owner@example.com', 'correct-horse')
    const signedOut = await account.logout()
    expect(signedOut.needsRestart).toBe(false)
    expect(signedOut.message).toBe('')
    expect(signedOut.signedIn).toBe(false)
  })

  it('does not install a model that omits its real context or output limit', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-account-incomplete-'))
    directories.push(home)
    const profile = join(home, 'profile')
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/login')) {
        return new Response(JSON.stringify({ accessToken: 'access', refreshToken: 'refresh' }), { status: 200 })
      }
      if (url.endsWith('/models')) {
        return new Response(JSON.stringify({ data: [
          { id: 'bare' },
          { id: 'context-only', context_length: 200000 },
          listed('kept', { architecture: { input_modalities: ['text'] } })
        ] }), { status: 200 })
      }
      if (url.endsWith('/balance')) return new Response(JSON.stringify({ balance: 4 }), { status: 200 })
      return new Response('{}', { status: 404 })
    }
    const account = new DesktopAccountService({
      gatewayUrl: 'https://gateway.test',
      sessionFile: join(home, 'account-session.json'),
      profileDir: profile,
      secretBox: box,
      hostReady: () => true,
      fetchImpl
    })
    const status = await account.login('owner@example.com', 'correct-horse')
    expect(status.models).toEqual(['kept'])
    const patch = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('id: kept')
    expect(patch).not.toContain('bare')
    expect(patch).not.toContain('context-only')
    expect(patch).not.toContain('1000000')
    expect(patch).not.toContain('128000')
    expect(patch).not.toContain('defaultContextWindow')
    expect(patch).not.toContain('defaultMaxTokens')
  })
})
