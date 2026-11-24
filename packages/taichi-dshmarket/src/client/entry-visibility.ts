/**
 * The market's Plugins-page entrance and whether the user keeps it (#1015).
 *
 * The Settings section used to be a second door. It is no longer registered:
 * the market lives on the Plugins page, with an activity-rail icon
 * (sidebar-entry.ts). This module owns the Plugins tab and asks that
 * controller whether the other door remains.
 *
 * Absent means the tab is shown. The host decides whether the slot exists;
 * availability is answered live from the slot, never from the stored value.
 * A saved `settingsSection` is not a door and cannot keep this tab open.
 *
 * ## The last-door rule
 *
 * Hiding the tab asks {@link EntryVisibility.otherDoorOpen} first. The
 * server enforces the same rule on the stored answers, but it cannot see
 * which slots THIS host declares. The browser answers for the host's half,
 * and the server answers for the saved half.
 */

import { api } from './market-data.ts'
import type { SectionGate } from './section-gate.ts'

/** The door this module owns. The sidebar is the other one, asked separately. */
export type EntryKey = 'pluginsTab'

export interface EntryVisibility {
  /** The user's saved answer; true unless they turned the door off. */
  pluginsTab(): boolean
  /** The host declares the Plugins page tab slot. */
  pluginsTabSupported(): boolean
  /** Called when the host declares the slot; safe before or after load(). */
  markPluginsTab(): void
  /** Whether at least one door OTHER than `key` would stay open. */
  otherDoorOpen(key: EntryKey | 'sidebar'): boolean
  /** Read (or re-read) the saved answers, e.g. before closing a door. */
  load(): Promise<void>
  /**
   * Persist one answer, then show or hide the door.
   * @returns the value the server accepted.
   */
  set(key: EntryKey, visible: boolean): Promise<boolean>
  /** Re-render hook for the settings card. */
  subscribe(listener: () => void): () => void
  /** The package is being removed: never register again. */
  retire(): void
}

interface Deps {
  /** The Plugins page tab gate, created by the caller with its register(). */
  pluginsTabGate: SectionGate
  fetch: typeof globalThis.fetch
  /** The host declares the activity-rail seat. */
  sidebarSupported: () => boolean
  /**
   * The activity-rail icon is visible right now, not just the saved choice:
   * on a host where it is the only door it is shown before anyone answers.
   */
  sidebarShown: () => boolean
}

export function createEntryVisibility({ pluginsTabGate, fetch, sidebarSupported, sidebarShown }: Deps): EntryVisibility {
  let pluginsTabSeat = false
  let pluginsTab = true
  /** Bumped by every `set` so a slow initial `load` cannot overwrite it. */
  let epoch = 0
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of listeners) listener() }

  const apply = (): void => {
    pluginsTabGate.setVisible(pluginsTab)
  }

  /**
   * "Is this door open?" combines the host's declaration with the user's
   * answer. The sidebar's two facts arrive through callbacks because that
   * controller keeps its own state.
   */
  const pluginsOpen = (): boolean => pluginsTabSeat && pluginsTab
  const sidebarOpen = (): boolean => sidebarSupported() && sidebarShown()
  const otherDoorOpen = (key: EntryKey | 'sidebar'): boolean =>
    (key !== 'pluginsTab' && pluginsOpen())
    || (key !== 'sidebar' && sidebarOpen())

  const loadState = async (): Promise<void> => {
    const at = epoch
    try {
      const response = await fetch(api('/taichi-dsh-market/entry-visibility'), { cache: 'no-store' })
      if (response.ok) {
        const body = (await response.json()) as { pluginsTab?: unknown }
        // A POST that finished while we were in flight already owns this.
        if (at === epoch && typeof body.pluginsTab === 'boolean') {
          pluginsTab = body.pluginsTab
          apply()
        }
      }
    } catch {
      // No answer means the default (or the last known answer) stands.
    } finally {
      notify()
    }
  }

  /**
   * `set` is serialized because two saves in flight at once each answer the
   * last-door rule from the state before the other one landed. The second
   * save would then be judged against a world that no longer exists — or be
   * discarded by the epoch guard after the server accepted it.
   */
  let queue: Promise<unknown> = Promise.resolve()
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.then(() => undefined, () => undefined)
    return run
  }

  const save = async (key: EntryKey, visible: boolean): Promise<boolean> => {
    // Any save invalidates an in-flight load: from here on, the answers this
    // save reads and writes are the ones that count.
    const at = ++epoch
    if (!visible) {
      // Another tab may have closed a door since this card loaded. The
      // invariant is about the SAVED answers, so answer it from the server
      // rather than from this tab's snapshot.
      await loadState()
      if (!otherDoorOpen(key)) {
        throw new Error('at least one market entry must stay visible')
      }
    }
    try {
      const response = await fetch(api('/taichi-dsh-market/entry-visibility'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [key]: visible }),
      })
      let body: { ok?: boolean; pluginsTab?: unknown; error?: string }
      try {
        body = (await response.json()) as { ok?: boolean; pluginsTab?: unknown; error?: string }
      } catch {
        throw new Error(`entry visibility: HTTP ${response.status}`)
      }
      if (body.ok !== true || typeof body.pluginsTab !== 'boolean') {
        throw new Error(body.error ?? `entry visibility: HTTP ${response.status}`)
      }
      // A newer set() started after we did — let that one paint.
      if (at === epoch) {
        pluginsTab = body.pluginsTab
        apply()
        notify()
      }
      return body.pluginsTab
    } catch (error) {
      // A refusal means this card and the server disagree (another tab, an
      // older bundle). Re-read so the switches show what is actually saved.
      await loadState()
      throw error
    }
  }

  return {
    pluginsTab: () => pluginsTab,
    pluginsTabSupported: () => pluginsTabSeat,
    markPluginsTab: () => {
      pluginsTabSeat = true
      // Apply before available(): a saved OFF that arrived first must not
      // be overridden by the gate's shown-by-default initial answer.
      apply()
      pluginsTabGate.available()
      notify()
    },
    otherDoorOpen,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    load: loadState,
    set: (key, visible) => serialize(() => save(key, visible)),
    retire: () => {
      pluginsTabGate.retire()
      notify()
    },
  }
}
