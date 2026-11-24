import { useEffect, useState } from 'react'
import { IconUserOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountSnapshot } from './bridge'
import type { Translate } from './locale'
import { AccountPanel } from './account-panel'
import { publishStatus, statusBus } from './status'
import styles from './account.module.css'

const OPEN_EVENT = 'dsh-taichi-account-open'

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
  const openDialog = () => { toggleAccountDialog() }
  // wide=false is the rail seat. The rail's sliding mark and tooltip follow
  // data-dsh-activity; the button itself keeps the positioning context, so the
  // presence dot stays on the glyph instead of the rail.
  if (wide === false) {
    return (
      <>
        <button
          type="button"
          data-dsh-activity=""
          data-dsh-taichi-account="true"
          data-signed-in={signedIn ? 'true' : 'false'}
          data-label={label}
          data-selected={open ? 'true' : 'false'}
          aria-label={label}
          aria-pressed={open ? 'true' : 'false'}
          onClick={openDialog}
        >
          <IconUserOutlineRegular size={16} />
          {signedIn ? <span className={styles.presence} aria-hidden="true" /> : null}
        </button>
        {open ? <AccountPanel t={t} onClose={closeAccountDialog} onStatus={report} /> : null}
      </>
    )
  }
  return (
    <>
      <div data-dsh-taichi-account-entry="true" data-wide="true">
        <button
          type="button"
          data-dsh-taichi-account="true"
          data-signed-in={signedIn ? 'true' : 'false'}
          data-selected={open ? 'true' : 'false'}
          aria-pressed={open ? 'true' : 'false'}
          aria-label={label}
          onClick={() => { toggleAccountDialog() }}
        >
          <IconUserOutlineRegular size={16} />
        </button>
        {signedIn ? <span className={styles.presence} aria-hidden="true" /> : null}
      </div>
      {open ? <AccountPanel t={t} onClose={closeAccountDialog} onStatus={report} /> : null}
    </>
  )
}
