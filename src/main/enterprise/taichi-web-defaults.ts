import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isMap, isSeq, parseDocument, type Document } from 'yaml'
import {
  TAICHI_FETCH_PROVIDER_ID,
  TAICHI_SEARCH_PROVIDER_ID,
  TAICHI_WEB_DEFAULTS_FILE,
  type TaichiWebCapabilityMark,
  type TaichiWebDefaultsMark,
} from '../../shared/taichi-web'

interface YamlMap {
  get(key: string, keepNode?: boolean): unknown
  set(key: string, value: unknown): void
  delete(key: string): void
}

type Capability = 'search' | 'fetch'

const CAPABILITIES: readonly Capability[] = ['search', 'fetch']

const PROVIDER_ID: Record<Capability, string> = {
  search: TAICHI_SEARCH_PROVIDER_ID,
  fetch: TAICHI_FETCH_PROVIDER_ID,
}

const FIELD: Record<Capability, 'searchProvider' | 'fetchProvider'> = {
  search: 'searchProvider',
  fetch: 'fetchProvider',
}

const ENV_KEY: Record<Capability, string> = {
  search: 'DSH_WEB_SEARCH_PROVIDER',
  fetch: 'DSH_WEB_FETCH_PROVIDER',
}

function asMap(value: unknown): YamlMap | undefined {
  return isMap(value) ? value as unknown as YamlMap : undefined
}

function mapChild(document: Document, parent: YamlMap, key: string): YamlMap {
  const current = asMap(parent.get(key, true))
  if (current) return current
  parent.set(key, document.createNode({}))
  const stored = asMap(parent.get(key, true))
  if (!stored) throw new Error(`could not store ${key}`)
  return stored
}

function emptyMark(): TaichiWebDefaultsMark {
  return { search: 'unset', fetch: 'unset' }
}

function isMark(value: unknown): value is TaichiWebCapabilityMark {
  return value === 'unset' || value === 'desktop' || value === 'user'
}

