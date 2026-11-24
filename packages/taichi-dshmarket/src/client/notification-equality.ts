/**
 * Decide whether a polled update-notification snapshot is actually new.
 * The poll builds a fresh object every time; identity is not a change.
 */

export interface ComparableNotification {
  enabled: boolean
  intervalHours: number | null
  checking: boolean
  checkedAt: number | null
  lastSuccessAt: number | null
  nextCheckAt: number | null
  stale: boolean
  error: string | null
  boot: string
  profileKey?: string
  updateExempt: readonly string[]
  disabled: readonly string[]
  blocked: readonly string[]
  updates: Record<string, unknown>
  loaded: boolean
  readFailed: boolean
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function sameUpdates(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return false
  }
  return true
}

export function sameNotificationState(left: ComparableNotification, right: ComparableNotification): boolean {
  return left.enabled === right.enabled
    && left.intervalHours === right.intervalHours
    && left.checking === right.checking
    && left.checkedAt === right.checkedAt
    && left.lastSuccessAt === right.lastSuccessAt
    && left.nextCheckAt === right.nextCheckAt
    && left.stale === right.stale
    && left.error === right.error
    && left.boot === right.boot
    && left.profileKey === right.profileKey
    && left.loaded === right.loaded
    && left.readFailed === right.readFailed
    && sameList(left.updateExempt, right.updateExempt)
    && sameList(left.disabled, right.disabled)
    && sameList(left.blocked, right.blocked)
    && sameUpdates(left.updates, right.updates)
}

/** `force` is for dismissals stored outside the snapshot (session storage). */
export function shouldPublishNotification(
  previous: ComparableNotification,
  next: ComparableNotification,
  force = false,
): boolean {
  return force || !sameNotificationState(previous, next)
}

export function sameBridgedNotification(
  left: { checkedAt: number | null; error: string | null; boot: string; updates: Record<string, unknown> },
  right: { checkedAt: number | null; error: string | null; boot: string; updates: Record<string, unknown> },
): boolean {
  return left.checkedAt === right.checkedAt
    && left.error === right.error
    && left.boot === right.boot
    && sameUpdates(left.updates, right.updates)
}
