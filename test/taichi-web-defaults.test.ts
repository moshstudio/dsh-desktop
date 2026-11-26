import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearTaichiWebDefaults,
  ensureTaichiWebDefaults,
} from '../src/main/enterprise/taichi-web-defaults'
import {
  TAICHI_FETCH_PROVIDER_ID,
  TAICHI_SEARCH_PROVIDER_ID,
  TAICHI_WEB_DEFAULTS_FILE,
} from '../src/shared/taichi-web'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function tempProfile(patch = '[]\n'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'taichi-web-'))
  directories.push(dir)
  await writeFile(join(dir, 'cordis.patch.yml'), patch, 'utf8')
  return dir
}

describe('taichi web defaults', () => {
  it('writes taichi providers when unset and profile has no selection', async () => {
    const dir = await tempProfile()
    await ensureTaichiWebDefaults(dir, {})
    const patch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain(`searchProvider: ${TAICHI_SEARCH_PROVIDER_ID}`)
    expect(patch).toContain(`fetchProvider: ${TAICHI_FETCH_PROVIDER_ID}`)
    const mark = JSON.parse(await readFile(join(dir, TAICHI_WEB_DEFAULTS_FILE), 'utf8'))
    expect(mark).toEqual({ search: 'desktop', fetch: 'desktop' })
  })

  it('marks user and keeps other provider when unset but profile already chose one', async () => {
    const dir = await tempProfile(`- id: web
  config:
    fetchProvider: http
`)
    await ensureTaichiWebDefaults(dir, {})
    const patch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('fetchProvider: http')
    expect(patch).not.toContain(TAICHI_FETCH_PROVIDER_ID)
    const mark = JSON.parse(await readFile(join(dir, TAICHI_WEB_DEFAULTS_FILE), 'utf8'))
    expect(mark.fetch).toBe('user')
  })

  it('does not overwrite after user mark', async () => {
    const dir = await tempProfile()
    await ensureTaichiWebDefaults(dir, {})
    await writeFile(join(dir, 'cordis.patch.yml'), `- id: web
  config:
    fetchProvider: http
`, 'utf8')
    await ensureTaichiWebDefaults(dir, {})
    await ensureTaichiWebDefaults(dir, {})
    const mark = JSON.parse(await readFile(join(dir, TAICHI_WEB_DEFAULTS_FILE), 'utf8'))
    expect(mark.fetch).toBe('user')
    const patch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('fetchProvider: http')
  })

  it('clears desktop-managed taichi fields on logout', async () => {
    const dir = await tempProfile()
    await ensureTaichiWebDefaults(dir, {})
    await clearTaichiWebDefaults(dir, {})
    const patch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(patch).not.toContain(TAICHI_SEARCH_PROVIDER_ID)
    expect(patch).not.toContain(TAICHI_FETCH_PROVIDER_ID)
    const mark = JSON.parse(await readFile(join(dir, TAICHI_WEB_DEFAULTS_FILE), 'utf8'))
    expect(mark).toEqual({ search: 'unset', fetch: 'unset' })
  })

  it('skips a capability when DSH_WEB_*_PROVIDER is set', async () => {
    const dir = await tempProfile()
    await ensureTaichiWebDefaults(dir, {
      DSH_WEB_SEARCH_PROVIDER: 'deepseek-search-api',
    })
    const patch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(patch).not.toContain(TAICHI_SEARCH_PROVIDER_ID)
    expect(patch).toContain(TAICHI_FETCH_PROVIDER_ID)
  })
})
