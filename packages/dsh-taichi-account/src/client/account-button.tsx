import { useEffect, useState } from 'react'
import { Button, IconUserOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountSnapshot } from './bridge'
import type { Translate } from './locale'
import { AccountPanel } from './account-panel'
import { publishStatus, statusBus } from './status'
import styles from './account.module.css'

const OPEN_EVENT = 'dsh-taichi-account-open'
// Defined by dsh-desktop-activity. The bubble has to be ours: Tooltip keeps
// its skin on an internal node and does not apply this class.
const DESKTOP_TOOLTIP = 'dsh-desktop-tooltip'

type TipPlace = { top: number, left: number, transform: string }

function placeAccountTip(anchor: HTMLElement, wide: boolean): TipPlace {
  const box = anchor.getBoundingClientRect()
  if (!wide) {
    return {
      top: Math.round(box.top + box.height / 2),
      left: Math.round(box.right + 8),
      transform: 'translateY(-50%)',
    }
  }
  return {
    top: Math.round(box.top - 8),
    left: Math.round(box.left + box.width / 2),
    transform: 'translate(-50%, -100%)',
  }
}

type DialogListener = () => void

const accountDialog = {
  open: false,
  listeners: new Set<DialogListener>(),
  subscribe(listener: DialogListener) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  },
  set(open: boolean) {
    if (this.open === open) return
    this.open = open
    for (const listener of this.listeners) listener()
  }
}

export function accountDialogOpen(): boolean {
  return accountDialog.open
}

export function openAccountDialog(): void {
  accountDialog.set(true)
}

export function closeAccountDialog(): void {
  accountDialog.set(false)
}

export function toggleAccountDialog(): void {
  accountDialog.set(!accountDialog.open)
}

export function resetAccountDialog(): void {
  accountDialog.open = false
  accountDialog.listeners.clear()
}

export function AccountButton({ t, wide, onStatus }: {
  t: Translate
  wide?: boolean
  onStatus?: (next: AccountSnapshot) => void
}) {
  const [status, setStatus] = useState(() => statusBus.current)
  const [open, setOpen] = useState(() => accountDialogOpen())
  const [tip, setTip] = useState<TipPlace | null>(null)
  useEffect(() => {
    let alive = true
    const seen = statusBus.revision
    const unsubscribe = statusBus.subscribe(next => { if (alive) setStatus(next) })
    const unsubscribeDialog = accountDialog.subscribe(() => { if (alive) setOpen(accountDialog.open) })
    const show = () => { openAccountDialog() }
    window.addEventListener(OPEN_EVENT, show)
    void window.dshDesktop?.account?.status()?.then(next => {
      if (!alive || seen !== statusBus.revision) return
      publishStatus(next)
    }).catch(() => undefined)
    return () => {
      alive = false
      unsubscribe()
      unsubscribeDialog()
      statusBus.reset()
      window.removeEventListener(OPEN_EVENT, show)
    }
  }, [])
  if (!window.dshDesktop?.account) return null
  const signedIn = status?.signedIn === true && status.email !== ''
  const label = signedIn ? t('signedInName', { email: status.email }) : t('open')
  const report = typeof onStatus === 'function' ? onStatus : publishStatus
  const showTip = (anchor: HTMLElement) => { setTip(placeAccountTip(anchor, wide !== false)) }
  const hideTip = () => { setTip(null) }
  return (
    <>
      <div data-dsh-taichi-account-entry="true" data-wide={wide === false ? 'false' : 'true'}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-dsh-taichi-account="true"
          data-signed-in={signedIn ? 'true' : 'false'}
          data-selected={open ? 'true' : 'false'}
          aria-pressed={open ? 'true' : 'false'}
          aria-label={label}
          icon={<IconUserOutlineRegular size={16} />}
          onPointerEnter={event => { showTip(event.currentTarget) }}
          onPointerLeave={hideTip}
          onFocus={event => { showTip(event.currentTarget) }}
          onBlur={hideTip}
          onClick={() => { hideTip(); toggleAccountDialog() }}
        />
        {tip ? (
          <span
            className={DESKTOP_TOOLTIP}
            role="tooltip"
            style={{ position: 'fixed', zIndex: 1100, top: tip.top, left: tip.left, transform: tip.transform }}
          >
            {label}
          </span>
        ) : null}
        {signedIn ? <span className={styles.presence} aria-hidden="true" /> : null}
      </div>
      {open ? <AccountPanel t={t} onClose={closeAccountDialog} onStatus={report} /> : null}
    </>
  )
}
