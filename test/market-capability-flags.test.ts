import { describe, expect, it } from 'vitest'
import {
  capabilityScan,
  hasCardUrgent,
  isUrgentRedLine,
} from '../packages/taichi-dshmarket/src/client/capability-flags'

describe('capability flags', () => {
  it('treats install-time code and core-bundle tamper as urgent', () => {
    expect(isUrgentRedLine('runs code at install time: postinstall')).toBe(true)
    expect(isUrgentRedLine('tampers with a core bundle')).toBe(true)
    expect(isUrgentRedLine('reads the workspace')).toBe(false)
  })

  it('does not treat a scan that found nothing as a scan that never ran', () => {
    expect(capabilityScan({})).toBe('unchecked')
    expect(capabilityScan({ capabilities: [] })).toBe('none')
    expect(capabilityScan({ capabilities: ['network'] })).toBe('found')
  })

  it('marks dynamic code and credentials on the card, and a clean scan as quiet', () => {
    expect(hasCardUrgent({ capabilities: ['dynamic-code'] })).toBe(true)
    expect(hasCardUrgent({ capabilities: ['credentials'] })).toBe(true)
    expect(hasCardUrgent({ capabilities: [] })).toBe(false)
    expect(hasCardUrgent({})).toBe(false)
  })
})
