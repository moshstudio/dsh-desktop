const STYLE_ID = 'dsh-taichi-account-style'

// These rules hit host nodes, the window drag region, and the payment image.
// CSS modules would hash the class names, and the compiler rewrites the named
// QR backdrop into a hex color, so this sheet stays global and is injected once by id.
const STYLE = `
[data-dsh-sidebar-settings-actions]{display:flex;flex-direction:row;align-items:center}
[data-dsh-sidebar-settings]:has([data-dsh-desktop-utilities][data-wide="false"]) [data-dsh-sidebar-settings-actions]{justify-content:center}
[data-dsh-taichi-account-entry]{position:relative;display:flex;align-items:center;flex:none;padding:4px}
[data-dsh-taichi-account-entry][data-wide="false"]{justify-content:center}
[role="dialog"].dsh-account-dialog{width:min(920px,100%);height:auto;max-height:100%;padding:0;gap:0;overflow:auto;background:var(--dsw-alias-bg-base)}
[role="dialog"].dsh-account-dialog>[data-screen]{height:auto;min-height:0;overflow:visible}
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
