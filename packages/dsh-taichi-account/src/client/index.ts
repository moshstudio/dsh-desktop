import { dictionaries, NS } from './locale'
import { installStyles } from './host-style'
import { AccountButton, closeAccountDialog, resetAccountDialog } from './account-button'
import { QuotaRechargeNotice } from './quota-notice'
import { publishStatus, resetStatus as clearStatus } from './status'
import type { Translate } from './locale'

const PANEL = 'desktop-account'

interface LayoutScope {
  selectPanel: (id: string | null) => void
  panelInfo?: {
    getSnapshot?: () => { activePanelId?: unknown }
    subscribe?: (listener: () => void) => () => void
  }
}

interface SlotRegistration {
  name: string
  id?: string
  key?: string
  locale: string
  select?: (owner: { code?: string } | null | undefined) => unknown
  inject: () => Record<string, unknown>
}

interface AccountScope {
  locale: {
    register: (ns: string, dictionaries: object) => void
    bind: (ns: string) => Translate
  }
  layout: LayoutScope
  slots: {
    inject: (name: string, register: () => void) => void
    register: (config: SlotRegistration, component: unknown) => void
  }
}

interface AccountClient {
  inject: (services: string[], callback: (scope: AccountScope) => void) => void
}

export function resetStatus(): void {
  clearStatus()
  resetAccountDialog()
}

export { AccountPanel } from './account-panel'
export { accountDialogOpen, openAccountDialog } from './account-button'

export const inject: string[] = []

/**
 * Mount the activity-rail account button, the account dialog, and the quota notice.
 * Screens are TSX components. Host-targeting rules stay in one global sheet;
 * page layout comes from CSS modules compiled into this bundle.
 */
export function apply(ctx: AccountClient): void {
  ctx.inject(['slots', 'locale', 'layout'], scope => {
    installStyles()
    scope.locale.register(NS, dictionaries)
    const t = scope.locale.bind(NS)
    scope.slots.inject('shell.activity.action', () => scope.slots.register({
      name: 'shell.activity.action',
      id: 'desktop-account',
      locale: NS,
      inject: () => ({
        t,
        onClose: closeAccountDialog,
        onStatus: publishStatus,
        layout: scope.layout,
        panelId: PANEL
      })
    }, AccountButton))
    scope.slots.inject('shell.quota-notice', () => scope.slots.register({
      name: 'shell.quota-notice',
      id: 'desktop-credit-quota',
      locale: NS,
      select: owner => owner && owner.code === 'QUOTA' ? owner : null,
      inject: () => ({ t })
    }, QuotaRechargeNotice))
  })
}
