/** Desktop account bridge. Tokens stay in the main process. */
export interface AccountProfileState {
  models: 'ready' | 'failed'
  balance: 'ready' | 'failed'
  /** Image catalog read. Independent of the chat model list. */
  images: 'ready' | 'failed'
  /** Video catalog read. Independent of the chat model list. */
  videos: 'ready' | 'failed'
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

/** One resolution tier and the credits it costs. */
export interface AccountMediaTierPrice {
  tier: '1k' | '2k' | '4k'
  credits: number
}

/** One image or video generation. `credits` is absent when the listing did not publish a price. */
export interface AccountMediaModel {
  id: string
  name: string
  credits?: number
  /** Image tiers whose prices differ. Absent when every tier costs `credits`. */
  qualityCredits?: AccountMediaTierPrice[]
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
  /** Image models offered on the account page. Empty when none were published. */
  imageModels: AccountMediaModel[]
  /** Video models offered on the account page. Empty when none were published. */
  videoModels: AccountMediaModel[]
  credits: AccountCredits | null
  /** Which cached profile reads failed. Check-in does not clear a model failure. */
  profile: AccountProfileState
  /** True after today's check-in is known, including one completed before this session. The next sign-in clears it until the summary is read again. */
  checkedIn: boolean
}

/** A package the gateway currently sells. The gateway owns both numbers. */
export interface AccountRechargePackage {
  yuan: number
  credits: number
}

/** Packages and whether a purchase can be started. Null packages mean the list could not be read. */
export interface AccountRechargeCatalog {
  packages: AccountRechargePackage[] | null
  paymentAvailable: boolean
  message: string
}

/** Positive safe integer. The gateway, not a local price list, decides which amounts can be sold. */
export function isRechargeYuan(value: number): value is number {
  return Number.isSafeInteger(value) && value > 0
}

export interface AccountOrder {
  orderId: string
  yuan: number
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

export const ACCOUNT_PLUGIN_NAME = 'dsh-taichi-account'
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
  packages: 'dsh-desktop:account-packages',
  purchase: 'dsh-desktop:account-purchase',
  order: 'dsh-desktop:account-order'
} as const
