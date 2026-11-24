import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactElement } from 'react'
import css from './Market.module.css'
import { IconQuestionOutline14 } from './icons.ts'
import { CatalogGrid } from './MarketLayout.tsx'
import type { RegistryPlugin } from './market-data.ts'

export function RecommendationGrid({ titleId, title, help, empty, plugins, renderCard }: {
  titleId: string
  title: string
  help?: string
  empty: string
  plugins: RegistryPlugin[]
  renderCard: (plugin: RegistryPlugin) => ReactElement
}): ReactElement {
  return (
    <section className={css.recentBlock} aria-labelledby={titleId}>
      <div className={css.recentHead}>
        <h3 id={titleId} className={css.favoritesSectionHead}>{title}</h3>
        {help !== undefined && (
          <Tooltip label={help} side="bottom" delayMs={150} portal maxWidth={320}>
            <span className={css.aiHelp} tabIndex={0} aria-label={help}><IconQuestionOutline14 size={14} /></span>
          </Tooltip>
        )}
      </div>
      {plugins.length === 0
        ? <p className={css.empty}>{empty}</p>
        : <CatalogGrid items={plugins} render={renderCard} />}
    </section>
  )
}