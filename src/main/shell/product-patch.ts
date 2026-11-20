import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function hasEnterprisePlugin(): boolean {
  try {
    require.resolve('dsh-desktop-enterprise/package.json')
    return true
  } catch {
    return false
  }
}

/**
 * Desktop profile overlay. Analytics and the official account page stay off.
 * The official sidebar brand is replaced by the product client UI.
 * The normal profile also mounts workbenches, the plugin market installer,
 * Office, PPT, and the vendored image/video studio. Safe Mode keeps the account and brand overlay only.
 */
const DESKTOP_PRODUCT_PATCH_BASE = `- id: desktop-product-telemetry
  disabled: true
- id: product-analytics
  disabled: true
- id: ui-settings-account
  disabled: true
- id: ui-brand-official
  disabled: true
- id: deepseek-account
  config:
    desktopPlatform: null
- insert:
    - id: dsh-desktop-client-ui
      name: dsh-desktop-client-ui
    - id: dsh-taichi-account
      name: dsh-taichi-account
`

const DESKTOP_ENTERPRISE_ROW = `    - id: dsh-desktop-enterprise
      name: dsh-desktop-enterprise
`

const DESKTOP_WORKBENCH_ROW = `    - id: dsh-desktop-workbenches
      name: dsh-desktop-workbenches
      config:
        root: !!js dshHomePath('desktop-workbenches')
`

const DESKTOP_MARKET_ROW = `    - id: dsh-desktop-market-installer
      name: dsh-desktop-market-installer
`

const DESKTOP_OFFICE_ROW = `    - id: dsh-desktop-office
      name: dsh-desktop-office
      config:
        resources: !!js process.env.DSH_DESKTOP_OFFICE_RESOURCES
        cli: !!js process.env.DSH_DESKTOP_OFFICE_CLI
`

// Keep the existing kimi-ppt directory so projects created by the previous shell still open.
const DESKTOP_PPT_ROW = `    - id: dsh-ppt-composer
      name: dsh-ppt-composer
      config:
        root: !!js dshHomePath('kimi-ppt')
`

// Keep these ids off the upstream `imagegen` / `imagegen-*` rows. A market
// switch selects every loader row whose id appears in the disabled package's
// patch, which otherwise turns this in-box studio off with the market copy.
const DESKTOP_IMAGE_ROW = `    - id: taichi-imagegen
      name: dsh-taichi-image-generation
    - id: taichi-imagegen-image
      name: dsh-taichi-image-generation/image
    - id: taichi-imagegen-video
      name: dsh-taichi-image-generation/video
    - id: taichi-imagegen-canvas
      name: dsh-taichi-image-generation/canvas
    - id: taichi-imagegen-gallery
      name: dsh-taichi-image-generation/gallery
    - id: taichi-imagegen-templates
      name: dsh-taichi-image-generation/templates
    - id: taichi-imagegen-skills
      name: dsh-taichi-image-generation/skills
    - id: taichi-imagegen-ppt
      name: dsh-taichi-image-generation/ppt
    - id: taichi-imagegen-ecommerce
      name: dsh-taichi-image-generation/ecommerce
    - id: taichi-imagegen-outfit
      name: dsh-taichi-image-generation/outfit
    - id: taichi-imagegen-prompt
      name: dsh-taichi-image-generation/prompt
    - id: taichi-imagegen-storage
      name: dsh-taichi-image-generation/storage
    - id: taichi-imagegen-diagnostics
      name: dsh-taichi-image-generation/diagnostics
`

export const DESKTOP_SAFE_PRODUCT_PATCH = DESKTOP_PRODUCT_PATCH_BASE

export function buildDesktopProductPatch(): string {
  const enterprise = hasEnterprisePlugin() ? DESKTOP_ENTERPRISE_ROW : ''
  return `${DESKTOP_PRODUCT_PATCH_BASE}${enterprise}${DESKTOP_WORKBENCH_ROW}${DESKTOP_MARKET_ROW}${DESKTOP_OFFICE_ROW}${DESKTOP_PPT_ROW}${DESKTOP_IMAGE_ROW}`
}

export const DESKTOP_PRODUCT_PATCH = buildDesktopProductPatch()

// Windows development only. The packaged overlay never includes this row.
const WINDOWS_DEV_HMR_DISABLE = `# @deepseek-ai/dsh-hmr waits forever for a watcher ready event on Windows.
- id: hmr
  disabled: true
`

export type DesktopProductPatchMode = 'desktop' | 'safe'

export async function writeDesktopProductPatch(
  dshHome: string,
  mode: DesktopProductPatchMode = 'desktop',
  options?: { skipBlockingHmr?: boolean }
): Promise<string> {
  await mkdir(dshHome, { recursive: true })
  const path = join(dshHome, 'desktop-product.patch.yml')
  const base = mode === 'safe' ? DESKTOP_SAFE_PRODUCT_PATCH : buildDesktopProductPatch()
  const text = options?.skipBlockingHmr === true ? `${base}${WINDOWS_DEV_HMR_DISABLE}` : base
  await writeFile(path, text)
  return path
}
