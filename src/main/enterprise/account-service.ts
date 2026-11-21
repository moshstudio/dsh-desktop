import { isRechargeYuan, type AccountCredits, type AccountMediaModel, type AccountModel, type AccountPurchaseResult, type AccountStatus } from '../../shared/account-gateway'
import { validModelEndpoint } from '../recovery/startup-config-recovery'
import {
  GatewayClient,
  readBalance,
  readCreditSummary,
  readError,
  readGatewayModels,
  readMediaModels,
  readPurchaseOrder,
  readTokenPair
} from './gateway-client'
import { restoreBuiltinAccount } from './provider-config'
import { AccountSessionStore, electronSecretBox, type SecretBox, type StoredSession } from './session-store'

export { electronSecretBox }

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function shanghaiDate(instant: Date): string | undefined {
  if (Number.isNaN(instant.getTime())) return undefined
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(instant)
}

/** The ledger grants one check-in per Shanghai day. The summary lists that grant with the other credits. */
function checkedInToday(credits: AccountCredits, now = new Date()): boolean {
  const today = shanghaiDate(now)
  if (!today) return false
  return credits.recharge.some(entry => {
    if (entry.kind !== 'checkin') return false
    return shanghaiDate(new Date(entry.createdAt)) === today
  })
}

class AccountResponseError extends Error {
  constructor(readonly status: number) {
    super(`Unexpected gateway response (HTTP ${status})`)
  }
}

// Error messages, stacks and response bodies may contain credentials. Log only
// controlled categories and transport codes, including the nested cause chain.
function safeDiagnostic(error: unknown, depth = 0): unknown {
  if (!(error instanceof Error) || depth > 4) return { kind: 'unknown' }
  const names = ['Error', 'TypeError', 'SyntaxError', 'AbortError', 'TimeoutError']
  const code = 'code' in error ? error.code : undefined
  const codes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'ENOENT', 'EACCES', 'EPERM']
  return {
    kind: names.includes(error.name) ? error.name : 'Error',
    ...(error instanceof AccountResponseError ? { status: error.status } : {}),
    ...(typeof code === 'string' && codes.includes(code) ? { code } : {}),
    ...(error.cause === undefined ? {} : { cause: safeDiagnostic(error.cause, depth + 1) })
  }
}

export interface AccountServiceOptions {
  gatewayUrl: string | undefined
  sessionFile: string
  profileDir: string
  secretBox: SecretBox
  hostReady?: () => boolean
  fetchImpl?: typeof fetch
}

export class DesktopAccountService {
  private readonly client: GatewayClient | undefined
  private readonly store: AccountSessionStore
  private accessToken: string | undefined
  private email = ''
  private balance: number | null = null
  private needsRestart = false
  private message = ''
  private models: AccountModel[] = []
  private imageModels: AccountMediaModel[] = []
  private videoModels: AccountMediaModel[] = []
  private credits: AccountCredits | null = null
  private modelsFailed = false
  private balanceFailed = false
  private imagesFailed = false
  private videosFailed = false
  private checkedIn = false

  constructor(private readonly options: AccountServiceOptions) {
    const gatewayUrl = options.gatewayUrl?.trim().replace(/\/$/u, '')
    this.client = gatewayUrl && validModelEndpoint(gatewayUrl) ? new GatewayClient(gatewayUrl, options.fetchImpl) : undefined
    this.store = new AccountSessionStore(options.sessionFile, options.secretBox)
  }

