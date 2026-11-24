/**
 * The market's icon on the desktop activity rail (leftmost icon column).
 *
 * Shown by default. A user can hide it from the market's settings card. The
 * card refuses to let the last open door close, this icon included (#1015).
 * The Settings section is not a door. The saved preference key remains
 * `sidebarEntry` for compatibility with existing profiles.
 *
 * Two facts decide whether the icon exists, and they arrive independently:
 * whether the host declares `shell.activity.main` at all, and what the user
 * chose, which is read from the server. The section gate already owns that
 * ordering problem for the settings entry; this reuses it with shown-by-default.
 *
 * Opening the icon selects a `main` panel, so the market renders as a page —
 * the only one-click destination the host's public contracts allow.
 */

import { api } from './market-data.ts'
import type { SectionGate } from './section-gate.ts'

/** The `main` key and activity-rail id this package registers. */
export const SIDEBAR_PANEL_ID = 'taichi-dshmarket'

export interface SidebarEntry {
  /** The host declares the activity rail, so the switch can do something. */
  supported(): boolean
  /** The user's choice as last confirmed by the server. */
  enabled(): boolean
  /**
   * The icon is registered right now. Not the same as {@link enabled}: on a
   * host where it is the only door it is shown before the user has answered,
   * and a deliberate OFF hides it even there.
   */
  shown(): boolean
  /**
   * The initial `load()` finished (ok, refused, or failed). Until then
   * `enabled()` is still the default on, and must not be treated as a
   * confirmed choice — a saved OFF that has not arrived yet is not "the user
   * wants it hidden".
   */
  ready(): boolean
  /**
   * True when the host offers NO other entry — no Plugins page tab (#1015) —
   * so this icon is the market's ONLY door. The icon is then shown by default:
   * a default that leaves the market unreachable is a missing feature. On
   * hosts that declare the Plugins tab this stays a guard.
   */
  onlyDoor(): boolean
  /**
   * Persist the choice, then show or hide the icon.
   * @returns the value the server accepted.
   */
  set(enabled: boolean): Promise<boolean>
  /** Re-render hook for the settings card. */
  subscribe(listener: () => void): () => void
  /** The slot exists: the gate may register now. */
  markSupported(): void
  /** Re-answer "is the icon shown" after the host's seat set is known/changed. */
  refresh(): void
  /** Read the saved choice once at page load. */
  load(): Promise<void>
}

interface Deps {
  gate: SectionGate
  fetch: typeof globalThis.fetch
  /**
   * Whether the host offers the market somewhere ELSE — the Plugins page tab
   * that arrived with dsh 0.2.1-alpha.4 (#1015). Read live rather than
   * captured, because it is answered by the same slot injection that makes
   * the rest of the client work, and a host may declare it late. The
   * Settings section is not a seat.
   */
  hasOtherSeat?: () => boolean
}

export function createSidebarEntry({ gate, fetch, hasOtherSeat }: Deps): SidebarEntry {
  // A host that says nothing is assumed to offer the Plugins page tab; only
  // the one that reports the slot missing changes the default.
  const otherSeat = hasOtherSeat ?? ((): boolean => true)
  let supported = false
  /** Absent means shown. A saved false is the only way this starts hidden. */
  let enabled = true
  let ready = false
  /** The user has ever answered; an absent choice is not an "off". */
  let chosen = false
  /** Bumped by every `set` so a slow initial `load` cannot overwrite it. */
  let epoch = 0
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of listeners) listener() }

  /**
   * One place that answers "is the icon shown": a saved choice wins. With no
   * choice on record the icon is shown.
   */
  const decide = (): void => {
    if (!supported) return
    gate.setVisible(chosen ? enabled : true)
    notify()
  }

  const settle = (): void => {
    if (ready) return
    ready = true
    notify()
  }

  return {
    supported: () => supported,
    enabled: () => enabled,
    shown: () => gate.visible(),
    ready: () => ready,
    onlyDoor: () => !otherSeat(),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    markSupported: () => {
      supported = true
      gate.available()
      decide()
    },
    refresh: () => { decide() },
    load: async () => {
      const at = epoch
      try {
        const response = await fetch(api('/taichi-dsh-market/sidebar-entry'), { cache: 'no-store' })
        if (response.ok) {
          const body = (await response.json()) as { enabled?: unknown; chosen?: unknown }
          // A POST that finished while we were in flight already owns the icon.
          if (at === epoch) {
            chosen = body.chosen === true
            // Unchosen answers keep the default on. A chosen answer is exact.
            enabled = chosen ? body.enabled === true : true
            decide()
          }
        }
      } catch {
        // No answer means no saved choice; whether that leaves the market
        // unreachable is `decide()`'s question, not this one's.
      } finally {
        settle()
      }
    },
    set: async (next) => {
      const at = ++epoch
      const response = await fetch(api('/taichi-dsh-market/sidebar-entry'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      let body: { ok?: boolean; enabled?: unknown; error?: string }
      try {
        body = (await response.json()) as { ok?: boolean; enabled?: unknown; error?: string }
      } catch {
        throw new Error(`sidebar entry: HTTP ${response.status}`)
      }
      if (body.ok !== true || typeof body.enabled !== 'boolean') {
        throw new Error(body.error ?? `sidebar entry: HTTP ${response.status}`)
      }
      // A newer set() started after we did — let that one paint.
      if (at === epoch) {
        enabled = body.enabled
        chosen = true
        decide()
      }
      // A choice the user just made is as settled as a finished load.
      settle()
      return body.enabled
    },
  }
}
