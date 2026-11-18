/** Desktop account bridge. Tokens stay in the main process. */
export interface AccountProfileState {
  models: 'ready' | 'failed'
  balance: 'ready' | 'failed'
}

export interface AccountStatus {
  configured: boolean
  signedIn: boolean
  email: string
  balance: number | null
  needsRestart: boolean
  message: string
  models: string[]
  /** Which cached profile reads failed. Check-in does not clear a model failure. */
  profile: AccountProfileState
  /** True after a successful check-in until the next sign-in replaces the session. */
  checkedIn: boolean
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
  refresh: 'dsh-desktop:account-refresh'
} as const
