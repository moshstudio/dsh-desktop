import { cp, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

const busyCodes = new Set(['EBUSY', 'EPERM', 'EACCES'])

/** Output directory selected by package.json and the electron-builder CLI. */
export function resolveConfiguredOutput(argv, projectDir, load) {
  let output = load('package.json')?.build?.directories?.output || 'dist'
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if ((arg === '--config' || arg === '-c') && argv[index + 1] && !argv[index + 1].startsWith('-')) {
      const loaded = load(argv[++index])
      if (loaded?.directories?.output) output = loaded.directories.output
    } else if (arg.startsWith('--config=')) {
      const loaded = load(arg.slice('--config='.length))
      if (loaded?.directories?.output) output = loaded.directories.output
    } else if (arg.startsWith('--config.directories.output=')) {
      output = arg.slice('--config.directories.output='.length)
    } else if (arg.startsWith('-c.directories.output=')) {
      output = arg.slice('-c.directories.output='.length)
    }
  }
  return resolve(projectDir, output)
}

/**
 * electron-builder extracts Electron into `<output>/win-unpacked.tmp` and then
 * unlinks `default_app.asar`. A workspace file watcher opens that archive
 * immediately, so the unlink fails with EBUSY. Stage outside the project.
 * Forward slashes keep the path intact in the builder CLI.
 */
export function argvWithStagingOutput(argv, directory) {
  const filtered = argv.filter(arg => !arg.startsWith('--config.directories.output=') && !arg.startsWith('-c.directories.output='))
  return [...filtered, `--config.directories.output=${directory.replaceAll('\\', '/')}`]
}

export function isInsideProject(projectDir, directory) {
  const offset = relative(resolve(projectDir), resolve(directory))
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset))
}

/** Move a finished staging directory into the configured output. Locked entries stay in staging. */
export async function publishStagedOutput(staging, destination) {
  await mkdir(destination, { recursive: true })
  const kept = []
  for (const name of await readdir(staging)) {
    const from = resolve(staging, name)
    const to = resolve(destination, name)
    // Rename the previous entry aside. Recursive deletion walks into a locked
    // archive and removes everything it can reach before failing.
    const previous = `${to}.previous`
    try {
      await rm(previous, { recursive: true, force: true })
    } catch (error) {
      if (error.code !== 'ENOENT' && !busyCodes.has(error.code)) throw error
    }
    try {
      await rename(to, previous)
    } catch (error) {
      if (error.code === 'ENOENT') {
        // The destination entry is absent.
      } else if (busyCodes.has(error.code)) {
        kept.push(to)
        continue
      } else {
        throw error
      }
    }
    try {
      await rename(from, to)
    } catch (error) {
      if (error.code !== 'EXDEV') throw error
      await cp(from, to, { recursive: true, force: true })
      await rm(from, { recursive: true, force: true })
    }
    await rm(previous, { recursive: true, force: true }).catch(error => {
      if (error.code !== 'ENOENT' && !busyCodes.has(error.code)) throw error
    })
  }
  if (kept.length === 0) await rm(staging, { recursive: true, force: true })
  return kept
}
