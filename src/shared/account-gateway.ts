/** Desktop account bridge. Tokens stay in the main process. */
export interface AccountProfileState {
  models: 'ready' | 'failed'
  balance: 'ready' | 'failed'
}

/** Multipliers applied after the prompt reaches the token threshold. */
export interface AccountLongContextPrice {
  minInputTokens: number
  input: number
  output: number
  cache: number
  cacheWrite: number
}

/** Weekdays use Monday as 0. Windows are UTC clock times. */
export interface AccountPeakPrice {
  multiplier: number
  weekdays: number[]
  windows: Array<[string, string]>
}

/** Credits charged per million tokens. Absent when the listing did not publish a price. */
export interface AccountModelPrice {
  inputPerMillion: number
  outputPerMillion: number
  cachePerMillion?: number
  cacheWrite5mPerMillion?: number
  cacheWrite1hPerMillion?: number
  /** Pre-discount credit rate. Present only when it is higher than the sell rate. */
  listInputPerMillion?: number
  /** Pre-discount credit rate. Present only when it is higher than the sell rate. */
  listOutputPerMillion?: number
  /** Share of the list credit price that is not charged, from 0 to 1. */
  savingsRatio?: number
  longContext?: AccountLongContextPrice
  peak?: AccountPeakPrice
}

export interface AccountModel {
  id: string
  name: string
  price?: AccountModelPrice
}

export interface AccountCreditUse {
  id: string
  amount: number
  createdAt: string
  model?: string
}

export interface AccountCreditGrant {
  id: string
  amount: number
  createdAt: string
  kind: 'checkin' | 'signup' | 'purchase' | 'adjustment'
}

/** One Shanghai calendar day. Days with no activity are omitted. */
export interface AccountCreditDay {
  date: string
  consumed: number
  recharged: number
  count: number
}

/** Totals, recent activity, and daily amounts. Null when the summary could not be read. */
export interface AccountCredits {
  consumed: number
  recharged: number
  usageCount: number
  consumption: AccountCreditUse[]
  recharge: AccountCreditGrant[]
  daily: AccountCreditDay[]
}

export interface AccountStatus {
  configured: boolean
  signedIn: boolean
  email: string
  balance: number | null
  needsRestart: boolean
  message: string
  models: AccountModel[]
  credits: AccountCredits | null
  /** Which cached profile reads failed. Check-in does not clear a model failure. */
  profile: AccountProfileState
  /** True after today's check-in is known, including one completed before this session. The next sign-in clears it until the summary is read again. */
  checkedIn: boolean
}

/** One yuan buys this many credits. The cashier only sells the listed amounts. */
export const CREDIT_PER_YUAN = 1000
export const RECHARGE_PACKAGES = [39, 99, 199, 299] as const
export type RechargeYuan = typeof RECHARGE_PACKAGES[number]

export function isRechargeYuan(value: number): value is RechargeYuan {
  return (RECHARGE_PACKAGES as readonly number[]).includes(value)
}

export function rechargeCredits(yuan: RechargeYuan): number {
  return yuan * CREDIT_PER_YUAN
}

export interface AccountOrder {
  orderId: string
  yuan: RechargeYuan
  credits: number
  status: 'pending' | 'paid'
  /** Raw Alipay code. The renderer receives qrImage instead. */
  qrCode?: string
  /** PNG data URL drawn in the main process from a validated Alipay code. */
  qrImage?: string
}

export interface AccountPurchaseResult {
  ok: boolean
  message: string
  order: AccountOrder | null
}

export const ACCOUNT_PLUGIN_NAME = 'dsh-desktop-account'
export const ACCOUNT_PROVIDER_ID = 'taichi'
export const ACCOUNT_ACCESS_ENV = 'TAICHI_GATEWAY_ACCESS_TOKEN'

export const ACCOUNT_IPC = {
  status: 'dsh-desktop:account-status',
  register: 'dsh-desktop:account-register',
  verify: 'dsh-desktop:account-verify',
  login: 'dsh-desktop:account-login',
  logout: 'dsh-desktop:account-logout',
  resetRequest: 'dsh-desktop:account-reset-request',
  resetConfirm: 'dsh-desktop:account-reset-confirm',
  checkIn: 'dsh-desktop:account-check-in',
  refresh: 'dsh-desktop:account-refresh',
  purchase: 'dsh-desktop:account-purchase',
  order: 'dsh-desktop:account-order'
} as const
