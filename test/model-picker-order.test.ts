import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import { projectRoot } from './patch-path'

const modelSelectionClient = path.join(
  projectRoot,
  'node_modules',
  '@deepseek-ai',
  'dsh-client-ui-model-selection',
  'lib',
  'client.js'
)

interface ProviderGroup {
  id: string
  models: string[]
}

async function loadOrder(): Promise<(groups: readonly ProviderGroup[]) => ProviderGroup[]> {
  const client = await readFile(modelSelectionClient, 'utf8')
  const source = client.match(/function orderModelProviders\(groups\) \{[\s\S]*?\n\t\t\}/)?.[0]
  expect(source).toBeDefined()
  return Function(`${source}; return orderModelProviders`)() as (groups: readonly ProviderGroup[]) => ProviderGroup[]
}

it('pins taichi models above the DeepSeek account and official groups', async () => {
  const order = await loadOrder()
  const taichi = { id: 'taichi', models: ['later', 'earlier'] }
  const account = { id: 'deepseek-account', models: ['account-model'] }
  const official = { id: 'deepseek-official', models: ['official-model'] }
  const openai = { id: 'openai', models: ['gpt'] }
  const groq = { id: 'groq', models: ['fast'] }
  const ordered = order([openai, official, groq, account, taichi])

  expect(ordered.map(group => group.id)).toEqual([
    'taichi',
    'deepseek-account',
    'deepseek-official',
    'openai',
    'groq'
  ])
  expect(ordered[0]).toBe(taichi)
  expect(order([official, openai, account]).map(group => group.id)).toEqual([
    'deepseek-account',
    'deepseek-official',
    'openai'
  ])
})

it('uses the shared provider order in the composer and command pickers', async () => {
  const client = await readFile(modelSelectionClient, 'utf8')

  expect(client).toContain('orderModelProviders(state.groups)')
  expect(client).toContain('orderModelProviders(directory.groups)')
})
