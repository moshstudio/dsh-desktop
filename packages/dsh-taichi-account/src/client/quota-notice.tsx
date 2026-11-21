import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './locale'

export function QuotaRechargeNotice({ matched, t }: {
  matched?: { dismiss?: () => void }
  t: Translate
}) {
  const dismiss = typeof matched?.dismiss === 'function' ? matched.dismiss : () => {}
  return (
    <Modal
      open
      title={t('quotaTitle')}
      closeLabel={t('close')}
      description={t('quotaDescription')}
      onClose={dismiss}
      footer={<Button variant="primary" onClick={dismiss}>{t('quotaConfirm')}</Button>}
    />
  )
}
