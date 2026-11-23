/** 人物、服装、姿势图库共用选图器。弹层、按钮和输入沿用设置对话框同一套宿主控件。 */
import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { modelReference, type OutfitReference, type OutfitReferenceApi, type OutfitReferenceKind, type OutfitListResult } from '../outfit-reference.ts'
import { outfitReferenceApi } from './outfit-reference-api.ts'
import { Select } from './Select.tsx'
import { tt } from './helpers.ts'
import type { ImageGenKey } from './locales.ts'
import { useImageGenLanguageTick } from './use-language.ts'
import css from './outfit-reference-picker.module.css'

const PAGE_SIZE = 24
const TITLE_KEYS: Record<OutfitReferenceKind, ImageGenKey> = {
  portrait: 'outfit.picker.portrait',
  costume: 'outfit.picker.costume',
  pose: 'outfit.picker.pose',
}
interface PickerProps {
  kind: OutfitReferenceKind
  api?: OutfitReferenceApi
  onSelect: (reference: OutfitReference) => void
  onClose: () => void
  /** 由工作台注入：用当前字渠道生成一张人像并直接存进模特库。
   *  图库本身不知道渠道与模型配置，也不应该知道。 */
  generateModel?: (prompt: string) => Promise<{ id: string; name: string; file: string }>
}

/** 禁止不可信数据让“查看来源”变成可执行或本机协议链接。 */
function safeSourceUrl(value: string): string | undefined {
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined } catch { return undefined }
}

/** 缩略图可能来自未缓存的来源站；失败时保留可选的文字卡。 */
function PickerThumbnail({ item }: { item: OutfitReference }): JSX.Element {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [item.thumbnailUrl])
  return failed || !item.thumbnailUrl
    ? <span className={css.missingThumbnail}>{tt('outfit.picker.missingThumb')}</span>
    : <img src={item.thumbnailUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
}

function filterOptions(current: string, allLabel: string, values: ReadonlyArray<{ value: string; label: string }>): Array<{ value: string; label: string }> {
  const options = [{ value: '', label: allLabel }, ...values.map(value => ({ value: value.value, label: value.label }))]
  if (current !== '' && !options.some(option => option.value === current)) options.push({ value: current, label: current })
  return options
}

