/**
 * One horizontal teaser row shared by 推荐安装, 最近收录, and AI 猜你喜欢.
 * The row stays one tile tall; extra plugins scroll, and the arrows say so
 * when the scrollbar itself does not.
 */

import { useEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './Market.module.css'
import {
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  IconQuestionOutline14,
} from './icons.ts'
import type { RegistryPlugin } from './market-data.ts'

type ArrowKey = 'recentPrev' | 'recentNext'

export function StripArrows({ rowRef, t }: { rowRef: RefObject<HTMLDivElement>; t: (key: ArrowKey) => string }): ReactElement | null {
  const [edges, setEdges] = useState({ left: false, right: false })
  useEffect(() => {
    const row = rowRef.current
    if (row === null) return
    const measure = () => {
      const max = row.scrollWidth - row.clientWidth
      setEdges({ left: row.scrollLeft > 2, right: row.scrollLeft < max - 2 })
    }
    measure()
    row.addEventListener('scroll', measure, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(row)
    return () => { row.removeEventListener('scroll', measure); observer?.disconnect() }
  }, [rowRef])
  if (!edges.left && !edges.right) return null
  const page = (direction: 1 | -1) => {
    const row = rowRef.current
    if (row === null) return
    row.scrollBy({ left: direction * row.clientWidth * 0.85, behavior: 'smooth' })
  }
  return (
    <span className={css.recentArrows}>
      <button type="button" className={css.recentArrow} disabled={!edges.left} aria-label={t('recentPrev')} onClick={() => page(-1)}>
        <IconChevronLeftOutline14 size={14} />
      </button>
      <button type="button" className={css.recentArrow} disabled={!edges.right} aria-label={t('recentNext')} onClick={() => page(1)}>
        <IconChevronRightOutline14 size={14} />
      </button>
    </span>
  )
}

export function StripRow({ id, rowRef, children }: {
  id: string
  rowRef: RefObject<HTMLDivElement>
  children: ReactNode
}): ReactElement {
  return (
    <div id={id} ref={rowRef} className={css.recentRow}>
      {children}
    </div>
  )
}

export function DiscoverStrip({ titleId, gridId, title, help, plugins, tile, t }: {
  titleId: string
  gridId: string
  title: string
  help?: string
  plugins: readonly RegistryPlugin[]
  tile: (plugin: RegistryPlugin) => ReactElement
  t: (key: ArrowKey) => string
}): ReactElement {
  const rowRef = useRef<HTMLDivElement>(null)
  return (
    <section className={css.recentBlock} aria-labelledby={titleId}>
      <div className={css.recentHead}>
        <h3 id={titleId} className={css.favoritesSectionHead}>
          {title}
          {help !== undefined && (
            <Tooltip label={help} side="bottom" delayMs={150} portal maxWidth={320}>
              <span className={css.aiHelp} tabIndex={0} aria-label={help}><IconQuestionOutline14 size={14} /></span>
            </Tooltip>
          )}
        </h3>
        <StripArrows rowRef={rowRef} t={t} />
      </div>
      <div id={gridId} ref={rowRef} className={css.recentRow}>
        {plugins.map(plugin => tile(plugin))}
      </div>
    </section>
  )
}
