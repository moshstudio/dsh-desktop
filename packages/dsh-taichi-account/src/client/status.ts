import type { AccountSnapshot } from './bridge'

type Listener = (next: AccountSnapshot | null) => void

export const statusBus = {
  current: null as AccountSnapshot | null,
  revision: 0,
  listeners: new Set<Listener>(),
  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  },
  reset() {
    this.current = null
    this.revision += 1
  }
}

export function publishStatus(next: AccountSnapshot | null): void {
  statusBus.current = next
  statusBus.revision += 1
  for (const listener of statusBus.listeners) listener(next)
}

export function resetStatus(): void {
  statusBus.reset()
}

// The workbench overlay already owns the shared Harness restart notice.
export function requestAccountRestart(): void {
  try {
    window.dispatchEvent(new window.CustomEvent('dsh-desktop-restart-required', {
      detail: { source: 'account', restartRequired: true }
    }))
  } catch {
    // Sign-in is already stored. A missing notice must not undo it.
  }
}
