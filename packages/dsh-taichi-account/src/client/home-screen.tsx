import type { ReactNode } from 'react'
import { Button, SegmentedControl, SegmentedTabs, IconUserOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountSnapshot } from './bridge'
import type { Translate } from './locale'
import { messageText } from './locale'
import {
  accountCredits,
  accountMedia,
  accountModels,
  activeRange,
  formatCredits,
  formatWhen,
  grantLabel,
  initialOf,
  mediaByPrice,
  modelsByPrice,
  modelsByVendor,
  profileFlags,
  rangeStats,
  type RangeKind
} from './catalog'
import { consumptionChart, mediaCards, modelCards } from './model-view'
import styles from './account.module.css'

type Section = 'models' | 'usage' | 'recharge'
type CatalogKind = 'chat' | 'image' | 'video'
type ModelSort = 'vendor' | 'price'

export interface HomeScreenProps {
  t: Translate
  status: AccountSnapshot
  busy: boolean
  task: string
  errorCode: string
  section: string
  onSection: (value: Section) => void
  range: string
  onRange: (value: RangeKind) => void
  modelSort: string
  onModelSort: (value: ModelSort) => void
  catalog: string
  onCatalog: (value: CatalogKind) => void
  modelsId: string
  usageId: string
  rechargeId: string
  onCheckIn: () => void
  onRecharge: () => void
  onLogout: () => void
  onRetry: () => void
}

function tabLabel(text: string, count: number): ReactNode {
  if (!(count > 0)) return text
  return <>{text}{' '}<span className={styles.tabCount}>{String(count)}</span></>
}

function statCard(label: string, value: string, tone: string): ReactNode {
  return (
    <div className={styles.stat} data-tone={tone}>
      <p className={styles.statLabel} data-dsh-account-stat-label="true">{label}</p>
      <p className={styles.statValue} data-dsh-account-stat-value="true">{value}</p>
    </div>
  )
}

function activityEntry(key: string, title: string, when: string, amount: number, sign: 'plus' | 'minus'): ReactNode {
  return (
    <li key={key}>
      <div className={styles.entry}>
        <div className={styles.entryMain}>
          <p className={styles.entryTitle}>{title}</p>
          {when ? <p className={styles.entryTime}>{when}</p> : null}
        </div>
        <span className={styles.entryAmount} data-sign={sign}>{`${sign === 'plus' ? '+' : '−'}${formatCredits(amount)}`}</span>
      </div>
    </li>
  )
}

function mediaCatalog(t: Translate, models: ReturnType<typeof accountMedia>, failed: boolean, emptyKey: string, unreadKey: string, unitKey: string): ReactNode {
  if (failed) return <p className={styles.empty}>{t(unreadKey)}</p>
  if (models.length === 0) return <p className={styles.empty}>{t(emptyKey)}</p>
  return <ul className={styles.models}>{mediaCards(t, mediaByPrice(models), unitKey)}</ul>
}