/** 将远程图库项先物化成已缓存的同源原图，再把选择交给工作台。 */
export function OutfitReferencePicker({ kind, api = outfitReferenceApi, onSelect, onClose, generateModel }: PickerProps): JSX.Element {
  useImageGenLanguageTick()
  const alive = useRef(true)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [source, setSource] = useState('')
  const [angle, setAngle] = useState('')
  const [offset, setOffset] = useState(0)
  const [includeSensitive, setIncludeSensitive] = useState(false)
  const [reload, setReload] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const lastRefresh = useRef(0)
  const [listing, setListing] = useState<OutfitListResult | null>(null)
  const [facets, setFacets] = useState<Pick<OutfitListResult, 'categories' | 'sources' | 'angles'>>({ categories: [], sources: [], angles: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState<{ item: OutfitReference; viewId?: string; useDepth: boolean } | null>(null)
  /* Mobile back gesture (no extra button): on a phone the stacked detail pane
   * covers most of the dialog once an item is picked, so tapping the
   * still-visible filters is the natural way back to the grid. On the desktop
   * the preview rail sits beside the grid, so those clicks must NOT clear the
   * selection — the handler no-ops above 680px. This is a viewport query, not
   * a theme read. */
  const dismissSelectionOnUpperLevel = (): void => {
    if (globalThis.matchMedia?.('(max-width: 680px)').matches === true) setSelection(null)
  }
  const [preview, setPreview] = useState<{ selection: NonNullable<typeof selection>; reference: OutfitReference } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [previewImageFailed, setPreviewImageFailed] = useState(false)
  const [importPath, setImportPath] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [modelName, setModelName] = useState('')
  const [modelData, setModelData] = useState('')
  const [modelBusy, setModelBusy] = useState(false)
  const [modelMessage, setModelMessage] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const modelInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { setOffset(0); setQuery(input.trim()) }, 250)
    return () => window.clearTimeout(timer)
  }, [input])

  useEffect(() => {
    let ignore = false
    const force = refresh !== lastRefresh.current
    lastRefresh.current = refresh
    setLoading(true)
    setListing(null)
    setSelection(null)
    setError('')
    void api.list({ kind, query, category, source, angle, offset, limit: PAGE_SIZE, includeSensitive, refresh: force })
      .then(result => {
        if (ignore) return
        setListing(result)
        setFacets({ categories: result.categories, sources: result.sources, angles: result.angles })
      })
      .catch(cause => { if (!ignore) setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [api, kind, query, category, source, angle, offset, includeSensitive, refresh, reload])

  useEffect(() => {
    if (!selection) { setPreview(null); setPreviewLoading(false); return }
    let ignore = false
    setPreview(null)
    setPreviewError('')
    setPreviewImageFailed(false)
    setPreviewLoading(true)
    void api.materialize({ key: selection.item.key, viewId: selection.viewId, useDepth: selection.useDepth })
      .then(materialized => { if (!ignore) setPreview({ selection, reference: materialized }) })
      .catch(cause => { if (!ignore) setPreviewError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { if (!ignore) setPreviewLoading(false) })
    return () => { ignore = true }
  }, [api, selection])

  const readyPreview = preview?.selection === selection ? preview.reference : null
  /* One value drives both markers so the stylesheet cannot drift from what is
   * actually on screen: 'preview' means the figure is rendered, not merely that
   * an item is picked. */
  const pickerState: 'empty' | 'selected' | 'preview' = selection === null ? 'empty' : readyPreview !== null && !previewLoading && !previewError && !previewImageFailed ? 'preview' : 'selected'
  const choose = (): void => {
    if (!readyPreview || previewLoading || importing || !alive.current) return
    alive.current = false
    onSelect(readyPreview)
  }

  const importDirectory = async (): Promise<void> => {
    if (!importPath.trim() || importing) return
    setImporting(true)
    setImportMessage('')
    try {
      const result = await api.importDirectory(importPath.trim())
      if (!alive.current) return
      setImportMessage(tt('outfit.picker.imported', { count: result.count }))
      setOffset(0)
      setReload(value => value + 1)
    } catch (cause) {
      if (alive.current) setImportMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (alive.current) setImporting(false)
    }
  }

  /** 人物图库同时是模特库：选一张图存进宿主模特库，存好即可直接选中使用。 */
  const pickModelFile = async (file: File | undefined): Promise<void> => {
    if (!file || !alive.current) return
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { setModelMessage(tt('outfit.invalidImageType')); return }
    if (file.size === 0 || file.size > 20 * 1024 * 1024) { setModelMessage(tt('outfit.fileTooLarge')); return }
    setModelMessage('')
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(tt('outfit.readFailed')))
      reader.onerror = reader.onabort = () => reject(new Error(tt('outfit.readFailed')))
      reader.readAsDataURL(file)
    }).catch(cause => { if (alive.current) setModelMessage(cause instanceof Error ? cause.message : String(cause)); return '' })
    if (!data || !alive.current) return
    setModelData(data)
    setModelName(file.name.replace(/\.[^.]+$/, '').slice(0, 60))
  }
  const saveModel = async (): Promise<void> => {
    if (!api.saveModel || !modelData || modelBusy || !alive.current) return
    setModelBusy(true); setModelMessage('')
    try {
      const saved = await api.saveModel({ name: modelName.trim() || tt('outfit.picker.defaultModelName'), data: modelData, mime: /^data:(image\/[a-z]+);/.exec(modelData)?.[1] ?? 'image/png' })
      if (!alive.current) return
      setModelData(''); setModelName(''); setOffset(0); setReload(value => value + 1)
      // 存完就选中它：用户来这里就是要用这个人，不该再去列表里翻一遍。
      setSelection({ item: modelReference(saved), useDepth: false })
    } catch (cause) { if (alive.current) setModelMessage(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (alive.current) setModelBusy(false) }
  }

  const generateAiModel = async (): Promise<void> => {
    if (!generateModel || !aiPrompt.trim() || aiBusy || !alive.current) return
    setAiBusy(true); setModelMessage('')
    try {
      const saved = await generateModel(aiPrompt.trim())
      if (!alive.current) return
      setAiPrompt(''); setOffset(0); setReload(value => value + 1)
      setSelection({ item: modelReference(saved), useDepth: false })
    } catch (cause) { if (alive.current) setModelMessage(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (alive.current) setAiBusy(false) }
  }

  const pageCount = listing ? Math.ceil(listing.total / PAGE_SIZE) : 0
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1
  const sourceUrl = selection ? safeSourceUrl(selection.item.sourceUrl) : undefined
  const name = tt(TITLE_KEYS[kind])
  const canUse = Boolean(readyPreview) && !previewLoading && !previewImageFailed && !importing && !loading && error === ''
  const statusText = loading
    ? tt('outfit.picker.loading')
    : error !== ''
      ? tt('outfit.picker.loadFailed')
      : pageCount > 0
        ? tt('outfit.picker.statusPaged', { total: listing?.total ?? 0, page: currentPage, pages: pageCount })
        : tt('outfit.picker.status', { total: listing?.total ?? 0, page: currentPage })
  const modelExpanded = modelOpen || modelData !== '' || modelMessage !== ''
  const importExpanded = importOpen || importMessage !== ''
  if (typeof document === 'undefined') return <></>
  return <Modal
    open
    onClose={onClose}
    title={tt('outfit.picker.title', { name })}
    description={tt('outfit.picker.description')}
    closeLabel={tt('preview.close')}
    className={css.dialog}
    contentClassName={css.shell}
    footer={<div className={css.footer}>
      {sourceUrl
        ? <a className={css.sourceLink} href={sourceUrl} target="_blank" rel="noopener noreferrer">{tt('outfit.picker.sourceLink')} ↗</a>
        : <a className={css.sourceLink} href="https://github.com/anhao/ai-pose-gallery-zh" target="_blank" rel="noopener noreferrer">{tt('outfit.picker.projectLink')} ↗</a>}
      <div className={css.footerActions}>
        <Button type="button" variant="ghost" onClick={onClose}>{tt('preview.close')}</Button>
        <Button type="button" variant="primary" disabled={!canUse} onClick={choose}>{tt('outfit.picker.use')}</Button>
      </div>
    </div>}
  >
    <div className={css.panel} data-outfit-reference-picker="">
      <div className={css.toolbar} onClick={dismissSelectionOnUpperLevel}>
        <Input
          data-modal-autofocus=""
          type="search"
          className={css.search}
          value={input}
          placeholder={tt('outfit.picker.searchPlaceholder', { name })}
          aria-label={tt('outfit.picker.searchLabel')}
          onChange={event => setInput(event.target.value)}
        />
        <Select
          variant="compact"
          aria-label={tt('outfit.picker.category')}
          value={category}
          options={filterOptions(category, tt('outfit.picker.allCategories'), facets.categories.map(value => ({ value, label: value })))}
          onChange={value => { setCategory(value); setOffset(0) }}
        />
        <Select
          variant="compact"
          aria-label={tt('outfit.picker.source')}
          value={source}
          options={filterOptions(source, tt('outfit.picker.allSources'), facets.sources.map(value => ({ value: value.id, label: value.label })))}
          onChange={value => { setSource(value); setOffset(0) }}
        />
        {kind === 'pose' ? <Select
          variant="compact"
          aria-label={tt('outfit.picker.angle')}
          value={angle}
          options={filterOptions(angle, tt('outfit.picker.allAngles'), facets.angles.map(value => ({ value, label: value })))}
          onChange={value => { setAngle(value); setOffset(0) }}
        /> : null}
        <Checkbox className={css.check} checked={includeSensitive} label={tt('outfit.picker.sensitive')} onChange={next => { setIncludeSensitive(next); setOffset(0) }} />
      </div>
      {listing?.warnings.map((warning, index) => <p key={`${warning}-${index}`} className={css.warning} role="status">{warning}</p>)}
      <div className={css.tools}>
      {kind === 'portrait' && (api.saveModel || generateModel) ? <div className={css.modelRow} data-outfit-model-add="">
          <Button type="button" variant="ghost" size="sm" aria-expanded={modelExpanded} onClick={() => setModelOpen(value => !value)}>{tt('outfit.picker.myModels')}</Button>
          {modelExpanded ? <div className={css.modelBody}>
            {modelData
              ? <>
                <img className={css.modelPick} src={modelData} alt={tt('outfit.picker.modelPreviewAlt')} />
                <Input className={css.modelName} type="text" value={modelName} aria-label={tt('outfit.picker.modelName')} placeholder={tt('outfit.picker.modelName')} onChange={event => setModelName(event.target.value)} />
                <Button type="button" variant="primary" size="sm" disabled={modelBusy} onClick={() => void saveModel()}>{modelBusy ? tt('outfit.picker.savingModel') : tt('outfit.picker.saveModel')}</Button>
                <Button type="button" variant="ghost" size="sm" disabled={modelBusy} onClick={() => { setModelData(''); setModelName(''); setModelMessage('') }}>{tt('outfit.picker.cancel')}</Button>
              </>
              : <>
                <span className={css.modelRowNote}>{tt('outfit.picker.modelNote')}</span>
                {api.saveModel ? <Button type="button" variant="outline" size="sm" onClick={() => modelInput.current?.click()}>{tt('outfit.picker.addPhoto')}</Button> : null}
              </>}
            {generateModel && !modelData ? <>
              <Input className={css.modelName} type="text" value={aiPrompt} aria-label={tt('outfit.picker.aiPrompt')} placeholder={tt('outfit.picker.aiPlaceholder')} onChange={event => setAiPrompt(event.target.value)} />
              <Button type="button" variant="outline" size="sm" disabled={aiBusy || !aiPrompt.trim()} onClick={() => void generateAiModel()}>{aiBusy ? tt('outfit.picker.aiGenerating') : tt('outfit.picker.aiGenerate')}</Button>
            </> : null}
            {modelMessage ? <span role="alert" className={css.modelRowError}>{modelMessage}</span> : null}
          </div> : null}
          <input ref={modelInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { void pickModelFile(event.target.files?.[0]); event.target.value = '' }} />
        </div> : null}
        <div className={css.importWrap}>
          <Button type="button" variant="ghost" size="sm" aria-expanded={importExpanded} onClick={() => setImportOpen(value => !value)}>{tt('outfit.picker.import')}</Button>
          {importExpanded ? <form className={css.importRow} onSubmit={event => { event.preventDefault(); void importDirectory() }}>
            <label className={css.importLabel} htmlFor="outfit-reference-directory">{tt('outfit.picker.importLabel')}</label>
            <Input id="outfit-reference-directory" className={css.importInput} type="text" value={importPath} onChange={event => setImportPath(event.target.value)} placeholder={tt('outfit.picker.importPlaceholder')} />
            <Button type="submit" variant="outline" size="sm" disabled={!importPath.trim() || importing}>{importing ? tt('outfit.picker.importing') : tt('outfit.picker.import')}</Button>
            {importMessage ? <span role="status" className={css.importMessage}>{importMessage}</span> : null}
          </form> : null}
        </div>
      </div>
      {/* The stacked ≤680px layout keys its row split off the picker's own state
       * (nothing picked / a picked item without its preview yet / preview in
       * hand). Marked here as data attributes and read by the stylesheet, per
       * docs/native-ui-contract.md §4.3: a `:has()` that infers the same thing
       * from the subtree is invisible to jsdom, so the rule would sit outside
       * every test. Empty detail is hidden at every width so the grid can use
       * the full card until something is picked. */}
      <div className={css.content} data-picker-state={pickerState}>
        <section className={css.browser} aria-label={tt('outfit.picker.list', { name })}>
          <div className={css.browserScroll}>
            {error ? <div className={css.notice} role="alert">{error}<Button type="button" variant="outline" size="sm" onClick={() => setReload(value => value + 1)}>{tt('outfit.picker.retry')}</Button></div> : null}
            {loading ? <p className={css.notice} role="status">{tt('outfit.picker.fetching')}</p> : null}
            {!loading && !error && listing?.total === 0 ? <p className={css.notice}>{tt('outfit.picker.empty')}</p> : null}
            {!loading && !error && listing ? <ul className={css.grid}>
              {listing.items.map(item => <li key={item.key}>
                <button type="button" className={css.card} aria-pressed={selection?.item.key === item.key}
                  onClick={() => setSelection({ item, viewId: item.viewId || item.views?.[0]?.id, useDepth: false })}>
                  <span className={css.thumbnail}><PickerThumbnail item={item} /></span>
                  <span className={css.cardName}>{item.title}</span>
                  {item.sensitive ? <span className={css.sensitive}>18+</span> : null}
                </button>
              </li>)}
            </ul> : null}
          </div>
          <nav className={css.pagination} aria-label={tt('outfit.picker.pagination')}>
            <span role="status" className={css.pageStatus}>{statusText}</span>
            <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => setRefresh(value => value + 1)}>{tt('outfit.picker.refresh')}</Button>
            {listing?.revision ? <span className={css.revision}>{tt('outfit.picker.revision', { revision: listing.revision.slice(0, 10) })}</span> : null}
            <span className={css.pageActions}>
              <Button type="button" variant="outline" size="sm" disabled={!listing || offset === 0} onClick={() => setOffset(value => Math.max(0, value - PAGE_SIZE))}>{tt('outfit.picker.prev')}</Button>
              <span>{listing ? tt('outfit.picker.page', { page: currentPage, pages: Math.max(pageCount, 1) }) : ''}</span>
              <Button type="button" variant="outline" size="sm" disabled={!listing || offset + PAGE_SIZE >= listing.total} onClick={() => setOffset(value => value + PAGE_SIZE)}>{tt('outfit.picker.next')}</Button>
            </span>
          </nav>
        </section>
        <aside className={css.detail} aria-label={tt('outfit.picker.detail')} data-picker-detail={pickerState === 'empty' ? 'empty' : 'selected'}>
          {selection ? <>
            <h3>{selection.item.title}</h3>
            <p className={css.meta}>{selection.item.category}{selection.item.angle ? ` · ${selection.item.angle}` : ''}</p>
            <p className={css.meta}>{facets.sources.find(value => value.id === selection.item.source)?.label ?? selection.item.source}</p>
            {selection.item.tags.length > 0 ? <p className={css.tags}>{selection.item.tags.slice(0, 8).join(' · ')}</p> : null}
            {selection.item.views && selection.item.views.length > 0 ? <div className={css.viewSelect}>
              <span id="outfit-picker-view">{tt('outfit.picker.view')}</span>
              <Select
                aria-labelledby="outfit-picker-view"
                value={selection.viewId ?? ''}
                options={selection.item.views.map(view => ({ value: view.id, label: view.label }))}
                onChange={value => setSelection({ ...selection, viewId: value })}
              />
            </div> : null}
            {kind === 'pose' ? <Checkbox className={css.check} checked={selection.useDepth} label={tt('outfit.picker.depth')} onChange={next => setSelection({ ...selection, useDepth: next })} /> : null}
            {previewLoading ? <p role="status">{tt('outfit.picker.caching')}</p> : null}
            {previewError ? <p className={css.error} role="alert">{tt('outfit.picker.originalFailed', { error: previewError })}<Button type="button" variant="outline" size="sm" onClick={() => setSelection({ ...selection })}>{tt('outfit.picker.retryOriginal')}</Button></p> : null}
            {readyPreview && !previewLoading && !previewError ? <figure className={css.preview}>
              {previewImageFailed
                ? <div className={css.previewFailed} role="alert">{tt('outfit.picker.previewFailed')}<Button type="button" variant="outline" size="sm" onClick={() => setSelection({ ...selection })}>{tt('outfit.picker.retryOriginal')}</Button></div>
                : <img src={readyPreview.imageUrl} alt={tt('outfit.picker.previewAlt', { title: readyPreview.title })} onError={() => setPreviewImageFailed(true)} />}
              {!previewImageFailed ? <figcaption>{tt('outfit.picker.previewCaption')}</figcaption> : null}
            </figure> : null}
            <p className={css.license}>{selection.item.notice ?? tt('outfit.picker.defaultNotice')}</p>
          </> : <p className={css.notice}>{tt('outfit.picker.pickHint')}</p>}
        </aside>
      </div>
    </div>
  </Modal>
}
