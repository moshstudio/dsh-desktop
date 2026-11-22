import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGenerationPackageBackend } from '../packages/dsh-desktop-market-installer/generations/package-backend.mjs'
import { readDesired } from '../packages/dsh-desktop-market-installer/generations/registry.mjs'

const root = new URL('..', import.meta.url)
const homes = []

async function freshHome() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'dsh-taichi-market-')))
  homes.push(home)
  const profile = join(home, 'profiles', 'desktop')
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-desktop',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } }
  }))
  return home
}

function installer(name, version) {
  return async staging => {
    const directory = join(staging, 'node_modules', name)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({
      name,
      version,
      dsh: { bundle: { patch: 'cordis.patch.yml' } }
    }))
    await writeFile(join(directory, 'cordis.patch.yml'), '[]\n')
    await writeFile(join(staging, 'package.json'), JSON.stringify({
      name: 'dsh-generation', private: true, version: '0.0.0', dependencies: { [name]: version }
    }))
    await writeFile(join(staging, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    return { code: 0, output: 'installed\n' }
  }
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

describe('taichi-dshmarket beside dshmarket', () => {
  it('keeps the built-in loader and settings ids off the community package', async () => {
    const patch = await readFile(new URL('packages/taichi-dshmarket/cordis.patch.yml', root), 'utf8')
    const client = await readFile(new URL('packages/taichi-dshmarket/src/client/index.ts', root), 'utf8')
    expect(patch).toContain('id: taichi-dshmarket')
    expect(patch).not.toContain('id: dsh-market')
    expect(patch).not.toContain('name: dshmarket')
    expect(client).not.toContain("name: 'settings.section'")
    expect(client).not.toContain("name: 'settings.section.icon'")
    expect(client).toContain("name = 'taichi-dshmarket'")
    expect(client).not.toMatch(/id: 'market'/)
  })

  it('still projects an installed dshmarket generation', async () => {
    const home = await freshHome()
    const runInstall = vi.fn(installer('dshmarket', '1.77.1'))
    const backend = createGenerationPackageBackend({
      dshHome: home,
      nodeExecutablePath: process.execPath,
      pnpmEntryPath: 'unused',
      profile: 'desktop',
      runInstall
    })
    const installed = await backend.install({
      spec: 'dshmarket@1.77.1',
      kind: 'registry',
      expectedName: 'dshmarket',
      signal: new AbortController().signal
    })
    expect(installed.packageResult.exitCode).toBe(0)
    expect(runInstall).toHaveBeenCalledOnce()
    const link = await lstat(join(home, 'profiles', 'desktop', 'node_modules', 'dshmarket'))
    expect(link.isSymbolicLink() || link.isDirectory()).toBe(true)
  })

  it('refuses to install taichi-dshmarket into the Profile', async () => {
    const home = await freshHome()
    const runInstall = vi.fn(installer('taichi-dshmarket', '1.77.1'))
    const backend = createGenerationPackageBackend({
      dshHome: home,
      nodeExecutablePath: process.execPath,
      pnpmEntryPath: 'unused',
      profile: 'desktop',
      runInstall
    })
    const refused = await backend.install({
      spec: 'taichi-dshmarket@1.77.1',
      kind: 'registry',
      expectedName: 'taichi-dshmarket',
      signal: new AbortController().signal
    })
    expect(refused.packageResult.exitCode).toBe(1)
    expect(refused.packageResult.output).toContain('cannot be installed into the Profile')
    expect(runInstall).not.toHaveBeenCalled()
    expect(await readDesired(home)).toEqual([])

    const discovered = await backend.install({
      spec: 'github:example/taichi-dshmarket#0123456789abcdef0123456789abcdef01234567',
      kind: 'git',
      signal: new AbortController().signal
    })
    expect(discovered.packageResult.exitCode).toBe(1)
    expect(discovered.packageResult.output).toContain('cannot be installed into the Profile')
    expect(await readDesired(home)).toEqual([])
  })
})
