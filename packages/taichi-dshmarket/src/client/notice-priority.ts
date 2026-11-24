/** Which banner wins the single slot above the market, and which tab it belongs to. */

export type NoticeSeverity = 'blocking' | 'error' | 'action' | 'info'

export type NoticeScope = 'global' | 'discover' | 'favorites' | 'themes' | 'installed' | 'blocked' | 'advanced'

export interface NoticeRef {
  id: string
  severity: NoticeSeverity
  scope: NoticeScope
  /** Source order, used when two notices share a severity. */
  index?: number
}

const RANK: Record<NoticeSeverity, number> = {
  blocking: 0,
  error: 1,
  action: 2,
  info: 3,
}

export function noticeRank(severity: NoticeSeverity): number {
  return RANK[severity]
}

/** Global notices plus the ones for the tab on screen, most urgent first. */
export function noticesForTab<T extends NoticeRef>(notices: readonly T[], tab: string): T[] {
  return notices
    .filter(notice => notice.scope === 'global' || notice.scope === tab || (notice.scope === 'advanced' && (tab === 'backup' || tab === 'diagnostics')))
    .slice()
    .sort((left, right) => noticeRank(left.severity) - noticeRank(right.severity)
      || (left.index ?? 0) - (right.index ?? 0)
      || left.id.localeCompare(right.id))
}

export function collapsedNoticeCount(visible: readonly NoticeRef[]): number {
  return Math.max(0, visible.length - 1)
}

/** A tab that is not showing gets a dot when it is holding something the user should act on. */
export function tabNoticeDot(notices: readonly NoticeRef[], tab: string, current: string): boolean {
  if (tab === current) return false
  return notices.some(notice => notice.scope === tab && notice.severity !== 'info')
}
