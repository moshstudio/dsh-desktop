import { readFile, rm, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'

/**
 * dsh-skin-market accepts an npm install only when the profile root
 * `pnpm-lock.yaml` importer resolves that dependency to the exact version.
 * Generation installs keep the real lock inside the generation, and pnpm is
 * not allowed to own the profile link. This copies the generation's already
 * resolved importer and integrity into the profile lock, and only when that
 * resolution is the same version the manifest shows.
 */

const LOCK_NAME = 'pnpm-lock.yaml'

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactResolvedVersion(resolved, packageName, version) {
  const bare = resolved.replace(/\(.*$/u, '')
  return bare === version || bare === `${packageName}@${version}` || bare === `npm:${packageName}@${version}`
}

function packageKeyMatches(key, packageName, version) {
  const bare = key.startsWith('/') ? key.slice(1) : key
  const prefix = `${packageName}@${version}`
  return bare === prefix || bare.startsWith(`${prefix}(`) || bare.startsWith(`${prefix}/`)
}

function ownedPackageKey(key, packageName) {
  const bare = key.startsWith('/') ? key.slice(1) : key
  return bare === packageName || bare.startsWith(`${packageName}@`)
}

function resolutionRecord(entry) {
  if (!isRecord(entry) || !isRecord(entry.resolution)) return undefined
  const resolution = {}
  if (typeof entry.resolution.integrity === 'string') resolution.integrity = entry.resolution.integrity
  if (typeof entry.resolution.tarball === 'string') resolution.tarball = entry.resolution.tarball
  return Object.keys(resolution).length > 0 ? resolution : undefined
}

function readGenerationImport(lock, packageName, version) {
  const dependency = lock?.importers?.['.']?.dependencies?.[packageName]
  if (!isRecord(dependency) || typeof dependency.version !== 'string') return undefined
  if (!exactResolvedVersion(dependency.version, packageName, version)) return undefined
  const packages = isRecord(lock.packages) ? lock.packages : {}
  let packageKey
  let resolution
  for (const [key, entry] of Object.entries(packages)) {
    if (!packageKeyMatches(key, packageName, version)) continue
    packageKey = key.startsWith('/') ? key.slice(1) : key
    resolution = resolutionRecord(entry)
    break
  }
  return {
    dependency: { specifier: version, version: dependency.version },
    ...(packageKey !== undefined && resolution !== undefined
      ? { packageKey, resolution }
      : {})
  }
}

function blankLock() {
  return {
    lockfileVersion: '9.0',
    importers: { '.': { dependencies: {} } },
    packages: {}
  }
}

async function readLock(profileDir) {
  try {
    const parsed = parse(await readFile(join(profileDir, LOCK_NAME), 'utf8'))
    if (!isRecord(parsed)) throw new Error('Profile pnpm-lock.yaml root is invalid.')
    return parsed
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

function ensureImporter(lock) {
  if (!isRecord(lock.importers)) lock.importers = {}
  if (!isRecord(lock.importers['.'])) lock.importers['.'] = {}
  if (!isRecord(lock.importers['.'].dependencies)) lock.importers['.'].dependencies = {}
  if (!isRecord(lock.packages)) lock.packages = {}
  return lock.importers['.'].dependencies
}

function deleteOwnedPackages(packages, packageName) {
  for (const key of Object.keys(packages)) {
    if (ownedPackageKey(key, packageName)) delete packages[key]
  }
}

function sortedRecord(record) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)))
}

function canonicalLock(lock) {
  const next = { ...lock }
  if (isRecord(next.importers?.['.']?.dependencies)) {
    next.importers = {
      ...next.importers,
      '.': {
        ...next.importers['.'],
        dependencies: sortedRecord(next.importers['.'].dependencies)
      }
    }
  }
  if (isRecord(next.packages)) next.packages = sortedRecord(next.packages)
  return next
}

function lockText(lock) {
  return stringify(canonicalLock(lock), { lineWidth: 0 })
}

async function writeLock(profileDir, lock) {
  const dependencies = lock.importers?.['.']?.dependencies
  const hasDependencies = isRecord(dependencies) && Object.keys(dependencies).length > 0
  const hasOtherImporters = isRecord(lock.importers) && Object.keys(lock.importers).some((key) => key !== '.')
  const hasPackages = isRecord(lock.packages) && Object.keys(lock.packages).length > 0
  const path = join(profileDir, LOCK_NAME)
  if (!hasDependencies && !hasOtherImporters && !hasPackages) {
    await rm(path, { force: true })
    return
  }
  if (!hasDependencies && isRecord(lock.importers?.['.'])) delete lock.importers['.'].dependencies
  const body = lockText(lock)
  let previous = ''
  try {
    previous = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (previous === body) return
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, body, 'utf8')
  await rename(temporary, path)
}

/**
 * Publish generation npm resolutions where the skin market reads them.
 * @param {string} profileDir
 * @param {Map<string, { directory: string, version: string }>} enabled
 * @param {readonly string[]} previousNames plugins the previous projection owned
 */
export async function syncProjectedMarketLock(profileDir, enabled, previousNames = []) {
  const lock = (await readLock(profileDir)) ?? blankLock()
  const dependencies = ensureImporter(lock)
  const retired = new Set(previousNames.filter((name) => !enabled.has(name)))
  for (const name of retired) {
    delete dependencies[name]
    deleteOwnedPackages(lock.packages, name)
  }
  for (const [name, generation] of enabled) {
    deleteOwnedPackages(lock.packages, name)
    delete dependencies[name]
    if (typeof generation?.version !== 'string' || typeof generation.directory !== 'string') continue
    let generationLock
    try {
      generationLock = parse(await readFile(join(generation.directory, LOCK_NAME), 'utf8'))
    } catch {
      continue
    }
    const imported = readGenerationImport(generationLock, name, generation.version)
    if (imported === undefined) continue
    dependencies[name] = imported.dependency
    if (imported.packageKey !== undefined) {
      lock.packages[imported.packageKey] = { resolution: imported.resolution }
    }
  }
  await writeLock(profileDir, lock)
}

/**
 * Remove projected importer entries for one pnpm run, then put them back.
 * pnpm must not adopt the generation links while it rewrites the profile lock.
 * @param {string} profileDir
 * @param {readonly string[]} names
 */
export async function holdProjectedMarketLock(profileDir, names) {
  if (names.length === 0) return async () => undefined
  const existing = await readLock(profileDir)
  if (existing === undefined) return async () => undefined
  const savedDependencies = {}
  const savedPackages = {}
  const dependencies = isRecord(existing.importers?.['.']?.dependencies)
    ? existing.importers['.'].dependencies
    : {}
  const packages = isRecord(existing.packages) ? existing.packages : {}
  let held = false
  for (const name of names) {
    if (Object.hasOwn(dependencies, name)) {
      savedDependencies[name] = dependencies[name]
      delete dependencies[name]
      held = true
    }
    for (const [key, entry] of Object.entries(packages)) {
      if (!ownedPackageKey(key, name)) continue
      savedPackages[key] = entry
      delete packages[key]
      held = true
    }
  }
  if (!held) return async () => undefined
  await writeLock(profileDir, existing)
  let restored = false
  return async () => {
    if (restored) return
    restored = true
    const current = (await readLock(profileDir)) ?? blankLock()
    const currentDependencies = ensureImporter(current)
    Object.assign(currentDependencies, savedDependencies)
    Object.assign(current.packages, savedPackages)
    await writeLock(profileDir, current)
  }
}
