/**
 * Discover categories: a sticky rail when the market is wide, a scrolling
 * chip row when it is not. The stylesheet picks which one is visible.
 */

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import css from './Market.module.css'
import { categoryLabel, formatCount, pluginCategories, type Registry, type Translate } from './market-data.ts'

export function CategoryRail({
  data, categories, cat, lang, onSelect, t, mode,
}: {
  data: Registry
  categories: string[]
  cat: string
  lang: string
  onSelect: (id: string) => void
  t: Translate
  mode: 'rail' | 'chips'
}) {
  const chipsRef = useRef<HTMLDivElement>(null)
  const [chipsFade, setChipsFade] = useState(false)
  useLayoutEffect(() => {
    if (mode !== 'chips') return
    const el = chipsRef.current
    if (el === null) return
    const measure = () => setChipsFade(el.scrollWidth - el.clientWidth - el.scrollLeft > 8)
    measure()
    el.addEventListener('scroll', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(el)
    return () => {
      observer?.disconnect()
      el.removeEventListener('scroll', measure)
    }
  }, [mode, categories, data])
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const plugin of data.plugins) {
      for (const id of pluginCategories(plugin)) {
        if (id === 'theme') continue
        map.set(id, (map.get(id) ?? 0) + 1)
      }
    }
    return map
  }, [data])
  const item = (id: string, label: string, count: number, className: string) => (
    <button
      key={id}
      type="button"
      className={cat === id ? `${className} ${css.railOn}` : className}
      aria-current={cat === id ? 'true' : undefined}
      onClick={() => onSelect(id)}
    >
      <span>{label}</span>
      <span className={css.railCount}>{formatCount(count)}</span>
    </button>
  )
  if (mode === 'chips') {
    return (
      <div ref={chipsRef} className={chipsFade ? `${css.categoryChips} ${css.categoryChipsFade}` : css.categoryChips}>
        {item('all', t('all'), data.count, css.chipItem)}
        {categories.map(id => item(id, categoryLabel(data.categories, id, lang), counts.get(id) ?? 0, css.chipItem))}
      </div>
    )
  }
  return (
    <nav className={css.categoryRail} aria-label={t('tabDiscover')}>
      {item('all', t('all'), data.count, css.railItem)}
      {categories.map(id => item(id, categoryLabel(data.categories, id, lang), counts.get(id) ?? 0, css.railItem))}
    </nav>
  )
}

export function ActiveFilters({
  query, category, categoryLabelText, timeRange, timeLabel, sortField, sortDir, sortLabel,
  compatible, onClearQuery, onClearCategory, onClearTime, onClearSort, onClearCompat, onClearAll, t,
}: {
  query: string
  category: string
  categoryLabelText: string
  timeRange: string
  timeLabel: string
  sortField: string
  sortDir: string
  sortLabel: string
  compatible: boolean
  onClearQuery: () => void
  onClearCategory: () => void
  onClearTime: () => void
  onClearSort: () => void
  onClearCompat: () => void
  onClearAll: () => void
  t: Translate
}) {
  const chips: Array<{ id: string; label: string; clear: () => void }> = []
  if (query.trim() !== '') chips.push({ id: 'query', label: query.trim(), clear: onClearQuery })
  if (category !== 'all') chips.push({ id: 'category', label: categoryLabelText, clear: onClearCategory })
  if (timeRange !== 'all') chips.push({ id: 'time', label: timeLabel, clear: onClearTime })
  if (!(sortField === 'downloads' && sortDir === 'desc')) chips.push({ id: 'sort', label: sortLabel, clear: onClearSort })
  if (compatible) chips.push({ id: 'compat', label: t('filterCompat'), clear: onClearCompat })
  if (chips.length === 0) return null
  return (
    <div className={css.activeFilters}>
      {chips.map(chip => (
        <button key={chip.id} type="button" className={css.activeFilter} onClick={chip.clear}>
          {chip.label}
          <span aria-hidden="true"> ×</span>
        </button>
      ))}
      <button type="button" className={css.activeFilterClear} onClick={onClearAll}>{t('clearFilters')}</button>
    </div>
  )
}
