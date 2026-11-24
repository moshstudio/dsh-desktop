/**
 * The tab bodies of the Market section other than Installed: Backup, Discover, Favorites, Themes and Blocked, plus the "market gone" notice.
 */

import { Button, Input, Menu, Pill, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import css from './Market.module.css'
import { IconCloseOutline16 } from './icons.ts'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconChevronUpOutline14,
  IconDownloadOutline16,
  IconFolderOpen16,
  IconFullscreenOutline16,
  IconLinkOutline14,
} from './icons.ts'
import { api, categoryLabel, formatCount, orderedCategories, themeSwatch } from './market-data.ts'
import { discoverHomeView } from './discover-teasers.ts'
import { SearchInput } from './SearchInput.tsx'
import { MarketLogo } from './MarketLogo.tsx'
import { EmptyResults, FilterMenu, LoadMore, Pager } from './MarketListControls.tsx'
import { CatalogGrid, Masonry } from './MarketLayout.tsx'
import type { MarketStateCtx } from './market-state.tsx'
import type { MarketInstallCtx } from './market-install.ts'
import type { MarketGroupsBackupCtx } from './market-groups-backup.ts'
import type { MarketRenderCtx } from './market-render.tsx'
import type { MarketSyncCtx } from './market-sync.ts'
import type { MarketOperationsCtx } from './market-operations.ts'
import type { MarketSectionProps } from './market-types.ts'
import { useAiSearch } from './AiSearch.tsx'
import { AiRecommend } from './AiRecommend.tsx'
import { DiscoverStrip } from './DiscoverStrip.tsx'
import { ActiveFilters, CategoryRail } from './CategoryRail.tsx'

type MarketGoneNoticeCtx = { props: MarketSectionProps }
  & Pick<MarketStateCtx, 'reconnecting' | 'setReconnectRound' | 't'>

const HOST_FILTER_NOTE_KEY = 'taichi-dshm-host-filter-note-closed'

/**
 * How many incompatible plugins the compatibility filter hid on this page.
 * Closing it is remembered: the filter itself stays switchable under Filter,
 * so the count is never the only way to know it is on.
 */
function HostFilterNote({ text, t }: { text: string; t: (key: 'dismissNotice') => string }) {
  const [closed, setClosed] = useState(() => {
    try { return localStorage.getItem(HOST_FILTER_NOTE_KEY) === '1' } catch { return false }
  })
  if (closed) return null
  return (
    <div className={`${css.hostFilterNote} ${css.hostFilterNoteRow}`}>
      <span>{text}</span>
      <button
        type="button"
        className={css.bannerClose}
        aria-label={t('dismissNotice')}
        title={t('dismissNotice')}
        onClick={() => {
          setClosed(true)
          try { localStorage.setItem(HOST_FILTER_NOTE_KEY, '1') } catch { /* storage unavailable */ }
        }}
      ><IconCloseOutline16 size={12} /></button>
    </div>
  )
}

export function MarketGoneNotice({ c }: { c: MarketGoneNoticeCtx }) {
  const { reconnecting, setReconnectRound, t } = c
  return (
    <div className={css.empty} role="alert">
      <div><b>{t('marketGoneTitle')}</b></div>
      <div className={css.spec}>{t('marketGoneBody')}</div>
      {reconnecting
        ? <div className={css.spec}>{t('marketGoneReconnecting')}</div>
        : (
            <div>
              <Button variant="outline" size="sm" onClick={() => setReconnectRound(round => round + 1)}>
                {t('marketGoneReconnect')}
              </Button>
            </div>
          )}
    </div>
  )
}


type BackupTabCtx = { props: MarketSectionProps }
  & Pick<MarketStateCtx,
    'autoBackup' | 'backupBusy' | 'fileInputRef' | 'gistBusy' | 'gistId' | 'gistMessage' |
    'gistMode' | 'gistOk' | 'gistResult' | 'gistToken' | 'presetOpen' | 'rememberPassword' |
    'setAutoBackup' | 'setBackupMessage' | 'setGistId' | 'setGistMode' | 'setGistToken' |
    'setPresetOpen' | 'setRememberPassword' | 'setWebdavNeedsPassword' | 'setWebdavPassword' |
    'setWebdavSaved' | 'setWebdavUrl' | 'setWebdavUser' | 't' | 'webdavNeedsPassword' |
    'webdavPassword' | 'webdavUrl' | 'webdavUser'>
  & Pick<MarketInstallCtx, 'downloadFile'>
  & Pick<MarketGroupsBackupCtx,
    'openExportPicker' | 'previewBackup' | 'runGist' | 'runWebdav'>
  & Pick<MarketRenderCtx, 'labelledCheckbox'>