async function readMark(profileDir: string): Promise<TaichiWebDefaultsMark> {
  try {
    const raw = JSON.parse(await readFile(join(profileDir, TAICHI_WEB_DEFAULTS_FILE), 'utf8')) as unknown
    if (!raw || typeof raw !== 'object') return emptyMark()
    const record = raw as Record<string, unknown>
    return {
      search: isMark(record.search) ? record.search : 'unset',
      fetch: isMark(record.fetch) ? record.fetch : 'unset',
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyMark()
    console.error('[account] could not read taichi web defaults mark', error instanceof Error ? error.name : 'error')
    return emptyMark()
  }
}

async function writeMark(profileDir: string, mark: TaichiWebDefaultsMark): Promise<void> {
  await writeAtomic(join(profileDir, TAICHI_WEB_DEFAULTS_FILE), `${JSON.stringify(mark)}\n`)
}

async function readPatch(profileDir: string): Promise<string> {
  try {
    return await readFile(join(profileDir, 'cordis.patch.yml'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '[]\n'
    throw error
  }
}

function findWebRow(document: Document): YamlMap | undefined {
  if (!isSeq(document.contents)) return undefined
  return document.contents.items.map(asMap).find(item => (
    item?.get('id') === 'web' || item?.get('name') === '@deepseek-ai/dsh-web'
  ))
}

function ensureWebRow(document: Document): YamlMap | undefined {
  if (!isSeq(document.contents)) return undefined
  let row = findWebRow(document)
  if (row) return row
  const created = document.createNode({
    id: 'web',
    config: {},
  })
  ;(document.contents.items as unknown[]).push(created)
  return asMap(created)
}

/** Profile user-layer value for one web provider field; undefined when absent. */
function readProviderField(text: string, capability: Capability): string | undefined {
  const document = parseDocument(text.length > 0 ? text : '[]\n')
  if (document.errors.length > 0 || !isSeq(document.contents)) return undefined
  const row = findWebRow(document)
  if (!row) return undefined
  const config = asMap(row.get('config', true))
  if (!config) return undefined
  const value = config.get(FIELD[capability])
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function setProviderField(text: string, capability: Capability, providerId: string): string | undefined {
  const document = parseDocument(text.length > 0 ? text : '[]\n')
  if (document.errors.length > 0 || !isSeq(document.contents)) return undefined
  const row = ensureWebRow(document)
  if (!row) return undefined
  const config = mapChild(document, row, 'config')
  config.set(FIELD[capability], providerId)
  const next = String(document)
  return next.endsWith('\n') ? next : `${next}\n`
}

function deleteProviderField(text: string, capability: Capability): string | undefined {
  const document = parseDocument(text.length > 0 ? text : '[]\n')
  if (document.errors.length > 0 || !isSeq(document.contents)) return undefined
  const row = findWebRow(document)
  if (!row) return text.endsWith('\n') ? text : `${text}\n`
  const config = asMap(row.get('config', true))
  if (!config) return text.endsWith('\n') ? text : `${text}\n`
  config.delete(FIELD[capability])
  const next = String(document)
  return next.endsWith('\n') ? next : `${next}\n`
}

function envPinned(env: NodeJS.ProcessEnv, capability: Capability): boolean {
  const value = env[ENV_KEY[capability]]
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * After sign-in, write taichi web providers into the profile when the desktop
 * still owns the default. Never overrides a user choice or env pin.
 */
export async function ensureTaichiWebDefaults(
  profileDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  let patch = await readPatch(profileDir)
  const probe = parseDocument(patch.length > 0 ? patch : '[]\n')
  if (probe.errors.length > 0 || !isSeq(probe.contents)) {
    console.error('[account] could not update taichi web defaults: invalid cordis.patch.yml')
    return
  }
  const mark = await readMark(profileDir)
  let changedPatch = false
  let changedMark = false

  for (const capability of CAPABILITIES) {
    if (envPinned(env, capability)) continue
    const current = readProviderField(patch, capability)
    const taichiId = PROVIDER_ID[capability]
    const state = mark[capability]

    if (state === 'user') continue

    if (state === 'desktop') {
      if (current === taichiId) continue
      mark[capability] = 'user'
      changedMark = true
      continue
    }

    // unset
    if (current !== undefined && current !== taichiId) {
      mark[capability] = 'user'
      changedMark = true
      continue
    }

    const next = setProviderField(patch, capability, taichiId)
    if (next === undefined) {
      console.error('[account] could not update taichi web defaults: invalid cordis.patch.yml')
      return
    }
    if (next !== patch) {
      patch = next
      changedPatch = true
    }
    mark[capability] = 'desktop'
    changedMark = true
  }

  if (changedPatch) await writeAtomic(join(profileDir, 'cordis.patch.yml'), patch)
  if (changedMark) await writeMark(profileDir, mark)
}

/**
 * After sign-out, remove desktop-managed taichi selections so the next sign-in
 * can re-apply defaults. Leaves explicit user choices alone.
 */
export async function clearTaichiWebDefaults(
  profileDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  let patch = await readPatch(profileDir)
  const probe = parseDocument(patch.length > 0 ? patch : '[]\n')
  if (probe.errors.length > 0 || !isSeq(probe.contents)) {
    console.error('[account] could not clear taichi web defaults: invalid cordis.patch.yml')
    return
  }
  const mark = await readMark(profileDir)
  let changedPatch = false
  let changedMark = false

  for (const capability of CAPABILITIES) {
    if (envPinned(env, capability)) continue
    const current = readProviderField(patch, capability)
    const taichiId = PROVIDER_ID[capability]

    if (current === taichiId) {
      const next = deleteProviderField(patch, capability)
      if (next === undefined) {
        console.error('[account] could not clear taichi web defaults: invalid cordis.patch.yml')
        return
      }
      if (next !== patch) {
        patch = next
        changedPatch = true
      }
      mark[capability] = 'unset'
      changedMark = true
      continue
    }

    if (mark[capability] !== 'user') {
      mark[capability] = current === undefined && mark[capability] === 'unset' ? 'unset' : 'user'
      if (mark[capability] === 'user') changedMark = true
    }
  }

  if (changedPatch) await writeAtomic(join(profileDir, 'cordis.patch.yml'), patch)
  if (changedMark) await writeMark(profileDir, mark)
}

async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, text, 'utf8')
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}
