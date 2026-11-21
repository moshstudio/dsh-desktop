import type { ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './locale'
import { messageText } from './locale'
import { formatCredits } from './catalog'
import styles from './account.module.css'

const RECHARGE_YUAN = [39, 99, 199, 299] as const
const CREDIT_PER_YUAN = 1000

export function paymentQr(value: unknown): string {
  return typeof value === 'string' && value.startsWith('data:image/png;base64,') && value.length <= 200000 ? value : ''
}

export interface RechargeDialogProps {
  t: Translate
  open: boolean
  busy: boolean
  phase: string
  notice: string
  qr: string
  onClose: () => void
  onBuy: (yuan: number) => void
}

/** Called during the panel render so the amount cards stay in the page tree. */
export function rechargeDialog({ t, open, busy, phase, notice, qr, onClose, onBuy }: RechargeDialogProps): ReactNode {
  if (!open) return null
  const code = paymentQr(qr)
  return (
    <Modal open title={t('rechargeTitle')} closeLabel={t('close')} description={t('rechargeRate')} onClose={() => { if (!busy) onClose() }}>
      <div className={styles.recharge}>
        <div className={styles.packs} role="list">
          {/* Button is a single-line control. A tier has to show the yuan amount
              and the credited points together, so this card stays local. */}
          {RECHARGE_YUAN.map(yuan => (
            <button
              key={String(yuan)}
              type="button"
              className={styles.pack}
              data-dsh-account-pack="true"
              data-yuan={String(yuan)}
              data-credits={String(yuan * CREDIT_PER_YUAN)}
              disabled={busy}
              onClick={() => { onBuy(yuan) }}
            >
              {t('rechargeYuan', { yuan: String(yuan) })}
              {t('rechargeCredits', { credits: formatCredits(yuan * CREDIT_PER_YUAN) })}
            </button>
          ))}
        </div>
        {code && phase === 'waiting'
          ? <img className={styles.qr} data-dsh-account-qr="true" src={code} alt={t('rechargeScan')} width={220} height={220} />
          : null}
        {phase === 'paid'
          ? <p className={styles.status} role="status">{t('rechargePaid')}</p>
          : phase === 'waiting'
            ? <p className={styles.status} role="status">{t('rechargeWaiting')}</p>
            : null}
        {notice ? <p className={styles.alert} role="alert">{messageText(t, notice)}</p> : null}
      </div>
    </Modal>
  )
}
