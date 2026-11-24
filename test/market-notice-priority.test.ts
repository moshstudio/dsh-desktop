import { describe, expect, it } from 'vitest'
import {
  collapsedNoticeCount,
  noticesForTab,
  type NoticeRef,
} from '../packages/taichi-dshmarket/src/client/notice-priority'

const notices: NoticeRef[] = [
  { id: 'hint', severity: 'info', scope: 'global', index: 0 },
  { id: 'install-error', severity: 'error', scope: 'global', index: 1 },
  { id: 'env', severity: 'blocking', scope: 'global', index: 2 },
  { id: 'update-check', severity: 'error', scope: 'installed', index: 3 },
  { id: 'fav', severity: 'action', scope: 'favorites', index: 4 },
]

describe('notice priority', () => {
  it('orders blocking ahead of error, then action, then info', () => {
    const ranked = noticesForTab(notices, 'discover').map(notice => notice.id)
    expect(ranked).toEqual(['env', 'install-error', 'hint'])
  })

  it('keeps notices that belong to another tab off the current one', () => {
    const onDiscover = noticesForTab(notices, 'discover').map(notice => notice.id)
    expect(onDiscover).not.toContain('update-check')
    expect(noticesForTab(notices, 'installed').map(notice => notice.id)).toContain('update-check')
  })

  it('counts everything after the one banner that stays open', () => {
    expect(collapsedNoticeCount(noticesForTab(notices, 'discover'))).toBe(2)
    expect(collapsedNoticeCount([])).toBe(0)
  })
})
