window.__ModuleLoader__.load({
  id: 'dsh-taichi-image-generation',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const CHUNKS = ['./client.locale.js', './client.style.js', './client.panel.js']
    // Chunks require this same package where they render. The entry require
    // keeps the client graph dependency on the host controls.
    require('@deepseek-ai/dsh-client-ui-primitives')

    async function apply(ctx) {
      if (typeof require.async !== 'function') throw new Error('dsh-taichi-image-generation: client chunks need require.async')
      const [copy, style, panel] = await Promise.all(CHUNKS.map(specifier => require.async(specifier)))
      ctx.inject(['slots', 'locale', 'layout', 'uiConversation'], scope => {
        style.installStyles()
        scope.locale.register(copy.NS, copy.dictionaries)
        panel.register(scope, copy)
      })
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  }
})