export function BackupTab({ c }: { c: BackupTabCtx }) {
  const {
    autoBackup, backupBusy, downloadFile, fileInputRef, gistBusy, gistId, gistMessage, gistMode,
    gistOk, gistResult, gistToken, labelledCheckbox, openExportPicker, presetOpen, previewBackup,
    rememberPassword, runGist, runWebdav, setAutoBackup, setBackupMessage, setGistId, setGistMode,
    setGistToken, setPresetOpen, setRememberPassword, setWebdavNeedsPassword, setWebdavPassword,
    setWebdavSaved, setWebdavUrl, setWebdavUser, t, webdavNeedsPassword, webdavPassword, webdavUrl,
    webdavUser,
  } = c
  return (
    <div className={css.backupGrid}>
      <section className={css.backupCard}>
        <h3>{t('backupLocal')}</h3>
        <p>{t('backupHint')}</p>
        <p className={css.backupWarn}>{t('credsWarning')}</p>
        <div className={css.backupActions}>
          <Button
            variant="primary"
            size="sm"
            icon={<IconDownloadOutline16 size={14} />}
            disabled={backupBusy}
            onClick={() => downloadFile(api('/taichi-dsh-market/backup'), 'dsh-profile-backup.json', t('backupExportFailed') + '：')}
          >{backupBusy ? t('backupWorking') : t('backupDownload')}</Button>
          <Button
            variant="outline"
            size="sm"
            icon={<IconFolderOpen16 size={14} />}
            disabled={backupBusy}
            onClick={() => fileInputRef.current?.click()}
          >{backupBusy ? t('backupWorking') : t('backupImport')}</Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className={css.hiddenFile}
            tabIndex={-1}
            aria-hidden="true"
            disabled={backupBusy}
            onChange={event => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file !== undefined) file.text().then(text => previewBackup(JSON.parse(text))).catch(error => setBackupMessage(String(error)))
            }}
          />
        </div>
      </section>
      <section className={css.backupCard}>
        <h3>{t('webdav')}</h3>
        <Menu
          open={presetOpen}
          onClose={() => setPresetOpen(false)}
          onSelect={id => {
            const urls: Record<string, string> = {
              jianguoyun: 'https://dav.jianguoyun.com/dav/dsh-profile-backup.json',
              koofr: 'https://app.koofr.net/dav/Koofr/dsh-profile-backup.json',
              nextcloud: 'https://nextcloud.example/remote.php/dav/files/USERNAME/dsh-profile-backup.json',
            }
            if (urls[id] !== undefined) setWebdavUrl(urls[id]!)
          }}
          align="start"
          anchor={(
            <Button
              variant="outline"
              size="sm"
              icon={<IconChevronDownOutline14 size={14} />}
              onClick={() => setPresetOpen(o => !o)}
            >{t('webdavPreset')}</Button>
          )}
          items={[
            { id: 'custom', label: t('webdavPreset') },
            { id: 'jianguoyun', label: '坚果云 / Nutstore' },
            { id: 'koofr', label: 'Koofr' },
            { id: 'nextcloud', label: 'Nextcloud' },
          ]}
        />
        <Input className={css.backupInput} icon={<IconLinkOutline14 size={14} />} type="url" value={webdavUrl} placeholder={t('webdavUrl')} onChange={e => setWebdavUrl(e.target.value)} />
        {/* The field had a placeholder and nothing else, so "is this a
            folder or a file?" was answered only by trying it — and a
            reporter who read it as a folder expected the market to
            name the file (#868). Name the shape, and say why the
            name has to stay put: restore looks for that same one. */}
        <p>{t('webdavPathHint')}</p>
        <Input className={css.backupInput} autoComplete="username" value={webdavUser} placeholder={t('webdavUser')} onChange={e => setWebdavUser(e.target.value)} />
        <Input className={css.backupInput} type="password" autoComplete="current-password" value={webdavPassword} placeholder={t('webdavPassword')} onChange={e => { setWebdavPassword(e.target.value); if (e.target.value !== '') setWebdavNeedsPassword(false) }} />
        {labelledCheckbox({
          label: t('webdavRemember'),
          checked: rememberPassword,
          className: css.backupCheck,
          onChange: on => {
            setRememberPassword(on)
            const call = on
              ? (webdavPassword === '' ? null : { action: 'remember', url: webdavUrl.trim(), username: webdavUser, password: webdavPassword })
              : { action: 'forget' }
            if (call === null) return
            fetch(api('/taichi-dsh-market/webdav'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(call) })
              .then(() => setWebdavSaved(on ? { remembered: true, url: webdavUrl.trim(), username: webdavUser } : { remembered: false }))
              .catch(() => { /* the next upload carries the choice again */ })
          },
        })}
        <div className={css.backupActions}>
          <Button variant="primary" size="sm" disabled={backupBusy || webdavUrl.trim() === ''} onClick={() => runWebdav('backup')}>{backupBusy ? t('backupWorking') : t('webdavUpload')}</Button>
          <Button variant="outline" size="sm" disabled={backupBusy || webdavUrl.trim() === ''} onClick={() => runWebdav('restore')}>{t('webdavRestore')}</Button>
        </div>
        {labelledCheckbox({
          label: t('autoBackup'),
          checked: autoBackup,
          className: css.backupCheck,
          onChange: setAutoBackup,
        })}
        <p>{t('webdavNote')}</p>
        {webdavNeedsPassword && <p>{t('webdavAutoBackupPaused')}</p>}
        <p className={css.backupWarn}>{t('credsWarning')}</p>
      </section>
      <section className={css.backupCard}>
        <h3>{t('gist')}</h3>
        <Input
          className={css.backupInput}
          type="password"
          autoComplete="off"
          value={gistToken}
          placeholder={t('gistToken')}
          onChange={e => setGistToken(e.target.value)}
        />
        <Input
          className={css.backupInput}
          icon={<IconLinkOutline14 size={14} />}
          value={gistId}
          placeholder={t('gistId')}
          onChange={e => setGistId(e.target.value)}
        />
        <div className={css.backupActions}>
          <label className={css.backupCheck}>
            <input type="radio" name="gist-mode" checked={gistMode === 'update'} onChange={() => setGistMode('update')} />
            {t('gistModeUpdate')}
          </label>
          <label className={css.backupCheck}>
            <input type="radio" name="gist-mode" checked={gistMode === 'create'} onChange={() => setGistMode('create')} />
            {t('gistModeCreate')}
          </label>
        </div>
        <div className={css.backupActions}>
          <Button variant="outline" size="sm" disabled={gistBusy} onClick={() => runGist('verify')}>{gistBusy ? t('backupWorking') : t('gistVerify')}</Button>
          <Button variant="primary" size="sm" disabled={gistBusy || (gistMode === 'update' && gistId.trim() === '')} onClick={openExportPicker}>{gistBusy ? t('backupWorking') : t('gistExport')}</Button>
          <Button variant="outline" size="sm" disabled={gistBusy || gistId.trim() === ''} onClick={() => runGist('import')}>{t('gistImport')}</Button>
        </div>
        {gistResult !== null && (
          <p className={css.backupCheck}>
            <span>{t('gistCreated')}</span>{' '}
            <a className={css.src} href={gistResult.gistUrl} target="_blank" rel="noreferrer">{gistResult.gistUrl}</a>
          </p>
        )}
        {gistMessage !== null && (
          <div className={gistOk ? css.backupMessage : css.backupWarn}>{gistMessage}</div>
        )}
        <p>{t('gistNote')}</p>
      </section>
    </div>
  )
}


