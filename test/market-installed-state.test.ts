import { describe, expect, it } from 'vitest'
import {
  installedListMessage,
  installedProblemRank,
  installedQueryHits,
  installedStatusKind,
  installedUpdateTag,
  matchesInstalledFilter,
  packageNameSegments,
  showEnabledLabel,
} from '../packages/taichi-dshmarket/src/client/installed-status'

describe('installed status', () => {
  it('picks one label, with a failed check ahead of a live activation', () => {
    expect(installedStatusKind({
      disabled: false,
      checkFailed: true,
      activation: 'live',
    })).toBe('check-failed')
    expect(installedStatusKind({
      disabled: true,
      checkFailed: false,
      activation: 'broken',
    })).toBe('broken')
    expect(installedStatusKind({
      disabled: false,
      checkFailed: false,
      activation: 'live',
    })).toBe('live')
  })

  it('keeps the trailing tag quiet until a finished check can stand behind it', () => {
    const failed = new Set(['one'])
    expect(installedUpdateTag({ ready: false, failed: new Set(), name: 'one' })).toBeNull()
    expect(installedUpdateTag({ ready: true, failed: null, name: 'one' })).toBeNull()
    expect(installedUpdateTag({ ready: true, failed, name: 'one' })).toBe('check-failed')
    expect(installedUpdateTag({ ready: false, failed, name: 'one' })).toBe('check-failed')
    expect(installedUpdateTag({ ready: true, failed, name: 'two' })).toBe('up-to-date')
  })

  it('wraps a package name at separators without dropping characters', () => {
    const name = '@deepseek-ai/dsh-client'
    const segments = packageNameSegments(name)
    expect(segments.map(segment => segment.text).join('')).toBe(name)
    expect(segments.filter(segment => segment.breakAfter).map(segment => segment.text)).toEqual(['@', '-', '/', '-'])
    expect(packageNameSegments('plain').every(segment => segment.breakAfter === false)).toBe(true)
  })

  it('shows the enabled label only while running or waiting on a restart', () => {
    expect(showEnabledLabel('live')).toBe(true)
    expect(showEnabledLabel('restart')).toBe(true)
    expect(showEnabledLabel('broken')).toBe(false)
    expect(showEnabledLabel('disabled')).toBe(false)
  })

  it('filters by updates, problems, and disabled', () => {
    const problem = { kind: 'broken' as const, updatable: true }
    expect(matchesInstalledFilter('problems', problem)).toBe(true)
    expect(matchesInstalledFilter('updates', problem)).toBe(true)
    expect(matchesInstalledFilter('disabled', { kind: 'disabled', updatable: false })).toBe(true)
    expect(matchesInstalledFilter('disabled', problem)).toBe(false)
  })

  it('reports an empty search only after the installed list itself has rows', () => {
    expect(installedListMessage(0, 0)).toBe('installed-empty')
    expect(installedListMessage(4, 0)).toBe('search-empty')
    expect(installedListMessage(4, 2)).toBe('list')
  })

  it('matches the author as well as the name', () => {
    expect(installedQueryHits('ada', { name: 'widget', owner: 'Ada' })).toBe(true)
    expect(installedQueryHits('ada', { name: 'widget', owner: 'Grace' })).toBe(false)
    expect(installedQueryHits('  ', { name: 'widget' })).toBe(true)
  })

  it('sorts a problem ahead of a healthy row', () => {
    expect(installedProblemRank('incompatible')).toBeLessThan(installedProblemRank('live'))
  })
})
