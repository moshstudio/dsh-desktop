import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isMap, isSeq, parseDocument, type Document } from 'yaml'

interface YamlMap {
  get(key: string, keepNode?: boolean): unknown
  set(key: string, value: unknown): void
  delete(key: string): void
}

function asMap(value: unknown): YamlMap | undefined {
  return isMap(value) ? value as unknown as YamlMap : undefined
}
import { ACCOUNT_ACCESS_ENV, ACCOUNT_PLUGIN_NAME, ACCOUNT_PROVIDER_ID } from '../../shared/account-gateway'
import { readMarketState } from 'dsh-desktop-market-installer/plugin-state'
import type { GatewayModelProfile } from './gateway-client'

export interface TaichiProviderSpec {
  baseURL: string
  models: readonly GatewayModelProfile[]
}

export function stripDisabledAccountRows(text: string): { text: string; changed: boolean } {
  const document = parseDocument(text)
  if (document.errors.length > 0 || !isSeq(document.contents)) return { text, changed: false }
  const kept = document.contents.items.filter(item => {
    const row = asMap(item)
    if (!row) return true
    const id = row.get('id')
    const name = row.get('name')
    return row.get('disabled') !== true || (id !== ACCOUNT_PLUGIN_NAME && name !== ACCOUNT_PLUGIN_NAME)
  })
  if (kept.length === document.contents.items.length) return { text, changed: false }
  document.contents.items = kept
  return { text: String(document), changed: true }
}

export function ensureTaichiProvider(text: string, spec: TaichiProviderSpec): { text: string; changed: boolean } {
  const document = parseDocument(text.length > 0 ? text : '[]\n')
  if (document.errors.length > 0 || !isSeq(document.contents)) return { text, changed: false }
  const rows = document.contents.items
  let row = rows.map(asMap).find(item => item?.get('id') === 'llm-pi-ai' || item?.get('name') === '@deepseek-ai/dsh-llm-pi-ai')
  if (!row) {
    const created = document.createNode({
      id: 'llm-pi-ai',
      name: '@deepseek-ai/dsh-llm-pi-ai',
      config: { providers: {} }
    })
    ;(rows as unknown[]).push(created)
    row = asMap(created)
  }
  if (!row) return { text, changed: false }
  if (row.get('disabled') === true) row.delete('disabled')
  const config = mapChild(document, row, 'config')
  const providers = mapChild(document, config, 'providers')
  providers.set(ACCOUNT_PROVIDER_ID, {
    api: 'openai-completions',
    apiKeyEnv: ACCOUNT_ACCESS_ENV,
    baseURL: spec.baseURL,
    models: spec.models.map(model => ({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      ...(model.input ? { input: [...model.input] } : {}),
      ...(model.reasoningEfforts ? {
        reasoningEfforts: { ...model.reasoningEfforts },
        compat: { thinkingFormat: 'openrouter' }
      } : {})
    }))
  })
  const next = String(document)
  return { text: next.endsWith('\n') ? next : `${next}\n`, changed: next !== text }
}

function mapChild(document: Document, parent: YamlMap, key: string): YamlMap {
  const current = asMap(parent.get(key, true))
  if (current) return current
  parent.set(key, document.createNode({}))
  const stored = asMap(parent.get(key, true))
  if (!stored) throw new Error(`could not store ${key}`)
  return stored
}

export async function restoreBuiltinAccount(profileDir: string, spec?: TaichiProviderSpec): Promise<void> {
  const patchPath = join(profileDir, 'cordis.patch.yml')
  let original = '[]\n'
  try {
    original = await readFile(patchPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  let next = stripDisabledAccountRows(original).text
  if (spec) next = ensureTaichiProvider(next, spec).text
  if (next !== original) await writeAtomic(patchPath, next)
  await forgetMarketDisable(profileDir)
}

async function forgetMarketDisable(profileDir: string): Promise<void> {
  let state: { state: Record<string, unknown>; disabled: string[] }
  try {
    state = await readMarketState(profileDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    console.error(`[account] could not clear the built-in plugin disable: ${error instanceof Error ? error.name : 'error'}`)
    return
  }
  if (!state.disabled.includes(ACCOUNT_PLUGIN_NAME)) return
  const disabled = state.disabled.filter(name => name !== ACCOUNT_PLUGIN_NAME)
  await writeAtomic(join(profileDir, '.dsh-market', 'state.json'), JSON.stringify({ ...state.state, disabled }))
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