/** Called during the panel render so the page tree contains the cards. */
export function homeScreen(props: HomeScreenProps): ReactNode {
  const { t, status, busy, task, errorCode, section, onSection, range, onRange, modelSort, onModelSort, catalog, onCatalog, modelsId, usageId, rechargeId, onCheckIn, onRecharge, onLogout, onRetry } = props
  const flags = profileFlags(status)
  const checkedIn = status.checkedIn === true || status.message === 'checked_in'
  const balance = status.balance == null ? '—' : status.balance
  const balanceCaption = status.balance == null ? t('balanceUnread') : checkedIn ? t('checked_in') : t('balance')
  const announced = checkedIn && status.balance != null
  const models = accountModels(status.models)
  const imageModels = accountMedia(status.imageModels)
  const videoModels = accountMedia(status.videoModels)
  const credits = accountCredits(status.credits)
  const selectedRange = activeRange(range)
  const stats = credits ? rangeStats(credits, selectedRange) : undefined
  const active: Section = section === 'usage' || section === 'recharge' ? section : 'models'
  const modelsPanel = `${modelsId}-panel`
  const usagePanel = `${usageId}-panel`
  const rechargePanel = `${rechargeId}-panel`
  const panelId = active === 'usage' ? usagePanel : active === 'recharge' ? rechargePanel : modelsPanel
  const panelLabel = active === 'usage' ? usageId : active === 'recharge' ? rechargeId : modelsId
  const activity = active === 'usage'
    ? credits?.consumption.map(entry => activityEntry(entry.id, entry.model || t('usageUntitled'), formatWhen(entry.createdAt), entry.amount, 'minus')) ?? []
    : active === 'recharge'
      ? credits?.recharge.map(entry => activityEntry(entry.id, t(grantLabel(entry.kind)), formatWhen(entry.createdAt), entry.amount, 'plus')) ?? []
      : []
  const sort: ModelSort = modelSort === 'price' ? 'price' : 'vendor'
  const kind: CatalogKind = catalog === 'image' || catalog === 'video' ? catalog : 'chat'
  const vendorGroups = sort === 'vendor' ? modelsByVendor(models, t) : []
  const priced = sort === 'price' ? modelsByPrice(models) : vendorGroups[0]?.models
  const chatCatalog = flags.models
    ? <p className={styles.empty}>{t('modelsUnread')}</p>
    : models.length > 0
      ? sort === 'price' || vendorGroups.length < 2
        ? <ul className={styles.models}>{modelCards(t, priced ?? [])}</ul>
        : (
          <div className={styles.vendors}>
            {vendorGroups.map(group => (
              <section key={group.key || 'other'} className={styles.vendor}>
                <h3 className={styles.vendorName} data-dsh-account-vendor="true">{group.label}</h3>
                <ul className={styles.models}>{modelCards(t, group.models)}</ul>
              </section>
            ))}
          </div>
        )
      : <p className={styles.empty}>{t('modelsEmpty')}</p>
  const modelsView = (
    <>
      <div className={styles.catalogBar}>
        <SegmentedControl
          id="dsh-taichi-account-catalog"
          className={styles.modelSort}
          label={t('catalogKind')}
          value={kind}
          options={[
            { value: 'chat', label: t('catalogChat') },
            { value: 'image', label: t('catalogImage') },
            { value: 'video', label: t('catalogVideo') }
          ]}
          onChange={onCatalog}
        />
        {kind === 'chat' && !flags.models && models.length > 0
          ? (
            <div className={styles.sort}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('sortModels')}
                aria-pressed={sort === 'price'}
                onClick={() => { onModelSort(sort === 'price' ? 'vendor' : 'price') }}
              >
                {t(sort === 'price' ? 'sortByPrice' : 'sortByVendor')}
              </Button>
            </div>
          )
          : null}
      </div>
      {kind === 'image'
        ? mediaCatalog(t, imageModels, flags.images, 'imagesEmpty', 'imagesUnread', 'pricePerImage')
        : kind === 'video'
          ? mediaCatalog(t, videoModels, flags.videos, 'videosEmpty', 'videosUnread', 'pricePerVideo')
          : chatCatalog}
    </>
  )
  const ledger = !credits
    ? <p className={styles.empty}>{t('creditsUnread')}</p>
    : activity.length > 0
      ? <ul className={styles.entries}>{activity}</ul>
      : <p className={styles.empty}>{t(active === 'usage' ? 'consumptionEmpty' : 'rechargeEmpty')}</p>
  const tabs: [SegmentedTab<Section>, SegmentedTab<Section>, SegmentedTab<Section>] = [
    { value: 'models', label: tabLabel(t('models'), flags.models ? 0 : models.length), id: modelsId, panelId: modelsPanel },
    { value: 'usage', label: tabLabel(t('consumption'), credits?.consumption.length ?? 0), id: usageId, panelId: usagePanel },
    { value: 'recharge', label: tabLabel(t('recharge'), credits?.recharge.length ?? 0), id: rechargeId, panelId: rechargePanel }
  ]
  return (
    <>
      {errorCode ? <p className={styles.alert} role="alert">{messageText(t, errorCode)}</p> : null}
      <section className={styles.overview}>
        <div className={styles.identity}>
          <span className={styles.avatar} aria-hidden="true">{initialOf(status.email) || <IconUserOutlineRegular size={16} />}</span>
          <div className={styles.identityText}>
            <p className={styles.email}>{status.email}</p>
          </div>
          <Button variant="ghost" size="sm" className={styles.logout} disabled={busy} onClick={onLogout}>
            {t(task === 'logout' ? 'signingOut' : 'logout')}
          </Button>
        </div>
        <div className={styles.hero}>
          <div className={styles.credits}>
            <div className={styles.creditMain}>
              <p
                className={styles.caption}
                data-dsh-account-caption="true"
                role={announced ? 'status' : undefined}
                aria-live={announced ? 'polite' : undefined}
                data-success={announced ? 'true' : 'false'}
              >
                {balanceCaption}
              </p>
              <p className={styles.balance} data-dsh-account-balance="true">{String(balance)}</p>
            </div>
            <div className={styles.creditActions}>
              <Button variant={checkedIn ? 'ghost' : 'primary'} size="sm" disabled={busy || checkedIn} onClick={onCheckIn}>
                {t(task === 'checkIn' ? 'checkingIn' : checkedIn ? 'checkedInDone' : 'checkIn')}
              </Button>
              <Button variant={checkedIn ? 'primary' : 'ghost'} size="sm" disabled={busy} onClick={onRecharge}>{t('rechargeAction')}</Button>
            </div>
          </div>
          {credits
            ? (
              <div className={styles.heroStat}>
                <p className={styles.statLabel} data-dsh-account-stat-label="true">{t('totalConsumed')}</p>
                <p className={styles.balance} data-dsh-account-balance="true">{formatCredits(credits.consumed)}</p>
              </div>
            )
            : null}
        </div>
        {stats
          ? (
            <SegmentedControl
              id="dsh-taichi-account-range"
              className={styles.ranges}
              label={t('creditStats')}
              value={selectedRange}
              options={[
                { value: 'today', label: t('rangeToday') },
                { value: 'yesterday', label: t('rangeYesterday') },
                { value: '7', label: t('range7') },
                { value: '30', label: t('range30') },
                { value: 'all', label: t('rangeAll') }
              ]}
              onChange={onRange}
            />
          )
          : null}
        {stats
          ? (
            <div className={styles.metrics}>
              {statCard(t('consumed'), formatCredits(stats.consumed), 'minus')}
              {statCard(t('recharged'), formatCredits(stats.recharged), 'plus')}
              {statCard(t('usageCount'), formatCredits(stats.count), 'count')}
            </div>
          )
          : <p className={styles.unread}>{t('creditsUnread')}</p>}
        {stats
          ? (
            <section className={styles.chart}>
              <div className={styles.chartHead}>
                <span className={styles.statLabel} data-dsh-account-stat-label="true">{t('consumed')}</span>
                <span className={styles.chartTotal}>{formatCredits(stats.consumed)}</span>
              </div>
              {consumptionChart(t, stats.points)}
            </section>
          )
          : null}
      </section>
      <section className={styles.board}>
        <SegmentedTabs label={t('titleAccount')} value={active} size="sm" onChange={onSection} items={tabs} />
        <div className={styles.panel} role="tabpanel" id={panelId} aria-labelledby={panelLabel}>
          {active === 'models' ? modelsView : ledger}
        </div>
      </section>
      {flags.models || flags.balance || flags.images || flags.videos
        ? (
          <div className={styles.retry}>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onRetry}>{t(task === 'refresh' ? 'retrying' : 'retry')}</Button>
          </div>
        )
        : null}
    </>
  )
}
