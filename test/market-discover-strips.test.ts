import { describe, expect, it } from 'vitest'
import {
  addedAgoLabel,
  discoverHomeView,
  parseSavedAiRecommend,
  primaryCategoryId,
  recommendedToInstall,
  type RecommendCandidate,
} from '../packages/taichi-dshmarket/src/client/discover-teasers'

const DAY = 86_400_000
const now = Date.parse('2026-11-23T12:00:00.000Z')

function label(key: string): string {
  if (key === 'recentAddedDays') return '{0} days'
  return key
}

function plugin(url: string, deprecated = false): RecommendCandidate {
  return { url, ...(deprecated ? { deprecated: true } : {}) }
}

describe('recommendedToInstall', () => {
  it('skips installed, deprecated, blocked, and recent-strip urls, then stops at 8', () => {
    const ranked = Array.from({ length: 13 }, (_, index) => plugin(`u${index}`, index === 1))
    const picked = recommendedToInstall(ranked, {
      installed: entry => entry.url === 'u0',
      blocked: entry => entry.url === 'u3',
      excludeUrls: new Set(['u2']),
      limit: 8,
    })
    expect(picked.map(entry => entry.url)).toEqual(['u4', 'u5', 'u6', 'u7', 'u8', 'u9', 'u10', 'u11'])
  })
})

describe('addedAgoLabel', () => {
  it('says today, yesterday, and N days, and hides a date it cannot read', () => {
    expect(addedAgoLabel(new Date(now).toISOString(), now, label)).toBe('recentAddedToday')
    expect(addedAgoLabel(new Date(now - DAY + 1).toISOString(), now, label)).toBe('recentAddedToday')
    expect(addedAgoLabel(new Date(now - DAY).toISOString(), now, label)).toBe('recentAddedYesterday')
    expect(addedAgoLabel(new Date(now - 3 * DAY).toISOString(), now, label)).toBe('3 days')
    expect(addedAgoLabel(undefined, now, label)).toBeNull()
    expect(addedAgoLabel('', now, label)).toBeNull()
    expect(addedAgoLabel('not-a-date', now, label)).toBeNull()
    expect(addedAgoLabel(new Date(now + DAY).toISOString(), now, label)).toBeNull()
  })
})

describe('discoverHomeView', () => {
  it('is only the unfiltered download sort', () => {
    const home = { query: '', category: 'all', timeRange: 'all', sortField: 'downloads', sortDir: 'desc' }
    expect(discoverHomeView(home)).toBe(true)
    expect(discoverHomeView({ ...home, query: '  word  ' })).toBe(false)
    expect(discoverHomeView({ ...home, category: 'office' })).toBe(false)
    expect(discoverHomeView({ ...home, timeRange: 'week' })).toBe(false)
    expect(discoverHomeView({ ...home, sortField: 'stars' })).toBe(false)
    expect(discoverHomeView({ ...home, sortDir: 'asc' })).toBe(false)
  })
})

describe('primaryCategoryId', () => {
  it('uses the first category that is not the themes tab', () => {
    expect(primaryCategoryId({ category: 'office' })).toBe('office')
    expect(primaryCategoryId({ category: ['theme', 'office', 'dev'] })).toBe('office')
    expect(primaryCategoryId({ category: 'theme' })).toBeNull()
    expect(primaryCategoryId({ category: [] })).toBeNull()
  })
})

describe('parseSavedAiRecommend', () => {
  it('reads a why and intro, and still opens a saved list that only has urls', () => {
    expect(parseSavedAiRecommend(null)).toBeNull()
    expect(parseSavedAiRecommend('not json')).toBeNull()
    expect(parseSavedAiRecommend(JSON.stringify({
      picks: [{ url: 'https://example.com/a', why: '因为' }, { url: '' }, { nope: true }],
      intro: '总述',
    }))).toEqual({
      picks: [{ url: 'https://example.com/a', why: '因为' }],
      intro: '总述',
    })
    expect(parseSavedAiRecommend(JSON.stringify({ urls: ['https://example.com/b', 1] }))).toEqual({
      picks: [{ url: 'https://example.com/b', why: '' }],
      intro: '',
    })
  })
})
