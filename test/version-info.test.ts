import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { aboutDetail, bundledHarnessVersion, withPublishedHarnessVersion } from '../src/main/version-info'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })))
})

describe('desktop version information', () => {
  it('reports the version of the Harness package that is actually bundled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-version-info-'))
    temporaryRoots.push(root)
    const harnessRoot = join(root, 'node_modules', '@deepseek-ai', 'dsh')
    await mkdir(harnessRoot, { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({
      dependencies: { '@deepseek-ai/dsh': '0.1.0-rc.7' }
    }))
    await writeFile(join(harnessRoot, 'package.json'), JSON.stringify({
      version: '0.1.0-rc.8'
    }))

    expect(bundledHarnessVersion(root)).toBe('0.1.0-rc.8')
  })

  it('falls back to the app dependency when installed package metadata is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-version-info-'))
    temporaryRoots.push(root)
    await writeFile(join(root, 'package.json'), JSON.stringify({
      dependencies: { '@deepseek-ai/dsh': '0.1.0-rc.8' }
    }))

    expect(bundledHarnessVersion(root)).toBe('0.1.0-rc.8')
  })

  it('publishes the installed Harness version as DSH_VERSION and drops an inherited value', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-version-info-'))
    temporaryRoots.push(root)
    const harnessRoot = join(root, 'node_modules', '@deepseek-ai', 'dsh')
    await mkdir(harnessRoot, { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({
      dependencies: { '@deepseek-ai/dsh': '0.2.2-rc.0' }
    }))
    await writeFile(join(harnessRoot, 'package.json'), JSON.stringify({
      version: '0.2.2-rc.1'
    }))

    const published = withPublishedHarnessVersion({
      DSH_VERSION: '9.9.9',
      DSH_CLIENT_VERSION: '0.12.1'
    }, root)

    expect(published.DSH_VERSION).toBe('0.2.2-rc.1')
    expect(published.DSH_CLIENT_VERSION).toBe('0.12.1')
  })

  it('removes an inherited DSH_VERSION when the bundled Harness version has a padded prerelease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-version-info-'))
    temporaryRoots.push(root)
    const harnessRoot = join(root, 'node_modules', '@deepseek-ai', 'dsh')
    await mkdir(harnessRoot, { recursive: true })
    await writeFile(join(harnessRoot, 'package.json'), JSON.stringify({ version: '0.2.2-rc.01' }))

    expect(withPublishedHarnessVersion({ DSH_VERSION: '0.2.1-rc.1' }, root).DSH_VERSION).toBeUndefined()
  })

  it('removes an inherited DSH_VERSION when the bundled Harness version is not a publishable semver', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-version-info-'))
    temporaryRoots.push(root)
    await writeFile(join(root, 'package.json'), JSON.stringify({
      dependencies: { '@deepseek-ai/dsh': '^0.2.2-rc.1' }
    }))

    const published = withPublishedHarnessVersion({ DSH_VERSION: '0.2.1-rc.1' }, root)

    expect(published.DSH_VERSION).toBeUndefined()
  })

  it('explains that Harness updates arrive with Desktop', () => {
    expect(aboutDetail('0.1.1', '0.1.0-rc.8', 'zh')).toContain('内置 Harness 版本：0.1.0-rc.8')
    expect(aboutDetail('0.1.1', '0.1.0-rc.8', 'en')).toContain(
      'Harness is updated with taichi-dsh.'
    )
  })
})
