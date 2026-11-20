window.__ModuleLoader__.load({
  id: 'dsh-taichi-account',
  chunk: 'client.style.js',
  factory: () => {
    const STYLE_ID = 'dsh-taichi-account-style'
    const STYLE = `
      [data-dsh-sidebar-settings-actions]{display:flex;flex-direction:row;align-items:center}
      [data-dsh-sidebar-settings]:has([data-dsh-desktop-utilities][data-wide="false"]) [data-dsh-sidebar-settings-actions]{justify-content:center}
      [data-dsh-taichi-account-entry]{position:relative;display:flex;align-items:center;flex:none;padding:4px}
      [data-dsh-taichi-account-entry][data-wide="false"]{justify-content:center}
      .dshDeskAccountPresence{position:absolute;right:4px;bottom:4px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary);pointer-events:none;animation:dshDeskAccountPresenceIn .16s ease-out both}
      .dshDeskAccountPanel{box-sizing:border-box;display:flex;flex:1;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base)}
      .dshDeskAccountToolbar{box-sizing:border-box;flex:none;display:flex;align-items:center;min-height:44px;padding:12px 32px 0}
      html[data-platform=darwin] [data-sidebar-collapsed] .dshDeskAccountToolbar{padding-top:var(--dsh-frame-top-clearance,48px);padding-inline-start:var(--dsh-frame-leading-clearance,160px)}
      html[data-platform=darwin] .dshDeskAccountToolbar{-webkit-app-region:drag}
      .dshDeskAccountToolbar :is(button,a,input,textarea){-webkit-app-region:no-drag}
      .dshDeskAccountBack{margin-inline-start:-6px}
      .dshDeskAccountContent{box-sizing:border-box;display:flex;flex-direction:column;flex:1;width:100%;min-width:0;min-height:0;max-height:100%;overflow:hidden;padding:16px 0 32px}
      .dshDeskAccountContent>:not(.dshDeskAccountBody),.dshDeskAccountStage{box-sizing:border-box;min-width:0;padding-inline:32px}
      .dshDeskAccountHeader{flex:none}
      .dshDeskAccountTitle{margin:0;font-size:20px;font-weight:500;line-height:28px;color:var(--dsw-alias-label-primary)}
      .dshDeskAccountDescription{flex:none;margin:8px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
      .dshDeskAccountBody{flex:1;min-height:0;margin-top:16px;overflow-y:auto}
      .dshDeskAccountBody[data-loading="true"]{display:flex;align-items:center;justify-content:center;min-height:160px}
      .dshDeskAccountLoading{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
      .dshDeskAccountAlert,.dshDeskAccountStatus{margin:0 0 12px;font-size:13px;line-height:20px;overflow-wrap:anywhere}
      .dshDeskAccountAlert{color:var(--dsw-alias-state-error-primary);animation:dshDeskAccountFade .16s ease-out both}
      .dshDeskAccountStatus{color:var(--dsw-alias-state-success-primary);animation:dshDeskAccountFade .16s ease-out both}
      .dshDeskAccountField{display:flex;flex-direction:column;gap:6px;margin:0 0 12px;padding-inline:4px}
      .dshDeskAccountLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}
      .dshDeskAccountControl{position:relative}
      /* Width and end padding only place Input beside the reveal Button. */
      .dshDeskAccountInput{width:100%;box-sizing:border-box}
      .dshDeskAccountControl .dshDeskAccountInput{padding-inline-end:40px}
      .dshDeskAccountReveal{position:absolute;inset-inline-end:2px;top:2px}
      .dshDeskAccountFieldError{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);animation:dshDeskAccountFade .16s ease-out both}
      .dshDeskAccountLinks{display:flex;flex-direction:column;gap:4px;margin-top:4px;margin-inline:4px}
      .dshDeskAccountIdentity{display:flex;align-items:center;gap:12px;min-width:0}
      .dshDeskAccountAvatar{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:1}
      .dshDeskAccountIdentityText{min-width:0;flex:1}
      .dshDeskAccountEmail{margin:0;font-size:14px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;user-select:text}
      .dshDeskAccountLogout{flex:none}
      .dshDeskAccountCaption{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}
      .dshDeskAccountCaption[data-success="true"]{color:var(--dsw-alias-state-success-primary)}
      .dshDeskAccountOverview{display:flex;flex-direction:column;gap:20px}
      .dshDeskAccountHero{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,0.85fr);gap:12px;align-items:stretch}
      .dshDeskAccountCredits,.dshDeskAccountHeroStat,.dshDeskAccountStat,.dshDeskAccountEntry,.dshDeskAccountModel,.dshDeskAccountUnread,.dshDeskAccountChart{border:0;border-radius:12px;background:var(--dsw-alias-bg-module-platform)}
      .dshDeskAccountCredits{display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:16px;height:100%;box-sizing:border-box;padding:14px 16px}
      .dshDeskAccountCreditMain,.dshDeskAccountHeroStat{display:flex;flex-direction:column;gap:2px;min-width:0}
      .dshDeskAccountHeroStat{justify-content:center;height:100%;box-sizing:border-box;padding:14px 16px}
      .dshDeskAccountBalance{margin:0;font-size:22px;font-weight:600;line-height:28px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
      .dshDeskAccountCreditActions{display:flex;flex:none;align-items:center;gap:8px}
      .dshDeskAccountRecharge{display:flex;flex-direction:column;gap:12px}
      .dshDeskAccountPacks{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0}
      .dshDeskAccountPack{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;margin:0;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;text-align:start;cursor:pointer;transition:background .15s ease}
      .dshDeskAccountPack:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
      .dshDeskAccountPack:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
      .dshDeskAccountPack:disabled{cursor:default;opacity:.6}
      .dshDeskAccountQr{display:block;width:220px;height:220px;margin:0 auto;padding:8px;border-radius:12px;box-sizing:border-box;background:white}
      .dshDeskAccountMetrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:stretch}
      .dshDeskAccountStat{display:flex;flex-direction:column;justify-content:center;gap:4px;height:100%;box-sizing:border-box;padding:12px 14px}
      .dshDeskAccountStatValue{margin:0;font-size:18px;font-weight:600;line-height:24px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
      .dshDeskAccountUnread{display:flex;align-items:center;box-sizing:border-box;margin:0;padding:14px 16px}
      .dshDeskAccountSection{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}
      .dshDeskAccountStat[data-tone="plus"] .dshDeskAccountStatValue{color:var(--dsw-alias-state-success-primary)}
      .dshDeskAccountStatLabel{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}
      .dshDeskAccountRanges{align-self:flex-start;width:fit-content;max-width:100%}
      .dshDeskAccountChart{display:flex;flex-direction:column;gap:10px;padding:14px 16px 8px}
      .dshDeskAccountChartHead{display:flex;align-items:baseline;gap:8px}
      .dshDeskAccountChartTotal{font-size:13px;font-weight:600;line-height:18px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
      .dshDeskAccountChartEmpty{margin:8px 0 12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
      .dshDeskAccountChartPlot{position:relative}
      .dshDeskAccountChartSvg{display:block;width:100%;height:auto}
      .dshDeskAccountChartGrid{stroke:var(--dsw-alias-border-secondary);stroke-width:1}
      .dshDeskAccountChartBar{fill:var(--dsw-alias-state-business-primary)}
      .dshDeskAccountChartLabel{fill:var(--dsw-alias-label-caption);font-size:9px}
      .dshDeskAccountChartHit{position:absolute;margin:0;padding:0;border:0;background:transparent;outline:none}
      .dshDeskAccountChartHit:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
      .dshDeskAccountChartTip{display:none;position:absolute;left:50%;bottom:calc(100% + 4px);z-index:2;transform:translateX(-50%);padding:3px 6px;border-radius:6px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-foreground);font-size:11px;line-height:14px;white-space:nowrap;pointer-events:none;font-variant-numeric:tabular-nums}
      .dshDeskAccountChartHit:hover .dshDeskAccountChartTip,.dshDeskAccountChartHit:focus-visible .dshDeskAccountChartTip{display:block}
      .dshDeskAccountBoard{margin-top:28px}
      .dshDeskAccountTabCount{font-weight:500;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-caption)}
      .dshDeskAccountBoard > .dshDeskAccountPanel{padding:12px 0 0;background:transparent}
      .dshDeskAccountEntries{display:flex;flex-direction:column;gap:12px;margin:0;padding:0;list-style:none}
      .dshDeskAccountEntry{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px}
      .dshDeskAccountEntryMain{min-width:0}
      .dshDeskAccountEntryTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:18px;overflow-wrap:anywhere}
      .dshDeskAccountEntryTime{margin:2px 0 0;color:var(--dsw-alias-label-caption);font-size:12px;line-height:16px}
      .dshDeskAccountEntryAmount{flex:none;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
      .dshDeskAccountEntryAmount[data-sign="plus"]{color:var(--dsw-alias-state-success-primary)}
      .dshDeskAccountModelSort{align-self:flex-start;width:fit-content;max-width:100%;margin:0 0 12px}
      .dshDeskAccountVendors{display:flex;flex-direction:column;gap:16px}
      .dshDeskAccountVendor{display:flex;flex-direction:column;gap:8px}
      .dshDeskAccountVendorName{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}
      .dshDeskAccountModels{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;margin:0;padding:0;list-style:none;align-items:stretch}
      .dshDeskAccountModels > li{display:flex;min-width:0}
      .dshDeskAccountModel{display:flex;flex:1;flex-direction:column;align-items:stretch;gap:6px;width:100%;min-width:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;color:var(--dsw-alias-label-primary);transition:background .16s ease-out}
      .dshDeskAccountModel:hover{background:color-mix(in srgb,var(--dsw-alias-bg-module-platform),var(--dsw-alias-label-primary) 5%)}
      .dshDeskAccountModelHead{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
      .dshDeskAccountModelName{margin:0;font-size:14px;font-weight:600;line-height:20px;overflow-wrap:anywhere}
      .dshDeskAccountModelMeta{display:flex;align-items:center;gap:4px}
      .dshDeskAccountSave{flex:none;color:var(--dsw-alias-state-success-primary);font-size:12px;font-weight:600;line-height:20px;font-variant-numeric:tabular-nums}
      .dshDeskAccountBill{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}
      .dshDeskAccountRates{display:flex;flex-direction:column;margin:0;padding:0 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
      .dshDeskAccountRate{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:28px;padding:4px 0}
      .dshDeskAccountRate + .dshDeskAccountRate{border-top:1px solid var(--dsw-alias-border-l2)}
      .dshDeskAccountRateLabel{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px}
      .dshDeskAccountRateValues{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:flex-end;gap:4px;min-width:0;font-variant-numeric:tabular-nums}
      .dshDeskAccountRateList{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;text-decoration:line-through}
      .dshDeskAccountRateNow{color:var(--dsw-alias-state-warn-label);font-size:14px;font-weight:700;line-height:18px}
      .dshDeskAccountRateUnit{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
      .dshDeskAccountCache{margin:0;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}
      .dshDeskAccountPrice{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
      .dshDeskAccountPriceNote{margin:0;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}
      .dshDeskAccountRetry{margin-top:16px}
      .dshDeskAccountEmpty{margin:8px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
      .dshDeskAccountNotice{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;padding:12px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);animation:dshDeskAccountFade .16s ease-out both}
      .dshDeskAccountNotice p{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
      .dshDeskAccountFooter{flex:none;display:flex;align-items:center;gap:10px;margin-top:20px}
      .dshDeskAccountFooter[data-align="end"]{justify-content:flex-end}
      .dshDeskAccountFooter[data-align="start"]{justify-content:flex-start}
      .dshDeskAccountFooter[data-align="stretch"]{align-items:stretch}
      /* 4px matches the field inset so the long action lines up with the inputs. */
      .dshDeskAccountFooter[data-align="stretch"] [data-dsh-account-primary]{flex:1 1 0;width:auto;min-width:0;margin-inline:4px;box-sizing:border-box}
      .dshDeskAccountStage{min-width:0}
      .dshDeskAccountBody[data-loading="true"] .dshDeskAccountStage{width:max-content;max-width:100%}
      .dshDeskAccountTitle,.dshDeskAccountDescription,.dshDeskAccountStage{animation:dshDeskAccountRise .16s ease-out both}
      .dshDeskAccountPanel[data-screen=auth]{overflow:visible}
      .dshDeskAccountContent[data-auth=true]{justify-content:center;overflow-y:auto;overflow-anchor:none;padding-bottom:120px}
      .dshDeskAccountContent[data-auth=true]>.dshDeskAccountAuthColumn{position:relative;align-self:center;box-sizing:border-box;width:min(400px,100%);max-width:100%;margin-inline:auto}
      .dshDeskAccountContent[data-auth=true] .dshDeskAccountHeader,.dshDeskAccountContent[data-auth=true] .dshDeskAccountDescription,.dshDeskAccountContent[data-auth=true] .dshDeskAccountFooter{padding-inline:32px}
      .dshDeskAccountContent[data-auth=true] .dshDeskAccountBody{flex:none;overflow:visible}
      .dshDeskAccountContent[data-auth=true] .dshDeskAccountTitle,.dshDeskAccountContent[data-auth=true] .dshDeskAccountDescription,.dshDeskAccountContent[data-auth=true] .dshDeskAccountStage{animation:none}
      .dshDeskAccountSlots{position:relative;display:flex;flex-direction:column}
      .dshDeskAccountLinkRow{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-width:0}
      .dshDeskAccountLinkRow[data-align="end"]{justify-content:flex-end}
      .dshDeskAccountCross{animation:dshDeskAccountFade 140ms ease both}
      .dshDeskAccountSlot[data-motion=enter]>.dshDeskAccountSlotBody{animation:dshDeskAccountFieldIn 220ms cubic-bezier(.22,.8,.24,1) both}
      .dshDeskAccountSlot[data-motion=exit]{pointer-events:none}
      .dshDeskAccountSlot[data-motion=exit]>.dshDeskAccountSlotBody{animation:dshDeskAccountFieldOut 180ms ease both}
      .dshDeskAccountLive{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
      @keyframes dshDeskAccountRise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      @keyframes dshDeskAccountFade{from{opacity:0}to{opacity:1}}
      @keyframes dshDeskAccountPresenceIn{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:none}}
      @keyframes dshDeskAccountFieldIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      @keyframes dshDeskAccountFieldOut{from{opacity:1;transform:none}to{opacity:0;transform:translateY(8px)}}
      @media (width<=560px){.dshDeskAccountToolbar,.dshDeskAccountContent>:not(.dshDeskAccountBody),.dshDeskAccountStage{padding-inline:20px}.dshDeskAccountContent{padding-bottom:20px}.dshDeskAccountHero,.dshDeskAccountMetrics{grid-template-columns:1fr}.dshDeskAccountContent[data-auth=true] .dshDeskAccountHeader,.dshDeskAccountContent[data-auth=true] .dshDeskAccountDescription,.dshDeskAccountContent[data-auth=true] .dshDeskAccountFooter{padding-inline:20px}}
      @media (height<=720px),(width<=560px){.dshDeskAccountContent[data-auth=true]{justify-content:flex-start;padding-bottom:32px}}
      @media (prefers-reduced-motion:reduce){.dshDeskAccountPack,.dshDeskAccountModel,.dshDeskAccountSlot,.dshDeskAccountSlotBody,.dshDeskAccountCross,.dshDeskAccountAuthColumn{transition:none}.dshDeskAccountTitle,.dshDeskAccountDescription,.dshDeskAccountStage,.dshDeskAccountFieldError,.dshDeskAccountAlert,.dshDeskAccountStatus,.dshDeskAccountNotice,.dshDeskAccountPresence,.dshDeskAccountSlot,.dshDeskAccountSlotBody,.dshDeskAccountCross{animation:none}}
    `

    function installStyles() {
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

    return { installStyles }
  }
})
