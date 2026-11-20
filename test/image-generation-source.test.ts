import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { describe, expect, it } from 'vitest'
import { writeDesktopProductPatch } from '../src/main/shell/product-patch'

const root = process.cwd()
const packageDir = join(root, 'packages', 'dsh-taichi-image-generation')
const sourceCommit = 'aeaf55951570e77d780e042b1ca464a22bc281bf'

function inserted(file: string): { id?: string; name?: string }[] {
  return loadOverlayPatches('test', file).flatMap((row) => row.insert ?? [])
}

describe('vendored image generation source', () => {
  it('keeps the desktop package name and the upstream snapshot', async () => {
    const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')) as {
      name: string
      version: string
      private: boolean
      description: string
      scripts?: { prepare?: string }
    }
    expect(manifest.name).toBe('dsh-taichi-image-generation')
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.private).toBe(true)
    expect(manifest.description).toContain('https://github.com/q253595422/dsh-imagegen-video')
    expect(manifest.description).toContain(sourceCommit)
    expect(manifest.scripts?.prepare).toBeUndefined()
    await expect(access(join(packageDir, 'pnpm-lock.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })
    const license = await readFile(join(packageDir, 'LICENSE'), 'utf8')
    expect(license).toContain('Apache License')
    const entry = await readFile(join(packageDir, 'index.js'), 'utf8')
    expect(entry).toContain("export { apply } from './lib/index.js'")
  })

  it('mounts every bundle component from the same package and leaves Safe Mode without them', async () => {
    const bundled = inserted(join(packageDir, 'cordis.patch.yml'))
    expect(bundled.map((row) => row.id)).toContain('taichi-imagegen')
    const desktop = inserted(join(root, 'build', 'dsh-desktop.patch.yml'))
    const safe = inserted(join(root, 'build', 'dsh-desktop-safe.patch.yml'))
    const home = await mkdtemp(join(tmpdir(), 'dsh-image-source-'))
    try {
      const shell = inserted(await writeDesktopProductPatch(home))
      const shellSafe = inserted(await writeDesktopProductPatch(home, 'safe'))
      for (const row of bundled) {
        expect(row.name === 'dsh-taichi-image-generation' || row.name?.startsWith('dsh-taichi-image-generation/')).toBe(true)
        expect(desktop.find((entry) => entry.id === row.id)?.name).toBe(row.name)
        expect(shell.find((entry) => entry.id === row.id)?.name).toBe(row.name)
        expect(safe.find((entry) => entry.id === row.id)).toBeUndefined()
        expect(shellSafe.find((entry) => entry.id === row.id)).toBeUndefined()
      }
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
