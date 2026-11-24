/**
 * Whether one of the market's own entries is registered.
 *
 * The Plugins page tab and the sidebar row share this gate. Two facts
 * arrive at different times: whether the host has declared the slot, and
 * whether the user — or package removal — wants the entry shown. A saved
 * OFF that arrives before the slot must not flash the entry, and removal
 * must not be undone by a later show.
 */

/** The visibility rules, with the registering itself left to the caller. */
export interface SectionGate {
  /**
   * The slots service has arrived. Until this is called the gate holds its
   * answer rather than acting on it, because there is nothing to act on.
   */
  available(): void
  /** The host's preference. Takes effect now, or as soon as it can. */
  setVisible(visible: boolean): void
  /** Whether the entry is registered right now. */
  visible(): boolean
  /** The package is being removed: never register again. */
  retire(): void
}

/**
 * @param register - registers the entry and returns its disposer. Called
 *   only when the entry should be visible; may be called again after a
 *   retraction, which is why the disposer is required rather than optional.
 * @param initiallyVisible - the answer before anyone has given one. The
 *   settings entry defaults to shown: hiding it is an opt-in (the host, or
 *   the user's card switch, #1015), so no opinion means "as it always was".
 *   The activity-rail icon defaults to shown: hiding it is the user's choice.
 * @returns the gate.
 */
export function createSectionGate(register: () => () => void, initiallyVisible = true): SectionGate {
  let ready = false
  let wanted = initiallyVisible
  let removed = false
  let dispose: (() => void) | null = null

  const apply = (): void => {
    if (!ready) return
    const shouldShow = wanted && !removed
    if (shouldShow && dispose === null) {
      dispose = register()
      return
    }
    if (!shouldShow && dispose !== null) {
      const stop = dispose
      dispose = null
      stop()
    }
  }

  return {
    available: () => {
      ready = true
      apply()
    },
    setVisible: (visible: boolean) => {
      wanted = visible
      apply()
    },
    visible: () => dispose !== null,
    retire: () => {
      removed = true
      apply()
    },
  }
}
