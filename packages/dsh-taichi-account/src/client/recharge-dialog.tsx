import type { ReactNode } from 'react'
import { Button, IconCheckOutlineRegular, IconChevronRightOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RechargePackage } from './bridge'
import type { Translate } from './locale'
import { messageText } from './locale'
import { formatCredits } from './catalog'
import styles from './account.module.css'

export function paymentQr(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192) return ''
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') return ''
    if (url.hostname !== 'openapi.alipay.com' || url.pathname !== '/gateway.do') return ''
    if (url.searchParams.get('method') !== 'alipay.trade.page.pay') return ''
    if (url.searchParams.get('sign_type') !== 'RSA2' || !url.searchParams.get('sign')) return ''
    return url.toString()
  } catch {
    return ''
  }
}

export interface RechargeDialogProps {
  t: Translate
  open: boolean
  busy: boolean
  phase: string
  notice: string
  qr: string
  packages: RechargePackage[] | null
  paymentAvailable: boolean
  onClose: () => void
  onRetry: () => void
  onBuy: (yuan: number) => void
}

/** Called during the panel render so the amount cards stay in the page tree. */
export function rechargeDialog({ t, open, busy, phase, notice, qr, packages, paymentAvailable, onClose, onRetry, onBuy }: RechargeDialogProps): ReactNode {
  if (!open) return null
  const code = paymentQr(qr)
  const listed = packages ?? []
  const waiting = phase === 'waiting'
  const paid = phase === 'paid'
  const opening = phase === 'opening'
  return (
    <Modal
      open
      title={t('rechargeTitle')}
      closeLabel={t('close')}
      description={waiting || paid ? undefined : t('rechargeRate')}
      className={styles.rechargeModal}
      onClose={() => { if (!busy) onClose() }}
    >
      <div className={styles.recharge}>
        {paid ? (
          <div className={styles.paymentStage}>
            <span className={styles.paymentSuccess} aria-hidden="true"><IconCheckOutlineRegular size={24} /></span>
            <p className={styles.paymentResult} role="status">{t('rechargePaid')}</p>
            <Button variant="primary" size="sm" onClick={onClose}>{t('close')}</Button>
          </div>
        ) : waiting ? (
          <div className={styles.paymentStage}>
            {code && (
              <div className={styles.qrFrame}>
                <iframe className={styles.qr} data-dsh-account-qr="true" src={code} title={t('rechargeScan')} width={220} height={220} />
              </div>
            )}
            <p className={styles.paymentHint} role="status">{t('rechargeWaiting')}</p>
          </div>
        ) : phase === 'loading' ? (
          <div className={styles.packState} role="status">
            <p>{t('rechargeLoading')}</p>
          </div>
        ) : packages === null ? (
          <div className={styles.packState}>
            <p className={styles.paymentError} role="alert">{messageText(t, notice || 'unavailable')}</p>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onRetry} data-dsh-account-pack-retry="true">{t('retry')}</Button>
          </div>
        ) : (
          <>
            {listed.length === 0 ? (
              <div className={styles.packState} role="status"><p>{t('rechargeEmptyPackages')}</p></div>
            ) : (
              <ul className={styles.packs} role="list">
                {/* A tier needs two text lines and a trailing icon; the standard Button is single-line. */}
                {listed.map(pack => (
                  <li key={String(pack.yuan)}>
                    <button
                      type="button"
                      className={styles.pack}
                      data-dsh-account-pack="true"
                      data-yuan={String(pack.yuan)}
                      data-credits={String(pack.credits)}
                      disabled={busy || !paymentAvailable}
                      onClick={() => { onBuy(pack.yuan) }}
                    >
                      <span className={styles.packDetails}>
                        <strong className={styles.packCredits}>{t('rechargeCredits', { credits: formatCredits(pack.credits) })}</strong>
                        <span className={styles.packPrice}>{t('rechargeYuan', { yuan: String(pack.yuan) })}</span>
                      </span>
                      <span className={styles.packArrow} aria-hidden="true"><IconChevronRightOutlineRegular size={16} /></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {opening && <p className={styles.paymentHint} role="status">{t('creating')}</p>}
            {notice && <p className={styles.paymentError} role="alert">{messageText(t, notice)}</p>}
          </>
        )}
      </div>
    </Modal>
  )
}