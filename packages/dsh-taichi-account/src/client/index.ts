import { dictionaries, NS } from './locale'
import { installStyles } from './host-style'
import { AccountButton } from './account-button'
import { AccountPanel } from './account-panel'
import { QuotaRechargeNotice } from './quota-notice'
import { publishStatus, resetStatus as clearStatus } from './status'
import type { Translate } from './locale'

const PANEL = 'desktop-account'

interface LayoutScope {
  selectPanel: (id: string | null) => void
  panelInfo?: {
    getSnapshot?: () => { activePanelId?: unknown }
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
}

export const inject: string[] = []

/**
 * Mount the sidebar account button, the account page, and the quota notice.
 * Screens are TSX components. Host-targeting rules stay in one global sheet;
 * page layout comes from CSS modules compiled into this bundle.
 */
export function apply(ctx: AccountClient): void {
  ctx.inject(['slots', 'locale', 'layout'], scope => {
    installStyles()
    scope.locale.register(NS, dictionaries)
    const t = scope.locale.bind(NS)
    // Remember the panel underneath so closing the account page returns there.
    let returnPanel: string | null = null
    const currentPanel = (): string | null => {
      const id = scope.layout.panelInfo?.getSnapshot?.()?.activePanelId
      return typeof id === 'string' ? id : null
    }
    const showAccount = (): void => {
      const active = currentPanel()
      if (active === PANEL) return
      returnPanel = active
      scope.layout.selectPanel(PANEL)
    }
    const hideAccount = (): void => {
      const restore = returnPanel
      returnPanel = null
      try {
        scope.layout.selectPanel(restore)
      } catch {
        // The previous panel may have been removed. The conversation is always available.
        if (restore !== null) scope.layout.selectPanel(null)
      }
    }
    const toggleAccount = (): void => {
      if (currentPanel() === PANEL) hideAccount()
      else showAccount()
    }
    scope.slots.inject('sidebar.settings.action', () => scope.slots.register({
      name: 'sidebar.settings.action',
      id: 'desktop-account',
      locale: NS,
      inject: () => ({ t, layout: scope.layout, panelId: PANEL, showAccount, toggleAccount })
    }, AccountButton))
    scope.slots.inject('main', () => scope.slots.register({
      name: 'main',
      key: PANEL,
      locale: NS,
      inject: () => ({ t, onClose: hideAccount, onStatus: publishStatus, layout: scope.layout, panelId: PANEL })
    }, AccountPanel))
    scope.slots.inject('shell.quota-notice', () => scope.slots.register({
      name: 'shell.quota-notice',
      id: 'desktop-credit-quota',
      locale: NS,
      select: owner => owner && owner.code === 'QUOTA' ? owner : null,
      inject: () => ({ t })
    }, QuotaRechargeNotice))
  })
}
