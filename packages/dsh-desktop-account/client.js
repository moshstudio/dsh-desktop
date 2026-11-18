window.__ModuleLoader__.load({
  id: 'dsh-desktop-account',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // The client graph executes this classic script only. Sibling chunks are
    // loaded by require.async and cannot synchronously require one another,
    // so registration waits until copy, styles, fields, and the dialog arrive.
    const CHUNKS = [
      './client.locale.js',
      './client.style.js',
      './client.form.js',
      './client.dialog.js'
    ]

    async function apply(ctx) {
      if (typeof require.async !== 'function') throw new Error('dsh-desktop-account: client chunks need require.async')
      const [copy, style, form, dialog] = await Promise.all(CHUNKS.map(specifier => require.async(specifier)))
      const { AccountButton, QuotaRechargeNotice } = dialog.createUi(form, copy)
      ctx.inject(['slots', 'locale'], scope => {
        style.installStyles()
        scope.locale.register(copy.NS, copy.dictionaries)
        const t = scope.locale.bind(copy.NS)
        scope.slots.inject('sidebar.settings.action', () => scope.slots.register({
          name: 'sidebar.settings.action',
          id: 'desktop-account',
          locale: copy.NS,
          inject: () => ({ t })
        }, AccountButton))
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
