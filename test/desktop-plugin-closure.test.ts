import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { hostPluginPackageName } from '../src/main/profile/host-plugin-sources'
import { buildDesktopProductPatch } from '../src/main/shell/product-patch'
import { patchPath, projectRoot } from './patch-path'

const profileConfigTags = [
  {
    tag: 'tag:yaml.org,2002:js',
    resolve: (value: string) => value
  }
]

type ProfilePatchRow = { name?: string; insert?: { name?: string }[] }

async function readPackagedProfilePatch(): Promise<ProfilePatchRow[]> {
  return parseYaml(
    await readFile(path.join(projectRoot, 'build', 'dsh-desktop.patch.yml'), 'utf8'),
    { customTags: profileConfigTags }
  ) as ProfilePatchRow[]
}

function insertedNames(rows: ProfilePatchRow[]): string[] {
  return rows
    .flatMap((row) => row.insert ?? [])
    .map((entry) => entry.name)
    .filter((name): name is string => typeof name === 'string')
}

/**
 * Every desktop plugin the composed profile mounts has to be reachable from
 * the profile directory, and the profile does not resolve through the app's
 * own node_modules.
 *
 * Harness mirrors the dependency closure of `@deepseek-ai/dsh` into
 * `$DSH_HOME/profiles/node_modules`, anchored at that package's manifest — not
 * at ours. A desktop plugin therefore reaches the profile only by being
 * injected into that manifest's dependencies, which is what the `dsh` patch
 * does. Adding a row to the profile patch without that injection boots to
 * `Cannot find package ... imported from .../profiles/web/`, which fails the
 * whole plugin tree rather than just that row.
 *
 * Cover both the packaged overlay and the shell-written product patch: the
 * latter is what ordinary Desktop boot mounts today.
 */
describe('desktop plugin closure', () => {
  it('injects every profile-mounted package into the dsh dependency closure', async () => {
    const packaged = insertedNames(await readPackagedProfilePatch())
    const product = insertedNames(
      parseYaml(buildDesktopProductPatch(), { customTags: profileConfigTags }) as ProfilePatchRow[]
    )
    const mounted = [...new Set([...packaged, ...product])]

    expect(mounted.length).toBeGreaterThan(0)
    expect(mounted).toContain('dsh-taichi-web')

    const dshPatch = await readFile(patchPath('@deepseek-ai/dsh'), 'utf8')
    for (const specifier of mounted) {
      const name = hostPluginPackageName(specifier)
      expect(dshPatch).toContain(`+    "${name}":`)
    }
  })

  it('declares every profile-mounted package as a local production dependency', async () => {
    const packaged = insertedNames(await readPackagedProfilePatch())
    const product = insertedNames(
      parseYaml(buildDesktopProductPatch(), { customTags: profileConfigTags }) as ProfilePatchRow[]
    )
    const mounted = [...new Set([...packaged, ...product])]

    const manifest = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    ) as { dependencies: Record<string, string> }

    for (const specifier of mounted) {
      expect(manifest.dependencies[hostPluginPackageName(specifier)]).toMatch(/^file:packages\//u)
    }
  })
})
