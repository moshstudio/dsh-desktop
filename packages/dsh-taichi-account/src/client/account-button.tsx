import { useEffect, useState } from 'react'
import { Button, Tooltip, IconUserOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
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
  return (
    <>
      <div data-dsh-taichi-account-entry="true" data-wide={wide === false ? 'false' : 'true'}>
        <Tooltip label={label} side={wide === false ? 'right' : 'top'} align={wide === false ? 'center' : 'end'} portal maxWidth={280} delayMs={0} focusDelayMs={0}>
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
            onClick={() => { toggleAccountDialog() }}
          />
        </Tooltip>
        {signedIn ? <span className={styles.presence} aria-hidden="true" /> : null}
      </div>
      {open ? <AccountPanel t={t} onClose={closeAccountDialog} onStatus={report} /> : null}
    </>
  )
}
