window.__ModuleLoader__.load({
  id: 'dsh-desktop-activity',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { IconSettingsOutlineMedium } = require('@deepseek-ai/dsh-client-ui-primitives')
    const CLOSED = false
    const STYLE_ID = 'dsh-desktop-activity-style'
    const NS = 'desktop-activity'

    const copy = {
      zh: { home: '主页', image: '图片', settings: '设置' },
      en: { home: 'Home', image: 'Image', settings: 'Settings' },
      ja: { home: 'ホーム', image: '画像', settings: '設定' },
      es: { home: 'Inicio', image: 'Imagen', settings: 'Ajustes' },
      fr: { home: 'Accueil', image: 'Image', settings: 'Réglages' },
      de: { home: 'Start', image: 'Bild', settings: 'Einstellungen' },
      ru: { home: 'Главная', image: 'Изображение', settings: 'Настройки' },
      pt: { home: 'Início', image: 'Imagem', settings: 'Configurações' }
    }

    const studioGate = {
      current: null,
      listeners: new Set(),
      getSnapshot() { return this.current },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
      set(studio) {
        this.current = studio ?? null
        for (const listener of this.listeners) listener()
      }
    }

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.dataset.pluginCss = 'dsh-desktop-activity'
      // Hover and selected share Button's interactive washes. The rail uses the
      // conversation sidebar fill so the icon column and the session column read
      // as one sidebar. Selection is that wash plus a leading mark; the glyph
      // itself fills while it is the current place.
      style.textContent = `
        [data-dsh-activity-rail]{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:4px;width:48px;height:100%;padding:8px 0;background:var(--dsw-specific-sidebar-fill);border-inline-end:1px solid var(--dsw-alias-border-secondary)}
        [data-dsh-activity-rail] button{position:relative;display:flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background-color .14s ease,color .14s ease}
        [data-dsh-activity-rail] button svg{display:block;width:18px;height:18px}
        [data-dsh-activity-rail] button > span{display:flex;align-items:center;justify-content:center;width:18px;height:18px}
        [data-dsh-activity-rail] button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
        [data-dsh-activity-rail] button:active{background:var(--dsw-alias-interactive-bg-active)}
        [data-dsh-activity-rail] :is(button[aria-current="page"],button[aria-expanded="true"],button[data-selected="true"]){background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
        [data-dsh-activity-rail] :is(button[aria-current="page"],button[aria-expanded="true"],button[data-selected="true"])::before{content:"";position:absolute;inset-inline-start:-5px;top:50%;width:3px;height:16px;border-radius:2px;background:var(--dsw-alias-label-primary);transform:translateY(-50%);pointer-events:none}
        [data-dsh-activity-footer]{margin-top:auto;display:flex;flex-direction:column;align-items:center;gap:8px}
        [data-dsh-activity-footer] [data-dsh-taichi-account-entry]{padding:0}
        [data-dsh-activity-rail] button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
        html[data-platform=darwin]:not([data-fullscreen=true]) [data-dsh-activity-rail]{padding-top:var(--dsh-frame-top-clearance,48px)}
        @media (prefers-reduced-motion:reduce){[data-dsh-activity-rail] button{transition:none}}
      `
      document.head.appendChild(style)
    }

    const GLYPH = {
      viewBox: '0 0 16 16', width: 18, height: 18, fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true'
    }

    function icon(kind, selected) {
      if (kind === 'settings') return React.createElement(IconSettingsOutlineMedium, { size: 18 })
      if (kind === 'home') {
        // Filled house only while Home is the current place. The door is a hole,
        // so the glyph stays a house instead of a solid pin.
        if (selected) {
          return React.createElement('svg', { ...GLYPH, fill: 'currentColor', stroke: 'none' },
            React.createElement('path', {
              fillRule: 'evenodd',
              d: 'M8 2.35 13.45 6.7V12.6c0 .5-.4.9-.9.9H3.45c-.5 0-.9-.4-.9-.9V6.7L8 2.35Zm-1.05 7.05h2.1V13.5h-2.1V9.4Z'
            }))
        }
        return React.createElement('svg', GLYPH,
          React.createElement('path', { d: 'M2.2 7.35 8 2.75l5.8 4.6', fill: 'none' }),
          React.createElement('path', { d: 'M4.05 6.85V12.9h7.9V6.85', fill: 'none' }),
          React.createElement('path', { d: 'M6.9 12.9V9.35h2.2v3.55', fill: 'none' }))
      }
      // Filled frame with the sun and skyline cut out, same idea as the house.
      if (selected) {
        return React.createElement('svg', { ...GLYPH, fill: 'currentColor', stroke: 'none' },
          React.createElement('path', {
            fillRule: 'evenodd',
            d: 'M3.85 3.15h8.3a1.7 1.7 0 0 1 1.7 1.7v6.3a1.7 1.7 0 0 1-1.7 1.7h-8.3a1.7 1.7 0 0 1-1.7-1.7v-6.3a1.7 1.7 0 0 1 1.7-1.7ZM5.45 5.15a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8ZM3.05 12.2V11.55L5.85 8.8l1.8 1.6 2.25-2.15 3.05 2.95V12.2H3.05Z'
          }))
      }
      return React.createElement('svg', GLYPH,
        React.createElement('rect', { x: 2.15, y: 3.15, width: 11.7, height: 9.7, rx: 1.7, fill: 'none' }),
        React.createElement('circle', { cx: 5.45, cy: 6.05, r: 0.9, fill: 'currentColor', stroke: 'none' }),
        React.createElement('path', { d: 'M3.05 11.55 5.85 8.8l1.8 1.6 2.25-2.15 3.05 2.95', fill: 'none' }))
    }

    // settings.launcher is the single seat that replaces the sidebar gear.
    // The account button is a separate shell.activity.action. The settings
    // shell (panel, connection, update) stays in sidebar.settings.
    const settingsGate = {
      current: null,
      listeners: new Set(),
      getSnapshot() { return this.current },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
      set(next) {
        const prev = this.current
        if (prev === next) return
        if (prev && next && prev.settingsOpen === next.settingsOpen && prev.aria === next.aria && prev.open === next.open) return
        this.current = next
        for (const listener of this.listeners) listener()
      }
    }

    function SettingsRelay({ openSettings, settingsOpen, settingsShortcut }) {
      const openRef = React.useRef(openSettings)
      openRef.current = openSettings
      const open = React.useRef(null)
      if (!open.current) open.current = () => { openRef.current?.() }
      React.useLayoutEffect(() => {
        settingsGate.set({
          open: open.current,
          settingsOpen: settingsOpen === true,
          aria: settingsShortcut?.aria
        })
      }, [settingsOpen, settingsShortcut])
      React.useLayoutEffect(() => () => { settingsGate.set(null) }, [])
      return null
    }

    function ActivityRail({ t, layout, renderSlot }) {
      React.useLayoutEffect(installStyles)
      const studio = React.useSyncExternalStore(studioGate.subscribe.bind(studioGate), studioGate.getSnapshot.bind(studioGate))
      const settings = React.useSyncExternalStore(settingsGate.subscribe.bind(settingsGate), settingsGate.getSnapshot.bind(settingsGate))
      const panelOpen = React.useSyncExternalStore(
        listener => studio ? studio.subscribe(listener) : () => {},
        () => studio ? studio.getSnapshot().panelOpen === true : CLOSED
      )
      const homeCurrent = !panelOpen
      const showSidebar = () => {
        studio?.close()
        if (document.querySelector('[data-sidebar-collapsed]')) layout.toggleSidebar()
      }
      return React.createElement('nav', { 'data-dsh-activity-rail': 'true', 'aria-label': t('home') },
        React.createElement('button', {
          type: 'button',
          'data-dsh-activity': 'home',
          'aria-label': t('home'),
          'aria-current': homeCurrent ? 'page' : undefined,
          title: t('home'),
          onClick: showSidebar
        }, icon('home', homeCurrent)),
        studio && React.createElement('button', {
          type: 'button',
          'data-dsh-activity': 'image',
          'aria-label': t('image'),
          'aria-current': panelOpen ? 'page' : undefined,
          title: t('image'),
          onClick: () => { studio.open() }
        }, icon('image', panelOpen)),
        React.createElement('div', { 'data-dsh-activity-footer': '' },
          typeof renderSlot === 'function' ? renderSlot('shell.activity.action', { wide: false }) : null,
          settings && React.createElement('button', {
            type: 'button',
            'data-dsh-activity': 'settings',
            'aria-label': t('settings'),
            'aria-haspopup': 'dialog',
            'aria-expanded': settings.settingsOpen,
            'aria-keyshortcuts': settings.aria,
            title: t('settings'),
            onClick: () => { settings.open() }
          }, icon('settings')))
      )
    }

    const inject = ['locale', 'slots', 'layout']
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, copy))
      const t = ctx.locale.bind(NS)
      if (typeof ctx.inject === 'function') {
        ctx.inject(['taichiImageStudio'], scoped => {
          studioGate.set(scoped.taichiImageStudio)
          return () => { studioGate.set(null) }
        })
      }
      ctx.slots.inject('shell.activity', () => ctx.slots.register({
        name: 'shell.activity',
        locale: NS,
        children: {
          // Icon actions pinned to the bottom of the rail. List, root scope, only receives wide.
          // No occupants by default; settings stays a rail-owned button beside this seat.
          'shell.activity.action': { kind: 'list', scope: 'root' }
        },
        inject: () => ({ t, layout: ctx.layout })
      }, ActivityRail))
      ctx.slots.inject('settings.launcher', () => ctx.slots.register({
        name: 'settings.launcher'
      }, SettingsRelay))
    }

    exports.apply = apply
    exports.inject = inject
    exports.studioGate = studioGate
    return module.exports
  }
})