  status(): AccountStatus {
    return {
      configured: this.client !== undefined,
      signedIn: this.accessToken !== undefined,
      email: this.email,
      balance: this.balance,
      needsRestart: this.needsRestart,
      message: this.message,
      models: this.models.map(model => ({
        id: model.id,
        name: model.name,
        ...(model.price ? { price: { ...model.price } } : {})
      })),
      imageModels: this.imageModels.map(copyMediaModel),
      videoModels: this.videoModels.map(copyMediaModel),
      credits: this.credits ? {
        consumed: this.credits.consumed,
        recharged: this.credits.recharged,
        usageCount: this.credits.usageCount,
        consumption: this.credits.consumption.map(entry => ({ ...entry })),
        recharge: this.credits.recharge.map(entry => ({ ...entry })),
        daily: this.credits.daily.map(day => ({ ...day }))
      } : null,
      profile: {
        models: this.modelsFailed ? 'failed' : 'ready',
        balance: this.balanceFailed ? 'failed' : 'ready',
        images: this.imagesFailed ? 'failed' : 'ready',
        videos: this.videosFailed ? 'failed' : 'ready'
      },
      checkedIn: this.checkedIn
    }
  }

  async prepareHost(): Promise<Record<string, string>> {
    // A new host receives only the token returned by this preparation attempt.
    this.clearMemory()
    if (!this.client) return {}
    const session = await this.readSession()
    if (!session) return {}
    try {
      const refreshed = await this.client.refresh(session.refreshToken)
      if (refreshed.status === 401) {
        this.message = 'unauthorized'
        await this.store.clear()
        return {}
      }
      const tokens = readTokenPair(refreshed.body)
      if (refreshed.status !== 200 || !tokens) throw new AccountResponseError(refreshed.status)
      await this.remember(session.email, tokens)
      return { TAICHI_GATEWAY_ACCESS_TOKEN: tokens.accessToken }
    } catch (error) {
      console.error('[account] host session preparation failed', safeDiagnostic(error))
      const message = this.message === 'unauthorized' ? 'unauthorized' : 'unavailable'
      this.clearMemory()
      this.message = message
      return {}
    }
  }

  async register(email: unknown, password: unknown): Promise<AccountStatus> {
    return this.accept(client => client.register(text(email), text(password)))
  }

  async verify(token: unknown): Promise<AccountStatus> {
    return this.acceptCode(client => client.verify(text(token)))
  }

  async login(email: unknown, password: unknown): Promise<AccountStatus> {
    const client = this.requireClient()
    if (!client) return this.status()
    const address = text(email)
    const result = await client.login(address, text(password))
    const tokens = readTokenPair(result.body)
    if (result.status !== 200 || !tokens) return this.fail(readError(result.body))
    await this.remember(address, tokens)
    this.needsRestart = this.options.hostReady?.() === true
    return this.status()
  }

  async logout(): Promise<AccountStatus> {
    const session = await this.readSession()
    const hadAccess = this.accessToken !== undefined || session !== undefined
    if (this.client && session) await this.client.logout(session.refreshToken).catch(() => undefined)
    await this.store.clear()
    this.clearMemory()
    // The running host keeps the access token from launch until it restarts.
    if (hadAccess && this.options.hostReady?.() === true) {
      this.needsRestart = true
      this.message = 'restart_to_sign_out'
    }
    return this.status()
  }

  async requestPasswordReset(email: unknown): Promise<AccountStatus> {
    return this.accept(client => client.requestPasswordReset(text(email)))
  }

  async confirmPasswordReset(token: unknown, password: unknown): Promise<AccountStatus> {
    return this.acceptCode(client => client.confirmPasswordReset(text(token), text(password)))
  }

  async checkIn(): Promise<AccountStatus> {
    const client = this.requireClient()
    if (!client || !this.accessToken) return this.fail(this.accessToken ? 'unavailable' : 'unauthorized')
    const result = await client.checkIn(this.accessToken)
    const balance = readBalance(result.body)
    if (result.status !== 200 || balance === undefined) return this.fail(readError(result.body))
    this.balance = balance
    this.balanceFailed = false
    this.checkedIn = true
    this.message = this.modelsFailed ? 'profile_unavailable' : 'checked_in'
    await this.loadCredits(this.accessToken)
    return this.status()
  }

