/**
 * The image studio's seat on the desktop activity rail.
 *
 * Placement is the `shell.activity.main` slot. The outlet is `display: contents`,
 * so this button is a flex item of the icon column, in registration order.
 * The rail's stylesheet, sliding mark, and tooltip bind to `data-dsh-activity`.
 * A shell that does not declare shell.activity.main does not mount this registration.
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { ImageGenController } from './controller.ts'
import { tt } from './helpers.ts'

const SIDEBAR_EVENT = 'dsh-activity-sidebar'

const GLYPH = {
  viewBox: '0 0 16 16',
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
} as const

function ImageGlyph({ selected }: { selected: boolean }) {
  // Filled frame with the sun and skyline cut out while the studio is current.
  // The outline is the same frame at rest, so the seat reads as one control.
  if (selected) {
    return (
      <svg {...GLYPH} fill="currentColor" stroke="none">
        <path
          fillRule="evenodd"
          d="M3.85 3.15h8.3a1.7 1.7 0 0 1 1.7 1.7v6.3a1.7 1.7 0 0 1-1.7 1.7h-8.3a1.7 1.7 0 0 1-1.7-1.7v-6.3a1.7 1.7 0 0 1 1.7-1.7ZM5.45 5.15a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8ZM3.05 12.2V11.55L5.85 8.8l1.8 1.6 2.25-2.15 3.05 2.95V12.2H3.05Z"
        />
      </svg>
    )
  }
  return (
    <svg {...GLYPH}>
      <rect x="2.15" y="3.15" width="11.7" height="9.7" rx="1.7" fill="none" />
      <circle cx="5.45" cy="6.05" r="0.9" fill="currentColor" stroke="none" />
      <path d="M3.05 11.55 5.85 8.8l1.8 1.6 2.25-2.15 3.05 2.95" fill="none" />
    </svg>
  )
}

type RailButtonProps = {
  type: 'button'
  'data-dsh-activity': ''
  'aria-label': string
  'aria-current'?: 'page'
  'data-selected': 'true' | 'false'
  onClick: () => void
}

export function ImageActivityButton({
  controller,
  bindTip
}: {
  controller: ImageGenController
  /** Tooltip handlers from the rail's renderSlot owner props. */
  bindTip?: (props: RailButtonProps) => RailButtonProps
  /** Present when a host still wraps descriptions. The slot places this button. */
  component?: unknown
}) {
  const panelOpen = useSyncExternalStore(
    listener => controller.subscribe(listener),
    () => controller.getSnapshot().panelOpen
  )
  // Home and other rail seats announce dsh-activity-home. Leave so a sibling
  // page can claim the column without two selected icons.
  useEffect(() => {
    const onHome = () => { controller.close() }
    document.addEventListener('dsh-activity-home', onHome)
    return () => { document.removeEventListener('dsh-activity-home', onHome) }
  }, [controller])
  const props: RailButtonProps = {
    type: 'button',
    'data-dsh-activity': '',
    'aria-label': tt('activity.image'),
    'aria-current': panelOpen ? 'page' : undefined,
    'data-selected': panelOpen ? 'true' : 'false',
    onClick: () => {
      // Clear every other rail page first. Opening without this leaves their
      // aria-current/data-selected on, so the mark and wash stick on two seats.
      // The studio's history list lives in the sidebar, so the page needs it open.
      document.dispatchEvent(new Event('dsh-activity-home'))
      document.dispatchEvent(new CustomEvent(SIDEBAR_EVENT, { detail: { mode: 'expanded' } }))
      controller.open()
    }
  }
  return (
    <button {...(typeof bindTip === 'function' ? bindTip(props) : props)}>
      <span data-dsh-activity-glyph="" key={panelOpen ? 'on' : 'off'}>
        <ImageGlyph selected={panelOpen} />
      </span>
    </button>
  )
}