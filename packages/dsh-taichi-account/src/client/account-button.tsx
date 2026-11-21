import { useEffect, useState } from 'react'
import { Button, Tooltip, IconUserOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LayoutScope } from './bridge'
import type { Translate } from './locale'
import { publishStatus, statusBus } from './status'
import styles from './account.module.css'

const OPEN_EVENT = 'dsh-taichi-account-open'

export function AccountButton({ t, wide, layout, panelId, showAccount, toggleAccount }: {
  t: Translate
  wide?: boolean
  layout?: LayoutScope
  panelId?: string
  showAccount?: () => void
  toggleAccount?: () => void
}) {
  const [status, setStatus] = useState(() => statusBus.current)
  const [selected, setSelected] = useState(() => layout?.panelInfo?.getSnapshot?.()?.activePanelId === panelId)
  useEffect(() => {
    let alive = true
    const seen = statusBus.revision
    const unsubscribe = statusBus.subscribe(next => { if (alive) setStatus(next) })
    const show = () => { if (typeof showAccount === 'function') showAccount() }
    window.addEventListener(OPEN_EVENT, show)
    void window.dshDesktop?.account?.status()?.then(next => {
      if (!alive || seen !== statusBus.revision) return
      publishStatus(next)
    }).catch(() => undefined)
    return () => {
      alive = false
      unsubscribe()
      statusBus.reset()
      window.removeEventListener(OPEN_EVENT, show)
    }
  }, [showAccount])
  useEffect(() => {
    const info = layout?.panelInfo
    if (typeof info?.subscribe !== 'function' || typeof info.getSnapshot !== 'function') return undefined
    const sync = () => { setSelected(info.getSnapshot?.()?.activePanelId === panelId) }
    sync()
    return info.subscribe(sync)
  }, [layout, panelId])
  if (!window.dshDesktop?.account) return null
  const signedIn = status?.signedIn === true && status.email !== ''
  const label = signedIn ? t('signedInName', { email: status.email }) : t('open')
  return (
    <div data-dsh-taichi-account-entry="true" data-wide={wide === false ? 'false' : 'true'}>
      <Tooltip label={label} side={wide === false ? 'right' : 'top'} align={wide === false ? 'center' : 'end'} portal maxWidth={280} delayMs={0} focusDelayMs={0}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-dsh-taichi-account="true"
          data-signed-in={signedIn ? 'true' : 'false'}
          data-selected={selected ? 'true' : 'false'}
          aria-pressed={selected ? 'true' : 'false'}
          aria-label={label}
          icon={<IconUserOutlineRegular size={16} />}
          onClick={() => { if (typeof toggleAccount === 'function') toggleAccount() }}
        />
      </Tooltip>
      {signedIn ? <span className={styles.presence} aria-hidden="true" /> : null}
    </div>
  )
}
