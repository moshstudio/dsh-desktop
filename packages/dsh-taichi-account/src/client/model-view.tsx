import type { ReactNode } from 'react'
import { Button, Tooltip, IconInfoOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './locale'
import {
  formatCredits,
  formatTick,
  axisTicks,
  niceCeiling,
  savingsPercent,
  saveLabel,
  weekdayKey,
  type CatalogModel,
  type CreditDay,
  type LongContextPrice,
  type MediaModel,
  type MediaTier,
  type ModelPrice,
  type PeakPrice
} from './catalog'
import styles from './account.module.css'

function joined(t: Translate, items: string[]): ReactNode[] {
  const nodes: ReactNode[] = []
  items.forEach((item, index) => {
    if (index > 0) nodes.push(t('listSeparator'))
    nodes.push(item)
  })
  return nodes
}

function rateRow(t: Translate, label: string, credits: number, listCredits: number | undefined): ReactNode {
  return (
    <div className={styles.rate}>
      <span className={styles.rateLabel} data-dsh-account-rate-label="true">{t(label)}</span>
      <span className={styles.rateValues}>
        {listCredits !== undefined ? <del className={styles.rateList} data-dsh-account-rate-list="true">{formatCredits(listCredits)}</del> : null}
        <span className={styles.rateNow} data-dsh-account-rate="true">{formatCredits(credits)}</span>
        <span className={styles.rateUnit} data-dsh-account-rate-unit="true">{t('pricePerMillionUnit')}</span>
      </span>
    </div>
  )
}

function cacheLine(t: Translate, price: ModelPrice): ReactNode {
  const items: Array<[string, number]> = []
  if (price.cachePerMillion !== undefined) items.push(['cacheReadBrief', price.cachePerMillion])
  const write = price.cacheWrite5mPerMillion ?? price.cacheWrite1hPerMillion
  if (write !== undefined) items.push(['cacheWriteBrief', write])
  if (items.length === 0) return null
  const children: string[] = []
  items.forEach(([label, credits], index) => {
    if (index > 0) children.push(' · ')
    const unit = index === items.length - 1 ? 'perMillionTokens' : 'perMillion'
    children.push(t(label), ' ', formatCredits(credits), t(unit))
  })
  return <p className={styles.cache} data-dsh-account-cache="true">{children}</p>
}

function longContextLabel(t: Translate, tier: LongContextPrice): string {
  return [
    t('longContext'),
    t('longContextFrom'),
    formatCredits(tier.minInputTokens),
    t('tokens'),
    `${t('inputPrice')} ×${formatCredits(tier.input)}`,
    `${t('outputPrice')} ×${formatCredits(tier.output)}`,
    `${t('cachePrice')} ×${formatCredits(tier.cache)}`,
    `${t('cacheWritePrice')} ×${formatCredits(tier.cacheWrite)}`
  ].join(' ')
}

function longContextInfo(t: Translate, tier: LongContextPrice): ReactNode {
  return (
    <Tooltip label={longContextLabel(t, tier)} side="top" portal maxWidth={360} delayMs={200} openOnClick>
      <Button type="button" variant="ghost" size="sm" aria-label={t('longContext')} icon={<IconInfoOutlineRegular size={16} />} />
    </Tooltip>
  )
}

function peakNote(t: Translate, peak: PeakPrice): ReactNode {
  const days = peak.weekdays.map(day => t(weekdayKey(day)))
  const windows = peak.windows.map(window => `${window[0]}–${window[1]}`)
  return (
    <p className={styles.priceNote} data-dsh-account-price-note="true">
      {[
        t('peakPrice'),
        ' ×',
        formatCredits(peak.multiplier),
        ' ',
        t('peakUtc'),
        ' ',
        ...joined(t, days),
        ' ',
        ...joined(t, windows)
      ]}
    </p>
  )
}

export function modelPriceView(t: Translate, price: ModelPrice | undefined): ReactNode {
  if (!price) return <p className={styles.price}>{t('priceUnavailable')}</p>
  return (
    <>
      <div className={styles.modelMeta}>
        <span className={styles.bill} data-dsh-account-bill="true">{t('billedByToken')}</span>
        {price.longContext ? longContextInfo(t, price.longContext) : null}
      </div>
      <div className={styles.rates}>
        {rateRow(t, 'inputPrice', price.inputPerMillion, price.listInputPerMillion)}
        {rateRow(t, 'outputPrice', price.outputPerMillion, price.listOutputPerMillion)}
      </div>
      {cacheLine(t, price)}
      {price.peak ? peakNote(t, price.peak) : null}
    </>
  )
}

export function modelCards(t: Translate, models: CatalogModel[]): ReactNode {
  return models.map((model, index) => {
    const percent = model.price ? savingsPercent(model.price) : undefined
    return (
      <li key={`${model.id}-${index}`}>
        <article className={styles.model}>
          <div className={styles.modelHead}>
            <h4 className={styles.modelName} data-dsh-account-model-name="true">{model.name}</h4>
            {percent !== undefined ? <span className={styles.save} data-dsh-account-save="true">{saveLabel(t, percent)}</span> : null}
          </div>
          {modelPriceView(t, model.price)}
        </article>
      </li>
    )
  })
}

function mediaTierGroups(tiers: MediaTier[]): Array<{ tiers: string[], credits: number }> {
  const groups: Array<{ tiers: string[], credits: number }> = []
  for (const row of tiers) {
    const last = groups[groups.length - 1]
    if (last && last.credits === row.credits) last.tiers.push(row.tier)
    else groups.push({ tiers: [row.tier], credits: row.credits })
  }
  return groups
}

function mediaTierLabel(tiers: string[]): string {
  return tiers.map(tier => tier.toUpperCase()).join(' / ')
}

function mediaRate(label: string, credits: number, unit: string): ReactNode {
  return (
    <div className={styles.rate} key={label || 'price'}>
      {label ? <span className={styles.rateLabel} data-dsh-account-rate-label="true">{label}</span> : null}
      <span className={styles.rateValues}>
        <span className={styles.rateNow} data-dsh-account-rate="true">{formatCredits(credits)}</span>
        <span className={styles.rateUnit} data-dsh-account-rate-unit="true">{unit}</span>
      </span>
    </div>
  )
}

export function mediaPriceView(t: Translate, model: MediaModel, unitKey: string): ReactNode {
  const groups = mediaTierGroups(model.qualityCredits ?? [])
  if (groups.length > 0) {
    const unit = t(unitKey)
    return <div className={styles.rates}>{groups.map(group => mediaRate(mediaTierLabel(group.tiers), group.credits, unit))}</div>
  }
  if (model.credits === undefined) return <p className={styles.price}>{t('priceUnavailable')}</p>
  return <div className={styles.rates}>{mediaRate('', model.credits, t(unitKey))}</div>
}

export function mediaCards(t: Translate, models: MediaModel[], unitKey: string): ReactNode {
  return models.map((model, index) => (
    <li key={`${model.id}-${index}`}>
      <article className={styles.model}>
        <div className={styles.modelHead}>
          <h4 className={styles.modelName} data-dsh-account-model-name="true">{model.name}</h4>
        </div>
        {mediaPriceView(t, model, unitKey)}
      </article>
    </li>
  ))
}

interface ChartBar {
  x: number
  y: number
  height: number
  width: number
  hitX: number
  hitWidth: number
  date: string
  amount: number
  visible: boolean
  labeled: boolean
}

export function consumptionChart(t: Translate, points: CreditDay[]): ReactNode {
  if (!points.some(point => point.consumed > 0)) return <p className={styles.chartEmpty}>{t('chartEmpty')}</p>
  const width = 640
  const height = 168
  const pad = { left: 46, right: 16, top: 18, bottom: 26 }
  const max = Math.max(...points.map(point => point.consumed))
  const ceiling = niceCeiling(max, 4)
  const ticks = axisTicks(0, ceiling, 4)
  const marks = ticks.length > 0 ? ticks : [0, ceiling]
  const plot = height - pad.top - pad.bottom
  const slot = (width - pad.left - pad.right) / points.length
  const barWidth = Math.max(4, Math.min(18, slot * 0.56))
  const baseline = pad.top + plot
  const labelStride = Math.max(1, Math.ceil(48 / slot))
  const bars: ChartBar[] = points.map((point, index) => {
    const bar = point.consumed <= 0 ? 0 : Math.max((point.consumed / ceiling) * plot, 2)
    const x = pad.left + slot * index + (slot - barWidth) / 2
    return {
      x,
      y: baseline - bar,
      height: bar,
      width: barWidth,
      hitX: pad.left + slot * index,
      hitWidth: slot,
      date: point.date,
      amount: point.consumed,
      visible: point.consumed > 0,
      labeled: index % labelStride === 0 || index === points.length - 1
    }
  })
  return (
    <div className={styles.chartPlot}>
      <svg className={styles.chartSvg} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('creditStats')}>
        {marks.map(mark => {
          const y = baseline - (mark / ceiling) * plot
          return <line key={`grid-${mark}`} className={styles.chartGrid} x1={pad.left} x2={width - pad.right} y1={y} y2={y} />
        })}
        {marks.map(mark => (
          <text key={`tick-${mark}`} className={styles.chartLabel} x={pad.left - 6} y={baseline - (mark / ceiling) * plot} textAnchor="end" dominantBaseline="middle">{formatTick(mark)}</text>
        ))}
        {bars.filter(bar => bar.visible).map(bar => (
          <rect key={bar.date} className={styles.chartBar} x={bar.x.toFixed(1)} y={bar.y.toFixed(1)} width={bar.width.toFixed(1)} height={bar.height.toFixed(1)} rx={Math.min(3, bar.width / 2)} />
        ))}
        {bars.filter(bar => bar.labeled).map(bar => (
          <text key={`label-${bar.date}`} className={styles.chartLabel} x={(bar.x + bar.width / 2).toFixed(1)} y={height - 6} textAnchor="middle">{bar.date.slice(5)}</text>
        ))}
      </svg>
      {bars.map(bar => {
        const hitHeight = Math.max(bar.height, 12)
        const hitTop = Math.max(pad.top, bar.y + bar.height - hitHeight)
        return (
          <div
            key={bar.date}
            className={styles.chartHit}
            tabIndex={0}
            aria-label={`${bar.date} ${formatCredits(bar.amount)}`}
            style={{
              left: `${(bar.hitX / width) * 100}%`,
              width: `${(bar.hitWidth / width) * 100}%`,
              top: `${(hitTop / height) * 100}%`,
              height: `${(hitHeight / height) * 100}%`
            }}
          >
            <span className={styles.chartTip} data-dsh-account-chart-tip="true" role="tooltip">{bar.date}{' · '}{formatCredits(bar.amount)}</span>
          </div>
        )
      })}
    </div>
  )
}
