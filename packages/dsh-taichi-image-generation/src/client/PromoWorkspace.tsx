/**
 * 带货图文 (promo image + copy) workspace.
 *
 * WHY this file exists at all: the surface used to be a single row of seven
 * bare controls because (a) the stylesheet had no layout, and (b) the host kept
 * the classic 300px config sidebar laid out beside it, squeezing `.root` into a
 * ~2px column. The second half is fixed by the two `:global([data-workspace=...])`
 * rules in `outfit-workspace.module.css`; this file's job is the first half.
 *
 * FUNCTION IS UNCHANGED from the 14-line version this replaces: the same
 * `fetchEcommerceLink` backfill, the same `promoImagePrompt(platform, name,
 * points)` call, the same `enhancePrompt` JSON parse, and the same clipboard
 * fallback path. Two structural changes worth naming:
 *
 * 1. THE PLATFORM CHOICE IS THE HOST SEGMENTED CONTROL. Same four values
 *    (`xiaohongshu / douyin / taobao / dewu`); labels come from the locale
 *    tables. `promoImagePrompt` still switches on the values.
 * 2. THE GENERATED COPY IS EDITABLE. `copy` is state, so the title and body stay
 *    inputs after generation. A model's first draft is a draft; the copy button
 *    copies what is on screen, not what the model returned.
 */
