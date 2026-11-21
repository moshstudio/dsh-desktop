const STYLE_ID = 'dsh-taichi-account-style'

// These rules hit host nodes, the window drag region, and the payment image.
// CSS modules would hash the class names, and the compiler rewrites the named
// QR backdrop into a hex color, so this sheet stays global and is injected once by id.
const STYLE = `
[data-dsh-sidebar-settings-actions]{display:flex;flex-direction:row;align-items:center}
[data-dsh-sidebar-settings]:has([data-dsh-desktop-utilities][data-wide="false"]) [data-dsh-sidebar-settings-actions]{justify-content:center}
[data-dsh-taichi-account-entry]{position:relative;display:flex;align-items:center;flex:none;padding:4px}
[data-dsh-taichi-account-entry][data-wide="false"]{justify-content:center}
html[data-platform=darwin] [data-sidebar-collapsed] [data-dsh-account-toolbar]{padding-top:var(--dsh-frame-top-clearance,48px);padding-inline-start:var(--dsh-frame-leading-clearance,160px)}
html[data-platform=darwin] [data-dsh-account-toolbar]{-webkit-app-region:drag}
[data-dsh-account-toolbar] :is(button,a,input,textarea){-webkit-app-region:no-drag}
[data-dsh-account-qr]{background:white}
`

export function installStyles(): void {
  const existing = document.getElementById(STYLE_ID)
  if (existing) {
    existing.textContent = STYLE
    return
  }
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = 'dsh-taichi-account'
  style.textContent = STYLE
  document.head.appendChild(style)
}