type CatalogStatusCtx = Pick<MarketStateCtx, 'loadError' | 't'>
  & Pick<MarketSyncCtx, 'loadCatalog'>

function CatalogStatus({ c }: { c: CatalogStatusCtx }) {
  const { loadError, loadCatalog, t } = c
  if (loadError === null) {
    return <div className={css.loading}><span className={css.logoMark}><MarketLogo size={26} animated /></span>{t('loading')}</div>
  }
  return (
    <div className={css.empty}>
      <div>{t('catalogFailSummary')}</div>
      <details className={css.catalogFailDetail}>
        <summary>{t('loadFail')}</summary>
        <div className={css.err}>{loadError}</div>
      </details>
      <Button variant="outline" size="sm" className={css.retryBtn} onClick={() => { void loadCatalog() }}>
        {t('loadRetry')}
      </Button>
    </div>
  )
}

type DiscoverTabCtx = { props: MarketSectionProps } & CatalogStatusCtx
  & Pick<MarketStateCtx,
    'bodyRef' | 'cat' | 'catsWrapRef' | 'compatibleWithHost' | 'data' |
    'discoverSearchReset' | 'hostVersion' | 'lang' | 'q' | 'resetDiscoverSearch' |
    'setCat' | 'setCatsSentinel' | 'setCompatibleWithHost' | 'setQ' | 'setSortDir' |
    'setSortField' | 'setTimeRange' | 'sortDir' | 'sortField' | 'surface' |
    'timeRange' | 'visibleCats'>
  & Pick<MarketInstallCtx,
    'basePage' | 'changePageSize' | 'currentPage' | 'discoverMore' | 'goToPage' | 'hasRecent' |
    'hasRecommend' | 'hideHighlights' | 'highlightsHidden' | 'highlightsOpen' | 'hostHiddenCount' |
    'hostUnavailableCount' | 'loadedHostPackages' | 'pageHostPackages' | 'pagePlugins' | 'pageSize' |
    'pluginsAll' | 'pluginsUnblocked' | 'recentPlugins' | 'recommendPlugins' | 'showHighlights' |
    'toggleHighlights' | 'totalPages'>
  & Pick<MarketRenderCtx, 'categories' | 'discoverCard' | 'recentTile'>

