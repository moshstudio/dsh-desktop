import { describe, expect, it } from 'vitest'
import { DEVELOPMENT_GATEWAY_URL, developmentEnvironment, developmentGatewayUrl, skipBlockingWindowsDevHmr } from '../src/main/development-environment'

describe('development worktree isolation', () => {
  it('keeps defaults and ignores development overrides in production', () => {
    expect(developmentEnvironment(false, 43129, { DSH_DEV_PROFILE: '../unsafe', DSH_DEV_HARNESS_PORT: 'invalid' }))
      .toEqual({ profile: 'taichi-dsh', harnessPort: 43129, mobilePort: 43127 })
    expect(developmentEnvironment(true, 43129, {}))
      .toEqual({ profile: 'taichi-dsh-dev', harnessPort: 43130, mobilePort: 43128 })
  })

  it('uses distinct profile and loopback ports for a second worktree', () => {
    expect(developmentEnvironment(true, 43129, {
      DSH_DEV_PROFILE: 'dsh-desktop-dev-workbench', DSH_DEV_HARNESS_PORT: '43132', DSH_DEV_MOBILE_PORT: '43133'
    })).toEqual({ profile: 'dsh-desktop-dev-workbench', harnessPort: 43132, mobilePort: 43133 })
  })

  it.each(['../profile', '/tmp/profile', 'a/b', 'a\\b', 'taichi-dsh', '..'])('rejects unsafe profile %s', profile => {
    expect(() => developmentEnvironment(true, 43129, { DSH_DEV_PROFILE: profile })).toThrow('DSH_DEV_PROFILE')
  })

  it.each(['0', '1023', '65536', '-1', '12.5', 'invalid', ' 43132 '])('rejects invalid port %s', value => {
    expect(() => developmentEnvironment(true, 43129, { DSH_DEV_HARNESS_PORT: value })).toThrow('DSH_DEV_HARNESS_PORT')
    expect(() => developmentEnvironment(true, 43129, { DSH_DEV_MOBILE_PORT: value })).toThrow('DSH_DEV_MOBILE_PORT')
  })

  it('skips the blocking HMR service only for unpackaged Windows development', () => {
    expect(skipBlockingWindowsDevHmr(true, 'win32')).toBe(false)
    expect(skipBlockingWindowsDevHmr(false, 'darwin')).toBe(false)
    expect(skipBlockingWindowsDevHmr(false, 'linux')).toBe(false)
    expect(skipBlockingWindowsDevHmr(false, 'win32')).toBe(true)
  })

  it('points unpackaged development at the local account gateway', () => {
    expect(developmentGatewayUrl(false, {})).toBeUndefined()
    expect(developmentGatewayUrl(true, {})).toBe(DEVELOPMENT_GATEWAY_URL)
    expect(developmentGatewayUrl(true, { TAICHI_GATEWAY_URL: ' https://gateway.example ' })).toBe('https://gateway.example')
    expect(DEVELOPMENT_GATEWAY_URL).toBe('http://127.0.0.1:8787')
  })

  it('rejects colliding service ports', () => {
    expect(() => developmentEnvironment(true, 43129, { DSH_DEV_MOBILE_PORT: '43130' })).toThrow('must differ')
  })
})
