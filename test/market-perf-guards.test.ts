import { describe, expect, it } from 'vitest'
import { nextInstalledMap } from '../packages/taichi-dshmarket/src/client/installed-map'
import {
  sameBridgedNotification,
  shouldPublishNotification,
  type ComparableNotification,
} from '../packages/taichi-dshmarket/src/client/notification-equality'

function snapshot(patch: Partial<ComparableNotification> = {}): ComparableNotification {
  return {
    enabled: true,
    intervalHours: 24,
    checking: false,
    checkedAt: 1,
    lastSuccessAt: 1,
    nextCheckAt: 2,
    stale: false,
    error: null,
    boot: 'boot',
    updateExempt: [],
    disabled: [],
    blocked: [],
    updates: { demo: { version: '1.0.0' } },
    loaded: true,
    readFailed: false,
    ...patch,
  }
}

describe('update notification publish', () => {
  it('does not notify when the comparable fields are unchanged', () => {
    const previous = snapshot()
    const next = snapshot({ updates: { demo: { version: '1.0.0' } } })
    expect(shouldPublishNotification(previous, next)).toBe(false)
  })

  it('notifies when a field changes, and when forced', () => {
    expect(shouldPublishNotification(snapshot(), snapshot({ error: 'down' }))).toBe(true)
    expect(shouldPublishNotification(snapshot(), snapshot(), true)).toBe(true)
  })

  it('compares the bridge by fields, not object identity', () => {
    const left = { checkedAt: 1, error: null, boot: 'boot', updates: { demo: { ok: true } } }
    const right = { checkedAt: 1, error: null, boot: 'boot', updates: { demo: { ok: true } } }
    expect(sameBridgedNotification(left, right)).toBe(true)
    expect(sameBridgedNotification(left, { ...right, checkedAt: 2 })).toBe(false)
  })
})

describe('installed map identity', () => {
  it('keeps the previous map when the specs match', () => {
    const previous = { alpha: '1.0.0' }
    expect(nextInstalledMap(previous, { alpha: '1.0.0' })).toBe(previous)
  })

  it('returns the incoming map when a spec changes', () => {
    const incoming = { alpha: '1.1.0' }
    expect(nextInstalledMap({ alpha: '1.0.0' }, incoming)).toBe(incoming)
  })
})