export function DiscoverTab({ c }: { c: DiscoverTabCtx }) {
  const {
    basePage, bodyRef, cat, categories, catsWrapRef, changePageSize,
    compatibleWithHost, currentPage, data, discoverCard, discoverMore, discoverSearchReset, goToPage, hasRecent,
    hasRecommend, hideHighlights, highlightsHidden, highlightsOpen, hostHiddenCount, hostUnavailableCount, hostVersion, lang, loadError,
    loadedHostPackages, pageHostPackages, pagePlugins, pageSize, pluginsAll,
    pluginsUnblocked, q, recentPlugins, recentTile, recommendPlugins,
    resetDiscoverSearch, setCat, setCatsSentinel, setCompatibleWithHost, setQ,
    setSortDir, setSortField, setTimeRange, showHighlights, sortDir, sortField,
    surface, t, timeRange, toggleHighlights, totalPages, visibleCats,
  } = c
  const [filtersOpen, setFiltersOpen] = useState(false)
  const aiSearch = useAiSearch(t)
  // AI picks resolved to the catalog's own entries (by repository URL: names
  // are not unique), in the model's order, drawn exactly like ordinary results.
  const aiPlugins = useMemo(() => {
    if (aiSearch.picks === null || data === null) return null
    const byUrl = new Map(data.plugins.map(plugin => [plugin.url, plugin]))
    return aiSearch.picks.flatMap(pick => {
      const plugin = byUrl.get(pick.url)
      return plugin === undefined ? [] : [plugin]
    })
  }, [aiSearch.picks, data])
  return (
    loadError !== null || data === null
      ? <CatalogStatus c={c} />
      : (
              <div className={css.discoverLayout}>
              <CategoryRail mode="rail" data={data} categories={categories} cat={cat} lang={lang} onSelect={setCat} t={t} />
              <div className={css.discoverMain}>
              <div className={css.stickyHead}>
              <div className={css.tabSearchRow}>
                <SearchInput key="discover" resetToken={discoverSearchReset} className={css.tabSearch} placeholder={t('searchPh')} value={q} onCommit={setQ} t={t} ai={aiSearch.mode} />
                <div className={filtersOpen ? `${css.discoverFilters} ${css.discoverFiltersOpen}` : css.discoverFilters}>
                <FilterMenu
                  sortField={sortField}
                  sortDir={sortDir}
                  timeRange={timeRange}
                  hostVersion={hostVersion}
                  compatibleWithHost={compatibleWithHost}
                  onSortField={setSortField}
                  onSortDir={setSortDir}
                  onTimeRange={setTimeRange}
                  onCompatibleWithHost={setCompatibleWithHost}
                  t={t}
                />
                </div>
                <Button variant="ghost" size="sm" className={css.discoverFilterToggle} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(open => !open)}>{t('filtersButton')}</Button>
              </div>
              <CategoryRail mode="chips" data={data} categories={categories} cat={cat} lang={lang} onSelect={setCat} t={t} />
              <ActiveFilters
                query={q}
                category={cat}
                categoryLabelText={cat === 'all' ? t('all') : categoryLabel(data.categories, cat, lang)}
                timeRange={timeRange}
                timeLabel={timeRange === 'week' ? t('timeWeek') : timeRange === 'month' ? t('timeMonth') : timeRange === 'year' ? t('timeYear') : t('timeAll')}
                sortField={sortField}
                sortDir={sortDir}
                sortLabel={sortField === 'stars' ? t('sortStars') : sortField === 'added' ? t('sortAdded') : t('sortDownloads')}
                compatible={compatibleWithHost}
                onClearQuery={() => { setQ(''); resetDiscoverSearch(value => value + 1) }}
                onClearCategory={() => setCat('all')}
                onClearTime={() => setTimeRange('all')}
                onClearSort={() => { setSortField('downloads'); setSortDir('desc') }}
                onClearCompat={() => setCompatibleWithHost(false)}
                onClearAll={() => {
                  setQ(''); resetDiscoverSearch(value => value + 1)
                  setCat('all'); setTimeRange('all'); setSortField('downloads'); setSortDir('desc'); setCompatibleWithHost(false)
                }}
                t={t}
              />
                {compatibleWithHost && typeof hostVersion === 'string' && pageHostPackages.length > 0
                  && loadedHostPackages >= pageHostPackages.length && (hostHiddenCount > 0 || hostUnavailableCount > 0) && (
                  <HostFilterNote
                    t={t}
                    text={t(hostUnavailableCount > 0 ? 'hostFilterIncomplete' : 'hostFilterActive')
                      .replace('{0}', hostVersion)
                      .replace('{1}', String(hostHiddenCount))
                      .replace('{2}', String(hostUnavailableCount))}
                  />
                )}
              </div>
              {aiSearch.status}
              {aiPlugins === null && (
                <div className={css.catalogHead}>
                  <h2 className={css.catalogHeading}>{t('catalogHeading')}</h2>
                  {discoverHomeView({ query: q, category: cat, timeRange, sortField, sortDir }) && (
                    highlightsHidden
                      ? (
                          <button type="button" className={css.recentShow} onClick={showHighlights}>
                            <IconChevronRightOutline14 size={14} />{t('highlightsShow')}
                          </button>
                        )
                      : (
                          <button
                            type="button"
                            className={css.highlightsToggle}
                            aria-expanded={highlightsOpen}
                            aria-controls="taichi-dshm-highlights"
                            onClick={toggleHighlights}
                          >
                            {highlightsOpen ? <IconChevronDownOutline14 size={14} /> : <IconChevronRightOutline14 size={14} />}
                            {highlightsOpen ? t('highlightsClose') : t('highlightsOpen')}
                          </button>
                        )
                  )}
                </div>
              )}
              {aiPlugins === null && highlightsOpen && !highlightsHidden
                && discoverHomeView({ query: q, category: cat, timeRange, sortField, sortDir }) && (
                <div id="taichi-dshm-highlights" className={css.highlightsPanel}>
                  {hasRecommend && (
                    <DiscoverStrip
                      titleId="taichi-dshm-recommend-install"
                      gridId="taichi-dshm-recommend-grid"
                      title={t('recommendInstall')}
                      help={t('recommendInstallHelp')}
                      plugins={recommendPlugins}
                      tile={plugin => recentTile(plugin, { meta: 'downloads' })}
                      t={t}
                    />
                  )}
                  {hasRecent && (
                    <DiscoverStrip
                      titleId="taichi-dshm-recently-added"
                      gridId="taichi-dshm-recent-grid"
                      title={t('recentlyAdded')}
                      plugins={recentPlugins}
                      tile={plugin => recentTile(plugin)}
                      t={t}
                    />
                  )}
                  <AiRecommend
                    t={t}
                    lang={lang}
                    plugins={data.plugins}
                    renderTile={(plugin, why) => recentTile(plugin, { meta: 'none', blurb: why })}
                  />
                  <div className={css.highlightsHideRow}>
                    <Button variant="ghost" size="sm" className={css.recentHide} onClick={hideHighlights}>{t('highlightsHide')}</Button>
                  </div>
                </div>
              )}
              {aiPlugins !== null
                ? (aiPlugins.length === 0
                    ? <EmptyResults message="aiSearchEmpty" t={t} onClear={() => aiSearch.clear()} />
                    : <CatalogGrid items={aiPlugins} render={plugin => discoverCard(plugin)} />)
                : pagePlugins.length === 0
                ? <EmptyResults message={basePage.length > 0 ? 'hostFilterEmpty' : pluginsAll.length > 0 ? 'blockedFilteredEmpty' : 'empty'} t={t}
                    onClear={data.plugins.length > 0 && (q !== '' || cat !== 'all' || timeRange !== 'all' || compatibleWithHost) ? () => {
                      setQ(''); resetDiscoverSearch(value => value + 1)
                      setCat('all'); setTimeRange('all'); setCompatibleWithHost(false)
                      bodyRef.current?.querySelector('input')?.focus()
                    } : undefined}
                  />
                : <CatalogGrid items={pagePlugins} render={plugin => discoverCard(plugin)} />}
              {aiPlugins === null && pluginsUnblocked.length > 0 && (surface === 'plugins'
                ? discoverMore.atCap
                  ? <Button variant="ghost" size="sm" onClick={() => { bodyRef.current?.scrollTo({ top: 0 }) }}>{t('backToTop')}</Button>
                  : <LoadMore more={discoverMore.more} onLoad={discoverMore.loadMore} t={t} />
                : <Pager currentPage={currentPage} totalPages={totalPages} pageSize={pageSize}
                    onGoToPage={goToPage} onChangePageSize={changePageSize} t={t} />)}
              </div>
              </div>
          )
  )
}