import { useState } from 'react'
import { Button, Input, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import { ImageGenApi } from './api.ts'
import type { ImageGenConfig } from './settings-scope.ts'
import { tt } from './helpers.ts'
import type { ImageGenKey } from './locales.ts'
import { useImageGenLanguageTick } from './use-language.ts'
import { promoImagePrompt, type PromoPlatform } from './promo-prompt.ts'
import css from './outfit-workspace.module.css'
import segmented from './segmented.module.css'

/** The four styles, in the same order the old `<select>` carried. Labels are
 *  locale keys; `value` is what `promoImagePrompt` switches on. */
const PLATFORMS: ReadonlyArray<{ value: PromoPlatform; label: ImageGenKey }> = [
  { value: 'xiaohongshu', label: 'promo.platform.xiaohongshu' },
  { value: 'douyin', label: 'promo.platform.douyin' },
  { value: 'taobao', label: 'promo.platform.taobao' },
  { value: 'dewu', label: 'promo.platform.dewu' },
]

export default function PromoWorkspace({ api = new ImageGenApi(), config, active = true }: { api?: ImageGenApi; config?: ImageGenConfig; active?: boolean }): JSX.Element {
  useImageGenLanguageTick()
  const [name, setName] = useState(''); const [points, setPoints] = useState(''); const [url, setUrl] = useState(''); const [platform, setPlatform] = useState<PromoPlatform>('xiaohongshu'); const [busy, setBusy] = useState(false); const [status, setStatus] = useState(''); const [copy, setCopy] = useState<{ title: string; body: string; tags: string[] } | null>(null); const [image, setImage] = useState<string>('')
  const model = config?.channels?.find(channel => channel.id === config.defaultChannelId)?.models?.[0]?.alias ?? config?.channels?.[0]?.models?.[0]?.alias ?? ''
  const fetchLink = async () => { if (!url.trim()) return; setBusy(true); setStatus(tt('promo.fetching')); try { const result = await api.fetchEcommerceLink(url.trim()); if (!result.ok) throw new Error(result.reason ?? 'fetch-failed'); setName(result.title ?? ''); setPoints((result.sellingPoints ?? []).join('\n')); setStatus(tt('promo.fetchSuccess')); } catch (error) { setStatus(`${tt('promo.fetchFailed')}: ${error instanceof Error ? error.message : String(error)}`) } finally { setBusy(false) } }
  const generate = async () => { if (!name.trim() || !model) return; setBusy(true); setStatus(''); try { const result = await api.generate({ mode: 'text', prompt: promoImagePrompt(platform, name, points), model, size: '3:4', quality: 'medium', detail: 'auto', n: 1 }); const first = result.images?.[0]; setImage((first?.b64 ? `data:${first.mime ?? 'image/png'};base64,${first.b64}` : '')); const generated = await api.enhancePrompt(`Return JSON only with title, body, tags (string array) for ${platform}. Product: ${name}. Selling points: ${points}`); setCopy(JSON.parse(generated)); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) } }
  const copyText = async () => { if (!copy) return; const value = `${copy.title}\n\n${copy.body}\n\n${copy.tags.map(tag => tag.startsWith('#') ? tag : `#${tag}`).join(' ')}`; try { await navigator.clipboard.writeText(value); setStatus(tt('promo.copied')) } catch { const area = document.createElement('textarea'); area.value = value; document.body.append(area); area.select(); document.execCommand('copy'); area.remove(); setStatus(tt('promo.copied')) } }
  const ready = !busy && name.trim() !== ''
  return <section className={css.root} data-promo="true" hidden={!active}>
    <header className={css.intro}>
      <div>
        <h2>{tt('promo.title')}</h2>
        <p>{tt('promo.hint')}</p>
      </div>
      <div className={css.aside}>
        <span className={css.badge}>{tt(PLATFORMS.find(option => option.value === platform)?.label ?? 'promo.platform.xiaohongshu')}</span>
      </div>
    </header>

    <div className={css.body}>
      <form className={css.form} onSubmit={event => { event.preventDefault(); void generate() }}>
        {/* ------------------------------------------------------ link fetch */}
        <div className={css.field}>
          <div className={css.fieldHead}>
            <span className={css.fieldLabel}>{tt('promo.section.link')}</span>
            <span className={css.fieldNote}>{tt('promo.linkNote')}</span>
          </div>
          <div className={css.inline}>
            <Input className={css.stretch} value={url} onChange={e => setUrl(e.target.value)} placeholder={tt('link.placeholder')} />
            <Button type="button" variant="outline" disabled={busy || url.trim() === ''} onClick={() => void fetchLink()}>{tt('link.fetch')}</Button>
          </div>
        </div>

        {/* ----------------------------------------------------- product info */}
        <div className={css.field}>
          <div className={css.fieldHead}>
            <span className={css.fieldLabel}>{tt('promo.section.product')}</span>
            <span className={css.fieldNote}>{tt('promo.points')}</span>
          </div>
          <Input className={css.stretch} value={name} onChange={e => setName(e.target.value)} placeholder={tt('promo.productName')} />
          <textarea className={css.textarea} value={points} onChange={e => setPoints(e.target.value)} placeholder={tt('promo.points')} />
        </div>

        {/* -------------------------------------------------------- platform */}
        <div className={css.field}>
          <div className={css.fieldHead}>
            <span className={css.fieldLabel}>{tt('promo.section.platform')}</span>
            <span className={css.fieldNote}>{tt('promo.platformNote')}</span>
          </div>
          <SegmentedControl
            id="promo-platform"
            className={segmented.wrap}
            value={platform}
            label={tt('promo.section.platform')}
            options={PLATFORMS.map(option => ({ value: option.value, label: tt(option.label) }))}
            onChange={value => {
              if (value === 'xiaohongshu' || value === 'douyin' || value === 'taobao' || value === 'dewu') setPlatform(value)
            }}
          />
        </div>

        <div className={css.submitBar}>
          <div className={css.submitRow}>
            <Button type="submit" variant="primary" disabled={!ready}>{busy ? tt('promo.fetching') : tt('promo.generate')}</Button>
            <span className={css.fieldNote}>{tt('promo.submitNote')}</span>
          </div>
          {status ? <p role="status" className={css.muted}>{status}</p> : null}
        </div>
      </form>

      <section className={css.results}>
        {image === '' && copy === null ? (
          <div className={css.empty}>
            <span>{tt('promo.emptyResults')}</span>
          </div>
        ) : (
          <div className={css.promoOutputs}>
            {image === '' ? null : <img className={css.output} src={image} alt={tt('promo.imageAlt')} />}
            {copy === null ? null : (
              <div className={css.copyCard}>
                <Input className={css.stretch} value={copy.title} aria-label={tt('promo.productName')} onChange={e => setCopy({ ...copy, title: e.target.value })} />
                <textarea className={css.copyBody} value={copy.body} aria-label={tt('promo.points')} onChange={e => setCopy({ ...copy, body: e.target.value })} />
                <ul className={css.tags}>{copy.tags.map(tag => <li className={css.tag} key={tag}>{`#${tag.replace(/^#/, '')}`}</li>)}</ul>
                <Button type="button" variant="outline" onClick={() => void copyText()}>{tt('promo.copy')}</Button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  </section>
}
