window.__ModuleLoader__.load({
  id: 'dsh-desktop-account',
  chunk: 'client.style.js',
  factory: () => {
    const STYLE_ID = 'dsh-desktop-account-style'
    const STYLE = `
      [data-dsh-sidebar-settings-actions]{display:flex;flex-direction:row;align-items:center}
      [data-dsh-sidebar-settings]:has([data-dsh-desktop-utilities][data-wide="false"]) [data-dsh-sidebar-settings-actions]{justify-content:center}
      [data-dsh-desktop-account-entry]{display:flex;align-items:center;flex:none;padding:4px}
      [data-dsh-desktop-account-entry][data-wide="false"]{justify-content:center}
      .dshDeskAccountButton{position:relative;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;flex:none;width:32px;height:32px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .15s ease,color .15s ease}
      .dshDeskAccountButton:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
      .dshDeskAccountButton:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
      .dshDeskAccountPresence{position:absolute;right:4px;bottom:4px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary);animation:dshDeskAccountPresenceIn .16s ease-out both}
      .dshDeskAccountDialog[role="dialog"]{display:flex;flex-direction:column;width:min(440px,100%);max-height:min(640px,calc(100vh - 48px));overflow:hidden;padding:0;gap:0;background:var(--dsw-alias-bg-base)}
      .dshDeskAccountContent{box-sizing:border-box;display:flex;flex-direction:column;flex:1;min-height:0;max-height:100%;overflow:hidden;padding:24px 28px}
      .dshDeskAccountHeader{flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
      .dshDeskAccountTitle{margin:0;font-size:20px;font-weight:500;line-height:28px;color:var(--dsw-alias-label-primary)}
      .dshDeskAccountClose{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .15s ease,color .15s ease}
      .dshDeskAccountClose:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .dshDeskAccountClose:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
      .dshDeskAccountClose:disabled{cursor:default;opacity:.6}
      .dshDeskAccountDescription{flex:none;margin:8px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
      .dshDeskAccountBody{flex:1;min-height:0;margin-top:16px;overflow-y:auto}
      .dshDeskAccountBody[data-loading="true"]{display:flex;align-items:center;justify-content:center;min-height:160px}
      .dshDeskAccountLoading{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
      .dshDeskAccountAlert,.dshDeskAccountStatus{margin:0 0 12px;font-size:13px;line-height:20px;overflow-wrap:anywhere}
      .dshDeskAccountAlert{color:var(--dsw-alias-state-error-primary);animation:dshDeskAccountFade .16s ease-out both}
      .dshDeskAccountStatus{color:var(--dsw-alias-state-success-primary);animation:dshDeskAccountFade .16s ease-out both}
      .dshDeskAccountField{display:flex;flex-direction:column;gap:6px;margin:0 0 12px;padding-inline:4px}
      .dshDeskAccountLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}
      .dshDeskAccountControl{position:relative;display:block}
      .dshDeskAccountInput{display:flex;box-sizing:border-box;width:100%;height:36px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-module-platform);transition:background .15s ease}
      .dshDeskAccountControl .dshDeskAccountInput{padding-right:36px}
      .dshDeskAccountInput input{font-size:13px}
      .dshDeskAccountInput:focus-within{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;background:var(--dsw-alias-bg-base)}
      .dshDeskAccountReveal{position:absolute;top:4px;right:4px;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .15s ease,color .15s ease}
      .dshDeskAccountReveal:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
      .dshDeskAccountReveal:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
      .dshDeskAccountFieldError{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);animation:dshDeskAccountFade .16s ease-out both}
      .dshDeskAccountLinks{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:4px}
      .dshDeskAccountLinks button{border:0;background:transparent;padding:0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;transition:background .15s ease,color .15s ease}
      .dshDeskAccountLinks button:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
      .dshDeskAccountLinks button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
      .dshDeskAccountLinks button:disabled{cursor:default;opacity:.6}
      .dshDeskAccountIdentity{display:flex;align-items:center;gap:12px;min-width:0}
      .dshDeskAccountAvatar{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:1}
      .dshDeskAccountIdentityText{min-width:0;flex:1}
      .dshDeskAccountEmail{margin:0;font-size:14px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;user-select:text}
      .dshDeskAccountLogout{flex:none}
      .dshDeskAccountCaption{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}
      .dshDeskAccountCaption[data-success="true"]{color:var(--dsw-alias-state-success-primary)}
      .dshDeskAccountCredits{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;padding:14px 16px;border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
      .dshDeskAccountBalance{margin:0;font-size:28px;font-weight:600;line-height:34px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
      .dshDeskAccountSection{display:flex;align-items:center;gap:8px;margin:16px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}
      .dshDeskAccountCount{font-variant-numeric:tabular-nums}
      .dshDeskAccountChips{display:flex;flex-wrap:wrap;gap:8px;max-height:160px;margin:8px 0 0;padding:0;overflow-y:auto;list-style:none}
      .dshDeskAccountRetry{margin-top:16px}
      .dshDeskAccountChip{max-width:100%;padding:5px 12px;border:1px solid var(--dsw-alias-border-secondary);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;overflow-wrap:anywhere}
      .dshDeskAccountEmpty{margin:8px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
      .dshDeskAccountNotice{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;padding:12px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);animation:dshDeskAccountFade .16s ease-out both}
      .dshDeskAccountNotice p{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
      .dshDeskAccountFooter{flex:none;display:flex;align-items:center;gap:10px;margin-top:20px}
      .dshDeskAccountFooter[data-align="end"]{justify-content:flex-end}
      .dshDeskAccountFooter[data-align="start"]{justify-content:flex-start}
      .dshDeskAccountStage{min-width:0}
      .dshDeskAccountBody[data-loading="true"] .dshDeskAccountStage{width:max-content;max-width:100%}
      .dshDeskAccountTitle,.dshDeskAccountDescription,.dshDeskAccountStage{animation:dshDeskAccountRise .16s ease-out both}
      @keyframes dshDeskAccountRise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      @keyframes dshDeskAccountFade{from{opacity:0}to{opacity:1}}
      @keyframes dshDeskAccountPresenceIn{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:none}}
      @media (width<=560px){.dshDeskAccountContent{padding:20px}}
      @media (prefers-reduced-motion:reduce){.dshDeskAccountButton,.dshDeskAccountClose,.dshDeskAccountReveal,.dshDeskAccountLinks button,.dshDeskAccountInput{transition:none}.dshDeskAccountTitle,.dshDeskAccountDescription,.dshDeskAccountStage,.dshDeskAccountFieldError,.dshDeskAccountAlert,.dshDeskAccountStatus,.dshDeskAccountNotice,.dshDeskAccountPresence{animation:none}}
    `

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.dataset.plugin = 'dsh-desktop-account'
      style.textContent = STYLE
      document.head.appendChild(style)
    }

    return { installStyles }
  }
})