type FavoritesTabCtx = { props: MarketSectionProps } & CatalogStatusCtx
  & Pick<MarketStateCtx,
    'data' | 'favSortDir' | 'favSortField' | 'favTimeRange' | 'favoriteUrls' | 'qFavorites' |
    'setFavSortDir' | 'setFavSortField' | 'setFavTimeRange' | 'setQFavorites' | 'surface'>
  & Pick<MarketInstallCtx,
    'favoriteListed' | 'favoritePagePlugins' | 'favoritePageThemes' | 'favoritePluginMore' |
    'favoritePluginPagination' | 'favoritePlugins' | 'favoriteStale' | 'favoriteThemeMore' |
    'favoriteThemePagination' | 'favoriteThemes' | 'favoritesAllStale'>
  & Pick<MarketRenderCtx, 'pluginCard' | 'renderStaleFavorites' | 'themePluginCard'>

export function FavoritesTab({ c }: { c: FavoritesTabCtx }) {
  const {
    data, favSortDir, favSortField, favTimeRange, favoriteListed, favoritePagePlugins,
    favoritePageThemes, favoritePluginMore, favoritePluginPagination, favoritePlugins, favoriteStale,
    favoriteThemeMore, favoriteThemePagination, favoriteThemes, favoriteUrls, favoritesAllStale,
    pluginCard, qFavorites, renderStaleFavorites, setFavSortDir, setFavSortField, setFavTimeRange,
    setQFavorites, surface, t, themePluginCard,
  } = c
  return (
    data === null
      ? <CatalogStatus c={c} />
      : favoriteUrls.length === 0
        ? <div className={css.empty}>{t('favoritesEmpty')}</div>
        : (
            <>
              <div className={css.themeToolbar}>
                <SearchInput
                  key="favorites"
                  className={css.themeSearch}
                  placeholder={t('searchFavoritesPh')}
                  value={qFavorites}
                  onCommit={setQFavorites}
                  t={t}
                />
                <div className={css.themeToolbarActions}>
                  <FilterMenu
                    sortField={favSortField}
                    sortDir={favSortDir}
                    timeRange={favTimeRange}
                    onSortField={setFavSortField}
                    onSortDir={setFavSortDir}
                    onTimeRange={setFavTimeRange}
                    t={t}
                  />
                </div>
              </div>
              {favoriteListed.length === 0
                ? favoritesAllStale
                  ? (
                      <div className={css.favoritesStaleOnly}>
                        <div className={css.empty}>{t('favoritesStaleEmpty')}</div>
                        {renderStaleFavorites()}
                      </div>
                    )
                  : <div className={css.empty}>{t('empty')}</div>
                : (
                    <>
                      {favoriteStale.length > 0 && (
                        renderStaleFavorites()
                      )}
                      <div className={css.themeResultBar}>
                        <span>{t('favoritesResultCount').replace('{0}', String(favoriteListed.length))}</span>
                      </div>
                      {favoritePlugins.length > 0 && (
                        <>
                          <h3 className={css.favoritesSectionHead}>
                            {t('favoritesPluginsSection').replace('{0}', String(favoritePlugins.length))}
                          </h3>
                          <Masonry items={favoritePagePlugins} render={plugin => pluginCard(plugin)} />
                          {surface === 'plugins'
                            ? <LoadMore more={favoritePluginMore.more} onLoad={favoritePluginMore.loadMore} t={t} />
                            : (
                                <Pager
                                  currentPage={favoritePluginPagination.currentPage}
                                  totalPages={favoritePluginPagination.totalPages}
                                  pageSize={favoritePluginPagination.pageSize}
                                  onGoToPage={favoritePluginPagination.goToPage}
                                  onChangePageSize={favoritePluginPagination.changePageSize}
                                  t={t}
                                />
                              )}
                        </>
                      )}
                      {favoriteThemes.length > 0 && (
                        <>
                          <h3 className={css.favoritesSectionHead}>
                            {t('favoritesThemesSection').replace('{0}', String(favoriteThemes.length))}
                          </h3>
                          <div className={css.themeGallery}>
                            {favoritePageThemes.map(themePluginCard)}
                          </div>
                          {surface === 'plugins'
                            ? <LoadMore more={favoriteThemeMore.more} onLoad={favoriteThemeMore.loadMore} t={t} />
                            : (
                                <Pager
                                  currentPage={favoriteThemePagination.currentPage}
                                  totalPages={favoriteThemePagination.totalPages}
                                  pageSize={favoriteThemePagination.pageSize}
                                  onGoToPage={favoriteThemePagination.goToPage}
                                  onChangePageSize={favoriteThemePagination.changePageSize}
                                  t={t}
                                />
                              )}
                        </>
                      )}
                    </>
                  )}
            </>
          )
  )
}


