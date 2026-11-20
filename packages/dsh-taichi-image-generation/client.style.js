window.__ModuleLoader__.load({
  id: 'dsh-taichi-image-generation',
  chunk: 'client.style.js',
  factory: () => {
    const css = `
.dshTaichiImagePanel{box-sizing:border-box;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dshTaichiImageToolbar{box-sizing:border-box;flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;padding:12px 32px 0}
.dshTaichiImageToolbar :is(button,a,input,textarea){-webkit-app-region:no-drag}
.dshTaichiImageTitle{margin:0;font-size:20px;font-weight:500;line-height:28px}
.dshTaichiImageBody{box-sizing:border-box;flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;padding:16px 32px 24px}
.dshTaichiImageStage{box-sizing:border-box;flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;overflow:hidden;border-radius:16px;background:var(--dsw-alias-bg-layer-2)}
.dshTaichiImageStage>.dshTaichiImageCanvas{flex:1;align-self:stretch;min-height:0;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}
.dshTaichiImagePreview{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;width:100%;padding:0;border:0;background:transparent;color:inherit;cursor:zoom-in}
.dshTaichiImageResult{display:block;max-width:100%;max-height:100%;object-fit:contain;border-radius:12px;background:var(--dsw-alias-bg-base);transition:opacity .16s ease}
.dshTaichiImageCanvas[data-generating=true] .dshTaichiImageResult{opacity:.45}
.dshTaichiImageResultActions{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}
.dshTaichiImageEmpty{display:flex;flex-direction:column;align-items:center;gap:12px;max-width:360px;text-align:center}
.dshTaichiImageStatus{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);text-align:center}
.dshTaichiImageError{color:var(--dsw-alias-state-error-primary)}
.dshTaichiImageBody>.dshTaichiImageError{text-align:start}
.dshTaichiImageStrip{flex:none;display:flex;gap:8px;margin:0;overflow-x:auto}
.dshTaichiImageThumb{display:block;width:56px;height:56px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);cursor:pointer}
.dshTaichiImageThumb[aria-current=true]{border-color:var(--dsw-alias-brand-primary)}
.dshTaichiImageThumb img{display:block;width:100%;height:100%;object-fit:cover}
.dshTaichiImageThumb:disabled{cursor:default;opacity:.45}
.dshTaichiImagePreview:focus-visible,.dshTaichiImageThumb:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshTaichiImageComposer{display:flex;flex-direction:column;gap:12px;margin:0;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1)}
/* Prompt has no primitive. Input is single-line, so the composer keeps a textarea. */
.dshTaichiImagePrompt{box-sizing:border-box;width:100%;min-height:72px;max-height:160px;margin:0;padding:4px;border:0;resize:vertical;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px}
.dshTaichiImagePrompt::placeholder{color:var(--dsw-alias-label-tertiary)}
.dshTaichiImagePrompt:focus{outline:none}
.dshTaichiImagePrompt:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshTaichiImageControls{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.dshTaichiImageChoice{display:flex;align-items:center;gap:8px;min-width:0}
.dshTaichiImageChoiceLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}
.dshTaichiImageSubmit{margin-inline-start:auto}
@media (width<=560px){
  .dshTaichiImageToolbar{padding-inline:16px}
  .dshTaichiImageBody{padding-inline:16px}
}
html[data-platform=darwin] [data-sidebar-collapsed] .dshTaichiImageToolbar{padding-top:var(--dsh-frame-top-clearance,48px);padding-inline-start:var(--dsh-frame-leading-clearance,160px)}
html[data-platform=darwin] .dshTaichiImageToolbar{-webkit-app-region:drag}
@media (prefers-reduced-motion:reduce){.dshTaichiImageResult{transition:none}}
`
    function installStyles() {
      if (document.querySelector('style[data-plugin-css="dsh-taichi-image-generation"]')) return
      const style = document.createElement('style')
      style.dataset.pluginCss = 'dsh-taichi-image-generation'
      style.textContent = css
      document.head.appendChild(style)
    }
    return { installStyles }
  }
})
