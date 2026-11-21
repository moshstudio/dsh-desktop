import type { DesktopLocale } from '../shared/desktop-locale'
import { updateText } from '../shared/desktop-update-messages'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface PackageMetadata {
  version?: unknown
  dependencies?: Record<string, unknown>
}

function readPackageMetadata(path: string): PackageMetadata | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PackageMetadata
  } catch {
    return undefined
  }
}

function validVersion(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function bundledHarnessVersion(appPath: string): string | undefined {
  const installedMetadata = readPackageMetadata(
    join(appPath, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  )
  const installedVersion = validVersion(installedMetadata?.version)
  if (installedVersion) return installedVersion

  const appMetadata = readPackageMetadata(join(appPath, 'package.json'))
  return validVersion(appMetadata?.dependencies?.['@deepseek-ai/dsh'])
}

// Skin market accepts this shape as an injected official DSH version. A range,
// empty string, or prerelease like `rc.01` makes that probe return null and
// blocks install, so those values are not published.
const PUBLISHABLE_HARNESS_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function publishableHarnessVersion(version: string | undefined): string | undefined {
  if (version === undefined || !PUBLISHABLE_HARNESS_VERSION.test(version)) return undefined
  const core = version.split('+', 1)[0] ?? version
  const dash = core.indexOf('-')
  const prerelease = dash < 0 ? [] : core.slice(dash + 1).split('.')
  if (prerelease.some(part => /^0\d+$/.test(part))) return undefined
  return version
}

/** Publish the bundled Harness version and drop any inherited `DSH_VERSION`. */
export function withPublishedHarnessVersion(
  environment: NodeJS.ProcessEnv,
  appPath: string
): NodeJS.ProcessEnv {
  const published = publishableHarnessVersion(bundledHarnessVersion(appPath))
  const next: NodeJS.ProcessEnv = { ...environment }
  if (published === undefined) delete next.DSH_VERSION
  else next.DSH_VERSION = published
  return next
}

export function aboutDetail(
  desktopVersion: string,
  harnessVersion: string | undefined,
  locale: DesktopLocale
): string {
  const harness = harnessVersion ?? updateText(locale, 'unknown')
  return `${updateText(locale, 'desktopVersion', { version: desktopVersion })}\n${updateText(locale, 'harnessVersion', { version: harness })}\n\n${updateText(locale, 'harnessUpdated')}`
}
