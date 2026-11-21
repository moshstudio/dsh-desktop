/**
 * One failure message, with the provider's raw text behind a disclosure.
 *
 * WHY this exists: the panel used to print whatever the upstream returned
 * verbatim — an English sentence carrying the provider's internal address
 * (`http://43.136.81.63:8317/v1/images/generations`) or a bare `request id`.
 * That reads as the app's own voice, leaks an address the user cannot act on,
 * and buries the one thing they can act on ("generation failed") under it.
 *
 * So the summary is the app speaking, and the raw text is one click away where
 * it stays useful for a bug report. Nothing is discarded: the disclosure holds
 * the exact original string, selectable and copyable.
 */
import { useState } from 'react'
import { generationFailureSummaryKey } from './generation-failure.ts'
import { tt } from './helpers.ts'
import css from './error-detail.module.css'

export interface ErrorDetailProps {
  /** The provider's own message, shown unchanged once expanded. */
  message: string
  /** Localized one-line summary. Omitted: classified from `message`. */
  summary?: string
  /** Tone of the summary line. `inline` keeps it on the caller's own row. */
  layout?: 'block' | 'inline'
  /** `center` for a node card; banners stay start-aligned. */
  align?: 'start' | 'center'
}

/**
 * @param props.message - raw upstream text.
 * @param props.summary - optional localized headline.
 * @param props.layout - `block` puts the summary on its own line above the
 *   disclosure (canvas error banner, task rows); `inline` appends the
 *   disclosure to the caller's text so a compact row stays one line.
 * @param props.align - `center` centers the headline inside a node card.
 */
export function ErrorDetail({ message, summary, layout = 'block', align = 'start' }: ErrorDetailProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const classified = summary === undefined ? generationFailureSummaryKey(message) : null
  const headline = summary ?? (classified === null ? message.trim() : tt(classified))
  const raw = message.trim()
  const showRaw = raw !== '' && raw !== headline.trim()
  return <div className={css.root} data-error-detail="" data-layout={layout} data-align={align}>
    <p className={css.summary} role="alert">
      <span>{headline}</span>
      {showRaw ? <button
        type="button"
        className={css.toggle}
        aria-expanded={open}
        data-error-toggle=""
        onClick={() => { setOpen(value => !value) }}
      >{tt(open ? 'error.detailHide' : 'error.detailShow')}</button> : null}
    </p>
    {open && showRaw ? <pre className={css.detail} data-error-raw="" tabIndex={0}>{message}</pre> : null}
  </div>
}