  async purchase(yuan: unknown): Promise<AccountPurchaseResult> {
    const amount = typeof yuan === 'number' ? yuan : typeof yuan === 'string' && /^\d+$/u.test(yuan) ? Number(yuan) : undefined
    if (amount === undefined || !isRechargeYuan(amount)) return { ok: false, message: 'invalid_amount', order: null }
    const client = this.requireClient()
    if (!client || !this.accessToken) return { ok: false, message: this.accessToken ? 'unavailable' : 'unauthorized', order: null }
    const result = await client.createOrder(this.accessToken, amount)
    if (result.status !== 200) return { ok: false, message: readError(result.body), order: null }
    const order = readPurchaseOrder(result.body)
    if (!order?.qrCode || order.yuan !== amount) return { ok: false, message: 'unavailable', order: null }
    return { ok: true, message: '', order }
  }

  async purchaseStatus(orderId: unknown): Promise<AccountPurchaseResult> {
    if (typeof orderId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(orderId)) {
      return { ok: false, message: 'unavailable', order: null }
    }
    const client = this.requireClient()
    if (!client || !this.accessToken) return { ok: false, message: this.accessToken ? 'unavailable' : 'unauthorized', order: null }
    const result = await client.order(this.accessToken, orderId)
    if (result.status !== 200) return { ok: false, message: readError(result.body), order: null }
    const order = readPurchaseOrder(result.body)
    if (!order || order.orderId !== orderId) return { ok: false, message: 'unavailable', order: null }
    return { ok: true, message: '', order: { orderId: order.orderId, yuan: order.yuan, credits: order.credits, status: order.status } }
  }

  async refresh(): Promise<AccountStatus> {
    const client = this.requireClient()
    if (!client || !this.accessToken) return this.fail(this.accessToken ? 'unavailable' : 'unauthorized')
    await this.publish(this.accessToken)
    return this.status()
  }

  private async accept(send: (client: GatewayClient) => Promise<{ status: number; body: unknown }>): Promise<AccountStatus> {
    const client = this.requireClient()
    if (!client) return this.status()
    const result = await send(client)
    if (result.status !== 202 && result.status !== 204 && result.status !== 200) return this.fail(readError(result.body))
    this.message = 'accepted'
    return this.status()
  }

  // A completed rejection means the code was not accepted. Transport failures still throw,
  // so the page can keep "could not reach the service" for those alone.
  private async acceptCode(send: (client: GatewayClient) => Promise<{ status: number; body: unknown }>): Promise<AccountStatus> {
    const client = this.requireClient()
    if (!client) return this.status()
    const result = await send(client)
    if (result.status === 202 || result.status === 204 || result.status === 200) {
      this.message = 'accepted'
      return this.status()
    }
    const code = readError(result.body)
    return this.fail(code === 'rate_limited' ? code : 'code_rejected')
  }

  private async remember(email: string, tokens: { accessToken: string; refreshToken: string }): Promise<void> {
    const session: StoredSession = { email, refreshToken: tokens.refreshToken }
    await this.store.write(session)
    this.accessToken = tokens.accessToken
    this.email = email
    this.balance = null
    this.models = []
    this.imageModels = []
    this.videoModels = []
    this.credits = null
    this.modelsFailed = false
    this.balanceFailed = false
    this.imagesFailed = false
    this.videosFailed = false
    this.checkedIn = false
    this.message = ''
    await this.publish(tokens.accessToken)
  }

