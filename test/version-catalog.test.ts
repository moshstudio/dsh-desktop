import { afterEach, describe, expect, it } from 'vitest'
import { DEVELOPMENT_GATEWAY_URL, PRODUCTION_GATEWAY_URL } from '../src/main/development-environment'
import {
  archiveFeedUrl,
  compareVersions,
  fetchAvailableReleases,
  parseVersionIndex,
  setDesktopUpdateOrigin,
  stableFeedUrl,
  updatePolicyUrl,
  versionIndexUrl
} from '../src/main/update/version-catalog'

describe('version-catalog constants', () => {
  afterEach(() => {
    setDesktopUpdateOrigin(PRODUCTION_GATEWAY_URL)
  })

  it('points update checks and feeds at the production gateway', () => {
    expect(updatePolicyUrl()).toBe(`${PRODUCTION_GATEWAY_URL}/v1/updates/check`)
    expect(stableFeedUrl()).toBe(`${PRODUCTION_GATEWAY_URL}/updates/latest/`)
    expect(versionIndexUrl()).toBe(`${PRODUCTION_GATEWAY_URL}/updates/versions.json`)
    expect(archiveFeedUrl('1.2.3')).toBe(`${PRODUCTION_GATEWAY_URL}/updates/archive/1.2.3/`)
  })

  it('follows a configured https gateway and the local loopback gateway', () => {
    expect(setDesktopUpdateOrigin(' https://updates.example/desktop/ ')).toBe(true)
    expect(updatePolicyUrl()).toBe('https://updates.example/desktop/v1/updates/check')
    expect(archiveFeedUrl('1.2.3')).toBe('https://updates.example/desktop/updates/archive/1.2.3/')
    expect(setDesktopUpdateOrigin(DEVELOPMENT_GATEWAY_URL)).toBe(true)
    expect(stableFeedUrl()).toBe(`${DEVELOPMENT_GATEWAY_URL}/updates/latest/`)
  })

  it('keeps the production gateway when the origin is not an acceptable update host', () => {
    expect(setDesktopUpdateOrigin('http://updates.example')).toBe(false)
    expect(setDesktopUpdateOrigin('https://user:pass@updates.example')).toBe(false)
    expect(setDesktopUpdateOrigin('not a url')).toBe(false)
    expect(stableFeedUrl()).toBe(`${PRODUCTION_GATEWAY_URL}/updates/latest/`)
  })
})

describe('compareVersions', () => {
  it('orders by numeric segments', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1)
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('treats a prerelease as lower than its release', () => {
    expect(compareVersions('1.2.3-rc.1', '1.2.3')).toBe(-1)
    expect(compareVersions('1.2.3', '1.2.3-rc.1')).toBe(1)
    expect(compareVersions('1.2.3-rc.1', '1.2.3-rc.2')).toBe(-1)
  })

  it('compares prerelease counters numerically, not lexicographically', () => {
    // "rc.10" < "rc.9" under string comparison; semver says the reverse.
    expect(compareVersions('1.2.3-rc.10', '1.2.3-rc.9')).toBe(1)
    expect(compareVersions('1.2.3-rc.9', '1.2.3-rc.10')).toBe(-1)
    expect(compareVersions('1.2.3-alpha.10', '1.2.3-alpha.9')).toBe(1)
    expect(compareVersions('1.2.3-rc.10', '1.2.3-rc.1')).toBe(1)
  })

  it('follows semver identifier precedence', () => {
    // fewer identifiers < more ("alpha" < "alpha.1")
    expect(compareVersions('1.2.3-alpha', '1.2.3-alpha.1')).toBe(-1)
    // numeric identifiers < alphanumeric ones ("1" < "alpha")
    expect(compareVersions('1.2.3-1', '1.2.3-alpha')).toBe(-1)
    expect(compareVersions('1.2.3-alpha', '1.2.3-beta')).toBe(-1)
    expect(compareVersions('1.2.3-rc.10', '1.2.3-rc.10')).toBe(0)
  })
})

describe('parseVersionIndex', () => {
  it('keeps well-formed entries and drops the rest', () => {
    const raw = {
      versions: [
        { version: '1.2.3', tag: 'v1.2.3', archiveUrl: 'https://taichi-gateway.moshangwangluo.com/updates/archive/1.2.3/' },
        { version: '', tag: 'v0', archiveUrl: 'x' },
        { nope: true },
        42
      ]
    }
    expect(parseVersionIndex(raw)).toEqual([
      { version: '1.2.3', tag: 'v1.2.3', archiveUrl: 'https://taichi-gateway.moshangwangluo.com/updates/archive/1.2.3/' }
    ])
  })

  it('returns an empty array for non-objects or a missing versions array', () => {
    expect(parseVersionIndex(null)).toEqual([])
    expect(parseVersionIndex({})).toEqual([])
    expect(parseVersionIndex('nope')).toEqual([])
  })
})

describe('fetchAvailableReleases', () => {
  const index = {
    versions: [
      { version: '1.0.0', tag: 'v1.0.0', archiveUrl: 'a' },
      { version: '1.2.0', tag: 'v1.2.0', archiveUrl: 'b' },
      { version: '1.1.0', tag: 'v1.1.0', archiveUrl: 'c' }
    ]
  }
  const ok = () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(index) } as Response)

  it('only returns older releases, excluding the current and newer versions', async () => {
    const releases = await fetchAvailableReleases('1.1.0', ok as unknown as typeof fetch)
    expect(releases.map((r) => r.version)).toEqual(['1.0.0'])
  })

  it('returns no rollback options when only current and newer releases exist', async () => {
    const releases = await fetchAvailableReleases('1.0.0', ok as unknown as typeof fetch)
    expect(releases).toEqual([])
  })

  it('keeps prereleases below the running release in numeric order', async () => {
    const response = () => Promise.resolve({ ok: true, json: async () => ({ versions: [
      { version: '1.2.0-rc.9', tag: 'a', archiveUrl: 'a' },
      { version: '1.2.0-rc.10', tag: 'b', archiveUrl: 'b' },
      { version: '1.2.0', tag: 'c', archiveUrl: 'c' },
      { version: '1.3.0', tag: 'd', archiveUrl: 'd' }
    ] }) } as Response)
    const releases = await fetchAvailableReleases('1.2.0', response as unknown as typeof fetch)
    expect(releases.map(release => release.version)).toEqual(['1.2.0-rc.10', '1.2.0-rc.9'])
  })

  it('throws when the request fails', async () => {
    const bad = () => Promise.resolve({ ok: false, status: 503 } as Response)
    await expect(
      fetchAvailableReleases('1.1.0', bad as unknown as typeof fetch)
    ).rejects.toThrow()
  })

  it('throws when the network rejects', async () => {
    const boom = () => Promise.reject(new Error('offline'))
    await expect(
      fetchAvailableReleases('1.1.0', boom as unknown as typeof fetch)
    ).rejects.toThrow('offline')
  })
})
