window.__ModuleLoader__.load({
  id: 'dsh-taichi-account',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // The client graph executes this classic script only. Sibling chunks are
    // loaded by require.async and cannot synchronously require one another,
    // so registration waits until copy, styles, fields, and the account page arrive.
    const CHUNKS = [
      './client.locale.js',
      './client.style.js',
      './client.form.js',
      './client.dialog.js'
    ]
    const PANEL = 'desktop-account'
    // Chunks require this same package where they render. The entry require
    // keeps the client graph dependency on the host controls.
    require('@deepseek-ai/dsh-client-ui-primitives')

    async function apply(ctx) {
      if (typeof require.async !== 'function') throw new Error('dsh-taichi-account: client chunks need require.async')
      const [copy, style, form, dialog] = await Promise.all(CHUNKS.map(specifier => require.async(specifier)))
      const { AccountButton, AccountPanel, QuotaRechargeNotice, publishStatus, resetStatus } = dialog.createUi(form, copy)
      exports.resetStatus = resetStatus
      ctx.inject(['slots', 'locale', 'layout'], scope => {
        style.installStyles()
        scope.locale.register(copy.NS, copy.dictionaries)
        const t = scope.locale.bind(copy.NS)
        // Remember the panel underneath so closing the account page returns there.
        let returnPanel = null
        const currentPanel = () => {
          const id = scope.layout.panelInfo?.getSnapshot?.()?.activePanelId
          return typeof id === 'string' ? id : null
        }
        const showAccount = () => {
          const active = currentPanel()
          if (active === PANEL) return
          returnPanel = active
          scope.layout.selectPanel(PANEL)
        }
        const hideAccount = () => {
          const restore = returnPanel
          returnPanel = null
          try {
            scope.layout.selectPanel(restore)
          } catch {
            // The previous panel may have been removed. The conversation is always available.
            if (restore !== null) scope.layout.selectPanel(null)
          }
        }
        const toggleAccount = () => {
          if (currentPanel() === PANEL) hideAccount()
          else showAccount()
        }
        scope.slots.inject('sidebar.settings.action', () => scope.slots.register({
          name: 'sidebar.settings.action',
          id: 'desktop-account',
          locale: copy.NS,
          inject: () => ({ t, layout: scope.layout, panelId: PANEL, showAccount, toggleAccount })
        }, AccountButton))
        scope.slots.inject('main', () => scope.slots.register({
          name: 'main',
          key: PANEL,
          locale: copy.NS,
          inject: () => ({ t, onClose: hideAccount, onStatus: publishStatus, layout: scope.layout, panelId: PANEL })
        }, AccountPanel))
        scope.slots.inject('shell.quota-notice', () => scope.slots.register({
          name: 'shell.quota-notice',
          id: 'desktop-credit-quota',
          locale: copy.NS,
          select: owner => owner && owner.code === 'QUOTA' ? owner : null,
          inject: () => ({ t })
        }, QuotaRechargeNotice))
      })
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  }
})
