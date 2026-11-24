/**
 * The market's seat on the desktop activity rail (the leftmost icon column).
 *
 * The rail paints this button: `data-dsh-activity` is what its sliding mark
 * and tooltip bind to, and `bindTip` is the rail's own pointer/focus handler
 * when the slot passes one. A shell that does not declare `shell.activity.main`
 * never mounts the registration.
 *
 * The button opens the market's `main` panel. Before opening it announces
 * `dsh-activity-home` so another rail page (image studio, etc.) leaves first;
 * otherwise both buttons stay selected and the rail mark sticks. Home uses
 * the same event; this seat only closes when its own panel is current.
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { Translate } from './market-data.ts'
import { MarketLogo } from './MarketLogo.tsx'

/** After the image studio (order 10), still in the main column under Home. */
export const MARKET_ACTIVITY_ORDER = 20

/** The layout surface this seat needs. `subscribe` is absent on older hosts. */
export interface MarketPanelLayout {
  selectPanel(id: string | null): void
  panelInfo: {
    getSnapshot(): { activePanelId?: string | null }
    subscribe?(listener: () => void): () => void
  }
}

export const SIDEBAR_EVENT = 'dsh-activity-sidebar'

/**
 * Tell the activity rail what this page needs from the conversation sidebar.
 * The rail owns the one shared toggle and the user's saved preference.
 * `keep` restores that preference; `expanded` and `hidden` last only while
 * this page is current.
 */
export function requestActivitySidebar(mode: 'keep' | 'expanded' | 'hidden'): void {
  document.dispatchEvent(new CustomEvent(SIDEBAR_EVENT, { detail: { mode } }))
}

export interface MarketPanelSeat {
  /** The market panel is the layout's current page. */
  active(): boolean
  /** Select the market panel. No layout yet means the click is a no-op. */
  open(): void
  /** Leave the market panel. Another panel's selection is not cleared. */
  close(): void
  /** Re-bind after the layout service arrives. */
  attach(): void
  subscribe(listener: () => void): () => void
}

/**
 * One layout selection shared by the rail button. The layout service can
 * arrive after the button mounts; `attach` picks it up without remounting.
 */
export function createMarketPanelSeat(getLayout: () => MarketPanelLayout | undefined, panelId: string): MarketPanelSeat {
  let bound: MarketPanelLayout | undefined
  let panelUnsub: (() => void) | undefined
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of listeners) listener()
  }
  const bind = (): void => {
    const next = getLayout()
    if (next === bound) return
    panelUnsub?.()
    panelUnsub = undefined
    bound = next
    if (next !== undefined && typeof next.panelInfo.subscribe === 'function') {
      panelUnsub = next.panelInfo.subscribe(notify)
    }
  }
  const active = (): boolean => getLayout()?.panelInfo.getSnapshot().activePanelId === panelId
  return {
    active,
    open: () => {
      const layout = getLayout()
      if (layout === undefined) return
      // The rail hides the conversation sidebar for this page and puts it back
      // when another seat asks. selectPanel only swaps the centre column.
      requestActivitySidebar('hidden')
      layout.selectPanel(panelId)
    },
    close: () => {
      const layout = getLayout()
      if (layout?.panelInfo.getSnapshot().activePanelId === panelId) layout.selectPanel(null)
    },
    attach: () => {
      const previous = bound
      bind()
      if (bound !== previous) notify()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      bind()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          panelUnsub?.()
          panelUnsub = undefined
          bound = undefined
        }
      }
    },
  }
}

type RailButtonProps = {
  type: 'button'
  'data-dsh-activity': ''
  'aria-label': string
  'aria-current'?: 'page'
  'data-selected': 'true' | 'false'
  onClick: () => void
}

export function MarketActivityButton({
  t,
  panel,
  bindTip,
}: {
  t: Translate
  panel: MarketPanelSeat
  /** Tooltip handlers from the rail's renderSlot owner props. */
  bindTip?: (props: RailButtonProps) => RailButtonProps
  /** Present when a host still wraps descriptions. The slot places this button. */
  component?: unknown
}) {
  const open = useSyncExternalStore(panel.subscribe, panel.active, panel.active)
  // Home and other rail seats announce dsh-activity-home. Leave only when
  // this panel is current so a sibling page can claim the column.
  useEffect(() => {
    const onHome = () => { panel.close() }
    document.addEventListener('dsh-activity-home', onHome)
    return () => { document.removeEventListener('dsh-activity-home', onHome) }
  }, [panel])
  // Mark the document while this page is current so shell CSS can hide the
  // leftover conversation chrome that selectPanel alone leaves in place.
  useEffect(() => {
    if (!open) return undefined
    document.documentElement.setAttribute('data-taichi-dshmarket-page', '')
    return () => { document.documentElement.removeAttribute('data-taichi-dshmarket-page') }
  }, [open])
  const props: RailButtonProps = {
    type: 'button',
    'data-dsh-activity': '',
    'aria-label': t('nav'),
    'aria-current': open ? 'page' : undefined,
    'data-selected': open ? 'true' : 'false',
    onClick: () => {
      // Clear every other rail page first. Opening without this leaves their
      // aria-current/data-selected on, so the mark and wash stick on two seats.
      document.dispatchEvent(new Event('dsh-activity-home'))
      panel.open()
    },
  }
  return (
    <button {...(typeof bindTip === 'function' ? bindTip(props) : props)}>
      <span data-dsh-activity-glyph="" key={open ? 'on' : 'off'}>
        <MarketLogo size={18} />
      </span>
    </button>
  )
}
