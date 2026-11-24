/**
 * "让 AI 猜你喜欢什么插件" under the discover teasers.
 *
 * Nothing runs until the user clicks: the click is what lets the market read
 * their installed and favorited plugins and spend their tokens. Picks use the
 * catalog cards with the model's reason as the description.
 * The last set is kept on this device so reopening the market shows it again
 * without asking the model.
 */
import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react'
import { Button, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './Market.module.css'
import { api, type RegistryPlugin } from './market-data.ts'
import type { FindResult } from './FindPluginCard.tsx'
import { IconQuestionOutline14 } from './icons.ts'
import { openModelSettings } from './model-settings.ts'
import { CatalogGrid } from './MarketLayout.tsx'
import { parseSavedAiRecommend, type SavedAiPick, type SavedAiRecommend } from './discover-teasers.ts'

type Translate = (key: string) => string
const STORAGE_KEY = 'taichi-dshm-ai-recommend'
const EMPTY: SavedAiRecommend = { picks: [], intro: '' }

type RecState =
  | { phase: 'idle' }
  | ({ phase: 'running' } & SavedAiRecommend)
  | ({ phase: 'done' } & SavedAiRecommend)
  | { phase: 'error'; code: string; message: string }

function readSaved(): SavedAiRecommend | null {
  try {
    return parseSavedAiRecommend(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

function save(value: SavedAiRecommend | null): void {
  try {
    if (value === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify({ picks: value.picks, intro: value.intro, at: new Date().toISOString() }))
  } catch { /* storage unavailable: the set just is not kept */ }
}

export function AiRecommend({ t, lang, plugins, renderCard }: {
  t: Translate
  lang: string
  plugins: RegistryPlugin[]
  renderCard: (plugin: RegistryPlugin, why: string) => ReactElement
}): ReactElement {
  const [state, setState] = useState<RecState>(() => {
    const saved = readSaved()
    return saved === null ? { phase: 'idle' } : { phase: 'done', ...saved }
  })
  const [setupFailed, setSetupFailed] = useState(false)
  const seq = useRef(0)

  const byUrl = useMemo(() => new Map(plugins.map(plugin => [plugin.url, plugin])), [plugins])
  const namesOf = useCallback((picks: readonly SavedAiPick[]) => picks.flatMap(pick => byUrl.get(pick.url)?.name ?? []), [byUrl])

  const run = useCallback((exclude: string[], previous: SavedAiRecommend) => {
    const mine = ++seq.current
    setSetupFailed(false)
    setState({ picks: previous.picks, intro: previous.intro, phase: 'running' })
    fetch(api('/taichi-dsh-market/ai-recommend'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ exclude, lang }),
    })
      .then(res => res.json().then((body: { result?: FindResult; code?: string; error?: string }) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (mine !== seq.current) return
        if (ok && body.result !== undefined) {
          const picks = body.result.picks.flatMap(pick => (
            typeof pick.url === 'string' && pick.url !== '' ? [{ url: pick.url, why: pick.why }] : []
          ))
          const next = { picks, intro: body.result.intro }
          save(next)
          setState({ phase: 'done', ...next })
        } else setState({ phase: 'error', code: body.code ?? 'model-failed', message: body.error ?? '' })
      })
      .catch((error: unknown) => {
        if (mine === seq.current) setState({ phase: 'error', code: 'model-failed', message: error instanceof Error ? error.message : String(error) })
      })
  }, [lang])

  const close = useCallback(() => {
    seq.current += 1
    save(null)
    setState({ phase: 'idle' })
  }, [])

  const setup = useCallback(() => {
    void openModelSettings().then(ok => { if (!ok) setSetupFailed(true) })
  }, [])

  const shown = state.phase === 'done' || state.phase === 'running' ? state.picks : EMPTY.picks
  const entries = useMemo(
    () => shown.flatMap(pick => {
      const plugin = byUrl.get(pick.url)
      return plugin === undefined ? [] : [{ plugin, why: pick.why }]
    }),
    [shown, byUrl],
  )

  if (state.phase === 'idle') {
    return (
      <div className={css.recTrigger} data-taichi-dshm-ai-recommend="idle">
        <button type="button" className={css.fpLink} onClick={() => run([], EMPTY)}>{t('recTrigger')}</button>
        <Tooltip label={t('recHelp')} side="bottom" delayMs={150} portal maxWidth={320}>
          <span className={css.aiHelp} tabIndex={0} aria-label={t('recHelp')}><IconQuestionOutline14 size={14} /></span>
        </Tooltip>
      </div>
    )
  }

  return (
    <section className={css.recBlock} aria-labelledby="taichi-dshm-ai-recommend" data-taichi-dshm-ai-recommend={state.phase}>
      <div className={css.recHead}>
        <h3 id="taichi-dshm-ai-recommend" className={css.favoritesSectionHead}>{t('recTitle')}</h3>
        <span className={css.recActions}>
          {state.phase === 'done' && <Button variant="ghost" size="sm" className={css.recentHide} onClick={() => run(namesOf(state.picks), state)}>{t('recMore')}</Button>}
          <Button variant="ghost" size="sm" className={css.recentHide} onClick={close}>{t('recClose')}</Button>
        </span>
      </div>
      <div className={css.recStatus}>
        {state.phase === 'running' && <span>{t('recRunning')}</span>}
        {state.phase === 'done' && state.intro !== '' && <span>{state.intro}</span>}
        {state.phase === 'done' && <span>{entries.length === 0 ? t('recEmpty') : t('fpFoot')}</span>}
        {state.phase === 'error' && state.code === 'no-model' && (
          <>
            <span data-tone="error">{t('recNoModel')}</span>
            <Button size="sm" variant="primary" onClick={setup}>{t('recSetupModel')}</Button>
            {setupFailed && <span>{t('recSetupManual')}</span>}
          </>
        )}
        {state.phase === 'error' && state.code === 'no-seeds' && <span>{t('recNoSeeds')}</span>}
        {state.phase === 'error' && state.code !== 'no-model' && state.code !== 'no-seeds' && (
          <>
            <span data-tone="error">{t('recFailed') + state.message}</span>
            <Button size="sm" variant="outline" onClick={() => run([], EMPTY)}>{t('recRetry')}</Button>
          </>
        )}
      </div>
      {entries.length > 0 && (
        <CatalogGrid items={entries} render={entry => renderCard(entry.plugin, entry.why)} />
      )}
    </section>
  )
}