type ThemesTabCtx = { props: MarketSectionProps } & CatalogStatusCtx
  & Pick<MarketStateCtx,
    'bodyRef' | 'data' | 'qThemes' | 'resetThemeSearch' | 'setQThemes' | 'setThemeSortDir' |
    'setThemeSortField' | 'setThemeTimeRange' | 'setThemesFullscreen' | 'surface' |
    'themeSearchReset' | 'themeSnap' | 'themeSortDir' | 'themeSortField' | 'themeTimeRange' |
    'themesFullscreen'>
  & Pick<MarketInstallCtx,
    'themeMore' | 'themePagePlugins' | 'themePagination' | 'themePlugins' | 'themePluginsAll'>
  & Pick<MarketRenderCtx, 'anyThemePlugins' | 'themeCard' | 'themePluginCard'>

export function ThemesTab({ c }: { c: ThemesTabCtx }) {
  const {
    anyThemePlugins, bodyRef, data, qThemes, resetThemeSearch, setQThemes, setThemeSortDir,
    setThemeSortField, setThemeTimeRange, setThemesFullscreen, surface, t, themeCard, themeMore,
    themePagePlugins, themePagination, themePluginCard, themePlugins, themePluginsAll,
    themeSearchReset, themeSnap, themeSortDir, themeSortField, themeTimeRange, themesFullscreen,
  } = c
  return (
    <>
      <div className={css.themeToolbar}>
        <SearchInput key="themes" resetToken={themeSearchReset} className={css.themeSearch} placeholder={t('searchPh')} value={qThemes} onCommit={setQThemes} t={t} />
        <div className={css.themeToolbarActions}>
          <FilterMenu
            sortField={themeSortField}
            sortDir={themeSortDir}
            timeRange={themeTimeRange}
            onSortField={setThemeSortField}
            onSortDir={setThemeSortDir}
            onTimeRange={setThemeTimeRange}
            t={t}
          />
          <Tooltip label={themesFullscreen ? t('themeExitFullscreen') : t('themeFullscreen')} side="top">
            <Button
              variant="outline"
              size="sm"
              className={css.themeFullscreenBtn}
              icon={<IconFullscreenOutline16 size={16} />}
              aria-label={themesFullscreen ? t('themeExitFullscreen') : t('themeFullscreen')}
              aria-pressed={themesFullscreen}
              onClick={() => setThemesFullscreen(value => !value)}
            />
          </Tooltip>
        </div>
      </div>
      {/* Light/dark/system live in the official Appearance setting; this
        tab only shows what that setting can't: registered third-party
        palettes (none in the wild yet) and installable theme plugins. */}
      {(() => {
        const extra = themeSnap!.themes.filter(def => def.id !== 'light' && def.id !== 'dark')
        return extra.length > 0 && (
          <div className={`${css.grid} ${css.themesGrid}`}>
            {extra.map(def => themeCard(def.id, def.id, themeSwatch(def)))}
          </div>
        )
      })()}
      {data === null
        ? <CatalogStatus c={c} />
        : anyThemePlugins.length === 0
          ? <div className={css.empty}>{t('themeEmpty')}</div>
          : themePlugins.length === 0
            ? <EmptyResults message={themePluginsAll.length > 0 ? 'blockedFilteredEmpty' : 'empty'} t={t}
                onClear={qThemes !== '' || themeTimeRange !== 'all' ? () => {
                  setQThemes(''); resetThemeSearch(value => value + 1)
                  setThemeTimeRange('all')
                  bodyRef.current?.querySelector('input')?.focus()
                } : undefined}
              />
            : (
                <>
                  <div className={css.themeResultBar}>
                    <span>{t('themeResultCount').replace('{0}', String(themePlugins.length))}</span>
                  </div>
                  <div className={css.themeGallery}>
                    {themePagePlugins.map(themePluginCard)}
                  </div>
                  {surface === 'plugins'
                    ? <LoadMore more={themeMore.more} onLoad={themeMore.loadMore} t={t} />
                    : (
                        <Pager
                          currentPage={themePagination.currentPage}
                          totalPages={themePagination.totalPages}
                          pageSize={themePagination.pageSize}
                          onGoToPage={themePagination.goToPage}
                          onChangePageSize={themePagination.changePageSize}
                          t={t}
                        />
                      )}
                </>
              )}
    </>
  )
}