  private async publish(accessToken: string): Promise<void> {
    if (!this.client || !this.options.gatewayUrl) return
    const base = this.options.gatewayUrl.trim().replace(/\/$/u, '')
    // Authentication is already committed. Optional profile reads must not undo it.
    try {
      const listed = await this.client.models(accessToken)
      const models = readGatewayModels(listed.body)
      if (listed.status !== 200 || models.length === 0) {
        throw new AccountResponseError(listed.status)
      }
      await restoreBuiltinAccount(this.options.profileDir, {
        baseURL: `${base}/v1`,
        models
      })
      this.models = models.map(model => ({
        id: model.id,
        name: model.name,
        ...(model.price ? { price: { ...model.price } } : {})
      }))
      this.modelsFailed = false
    } catch (error) {
      console.error('[account] model profile could not be synchronized', safeDiagnostic(error))
      this.models = []
      this.modelsFailed = true
      this.message = 'profile_unavailable'
    }
    try {
      const result = await this.client.balance(accessToken)
      const balance = readBalance(result.body)
      if (result.status !== 200 || balance === undefined) {
        throw new AccountResponseError(result.status)
      }
      this.balance = balance
      this.balanceFailed = false
    } catch (error) {
      console.error('[account] balance could not be read', safeDiagnostic(error))
      this.balance = null
      this.balanceFailed = true
      this.message = 'profile_unavailable'
    }
    await this.loadCredits(accessToken)
    await this.loadMediaCatalog(accessToken, 'image')
    await this.loadMediaCatalog(accessToken, 'video')
    if (!this.modelsFailed && !this.balanceFailed && this.message === 'profile_unavailable') this.message = ''
  }

  /** Image and video prices stay off the chat provider. A miss there does not undo sign-in. */
  private async loadMediaCatalog(accessToken: string, kind: 'image' | 'video'): Promise<void> {
    if (!this.client) return
    try {
      const listed = kind === 'image'
        ? await this.client.imageModels(accessToken)
        : await this.client.videoModels(accessToken)
      const models = readMediaModels(listed.body, kind)
      if (listed.status !== 200 || models === undefined) throw new AccountResponseError(listed.status)
      if (kind === 'image') {
        this.imageModels = models
        this.imagesFailed = false
      } else {
        this.videoModels = models
        this.videosFailed = false
      }
    } catch (error) {
      console.error(`[account] ${kind} catalog could not be read`, safeDiagnostic(error))
      if (kind === 'image') {
        this.imageModels = []
        this.imagesFailed = true
      } else {
        this.videoModels = []
        this.videosFailed = true
      }
    }
  }

  private async loadCredits(accessToken: string): Promise<void> {
    if (!this.client) return
    try {
      const result = await this.client.summary(accessToken)
      if (result.status !== 200) throw new AccountResponseError(result.status)
      const credits = readCreditSummary(result.body) ?? null
      this.credits = credits
      // A missing grant must not clear a check-in that just succeeded: the list is capped, and a failed summary leaves credits null.
      if (credits && checkedInToday(credits)) this.checkedIn = true
    } catch (error) {
      console.error('[account] credit summary could not be read', safeDiagnostic(error))
      this.credits = null
    }
  }

  private async readSession(): Promise<StoredSession | undefined> {
    try {
      return await this.store.read()
    } catch (error) {
      console.error('[account] session could not be read', safeDiagnostic(error))
      this.message = 'unavailable'
      return undefined
    }
  }

  private requireClient(): GatewayClient | undefined {
    if (this.client) return this.client
    this.message = 'gateway_unconfigured'
    return undefined
  }

  private fail(code: string): AccountStatus {
    this.message = code
    return this.status()
  }

  private clearMemory(): void {
    this.needsRestart = false
    this.accessToken = undefined
    this.email = ''
    this.balance = null
    this.models = []
    this.imageModels = []
    this.videoModels = []
    this.credits = null
    this.modelsFailed = false
    this.balanceFailed = false
    this.imagesFailed = false
    this.videosFailed = false
    this.checkedIn = false
    this.message = ''
  }
}

function copyMediaModel(model: AccountMediaModel): AccountMediaModel {
  return {
    id: model.id,
    name: model.name,
    ...(model.credits !== undefined ? { credits: model.credits } : {}),
    ...(model.qualityCredits ? { qualityCredits: model.qualityCredits.map(tier => ({ tier: tier.tier, credits: tier.credits })) } : {})
  }
}
