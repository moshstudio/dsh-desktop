/** Account payload kept local to the plugin. The desktop gateway types are not imported, so the browser bundle does not pull in host source. */

export interface AccountProfileState {
  models?: string
  balance?: string
  images?: string
  videos?: string
}

export interface AccountSnapshot {
  configured: boolean
  signedIn: boolean
  email: string
  balance: number | null
  needsRestart: boolean
  message: string
  models?: unknown
  imageModels?: unknown
  videoModels?: unknown
  credits?: unknown
  profile?: AccountProfileState
  checkedIn?: boolean
}

export interface AccountOrder {
  orderId?: string
  status?: string
  qrImage?: string
}

export interface PurchaseResult {
  ok?: boolean
  message?: string
  order?: AccountOrder | null
}

export interface AccountApi {
  status: () => Promise<AccountSnapshot>
  register: (email: string, password: string) => Promise<AccountSnapshot>
  verify: (token: string) => Promise<AccountSnapshot>
  login: (email: string, password: string) => Promise<AccountSnapshot>
  logout: () => Promise<AccountSnapshot>
  requestReset: (email: string) => Promise<AccountSnapshot>
  confirmReset: (token: string, password: string) => Promise<AccountSnapshot>
  checkIn: () => Promise<AccountSnapshot>
  refresh?: () => Promise<AccountSnapshot>
  purchase?: (yuan: number) => Promise<PurchaseResult>
  order?: (orderId: string) => Promise<PurchaseResult>
}

export interface DesktopBridge {
  account?: AccountApi
  restartHarness?: () => Promise<{ ok?: boolean }>
}

export interface PanelSnapshot {
  activePanelId?: unknown
}

export interface PanelInfo {
  getSnapshot?: () => PanelSnapshot
  subscribe?: (listener: () => void) => () => void
}

export interface LayoutScope {
  panelInfo?: PanelInfo
}

declare global {
  interface Window {
    dshDesktop?: DesktopBridge
  }
}