type BlockedTabCtx = { props: MarketSectionProps } & CatalogStatusCtx
  & Pick<MarketStateCtx, 'blockedNames' | 'data'>
  & Pick<MarketInstallCtx, 'blockedMissing' | 'blockedPlugins'>
  & Pick<MarketOperationsCtx, 'toggleBlock'>
  & Pick<MarketRenderCtx, 'pluginCard'>

export function BlockedTab({ c }: { c: BlockedTabCtx }) {
  const { blockedMissing, blockedNames, blockedPlugins, data, pluginCard, t, toggleBlock } = c
  return (
    data === null
      ? <CatalogStatus c={c} />
      : blockedNames.length === 0
        ? <div className={css.empty}>{t('blockedEmpty')}</div>
        : (
            <>
              <div className={css.blockedTabHint}>{t('blockedTabHint')}</div>
              {blockedPlugins.length > 0 && <Masonry items={blockedPlugins} render={plugin => pluginCard(plugin)} />}
              {blockedMissing.length > 0 && (
                <div className={css.blockedMissing}>
                  {blockedMissing.map(name => (
                    <div key={name} className={css.blockedBarRow}>
                      <span className={css.blockedBarName} title={name}>{name}</span>
                      <button type="button" className={css.blockedBarUndo} onClick={() => toggleBlock(name)}>{t('blockRemove')}</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )
  )
}
