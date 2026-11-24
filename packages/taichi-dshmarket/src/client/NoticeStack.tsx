/**
 * One banner at a time. The rest collapse into a count the reader can open.
 */

import { Children, isValidElement, useState, type ReactElement, type ReactNode } from 'react'
import css from './Market.module.css'
import {
  collapsedNoticeCount,
  noticesForTab,
  type NoticeScope,
  type NoticeSeverity,
} from './notice-priority.ts'
import type { Translate } from './market-data.ts'

export function Notice({ id, severity, scope, children }: {
  id: string
  severity: NoticeSeverity
  scope: NoticeScope
  children: ReactNode
}) {
  return <div data-notice-id={id} data-severity={severity} data-scope={scope}>{children}</div>
}

export function NoticeStack({ tab, t, children }: { tab: string; t: Translate; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const kept: ReactElement[] = []
  const items = Children.toArray(children).flatMap((child, index) => {
    if (!isValidElement(child)) return []
    const props = child.props as { id?: string; severity?: NoticeSeverity; scope?: NoticeScope }
    // Controls such as the update panel render themselves and are not banners.
    if (typeof child.type === 'function' && props.id === undefined) {
      kept.push(child)
      return []
    }
    return [{
      id: props.id ?? `notice-${index}`,
      severity: props.severity ?? 'info',
      scope: props.scope ?? 'global',
      index,
      node: child as ReactElement,
    }]
  })
  const visible = noticesForTab(items, tab)
  const hidden = collapsedNoticeCount(visible)
  if (visible.length === 0) return <>{kept}</>
  const [first, ...rest] = visible
  return (
    <div className={css.noticeStack}>
      {kept}
      {first?.node}
      {hidden > 0 && (
        <button
          type="button"
          className={css.noticeMore}
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
        >{t('noticesMore').replace('{0}', String(hidden))}</button>
      )}
      {open && rest.map(item => <div key={item.id}>{item.node}</div>)}
    </div>
  )
}
