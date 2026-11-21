import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { installWindowsDirectoryInstaller } from './windows-directory-installer.mjs'
import { argvWithStagingOutput, isInsideProject, publishStagedOutput, resolveConfiguredOutput } from './windows-pack-output.mjs'

installWindowsDirectoryInstaller()
if (process.env.JSIGN_JAR || process.env.JSIGN_PIN_FILE) {
  if (!process.env.JSIGN_JAR || !process.env.JSIGN_PIN_FILE) {
    throw new Error('Incomplete Jsign environment for Windows installer packaging')
  }
  process.argv.push('--config.win.signtoolOptions.sign=./scripts/release/jsign-windows-hook.mjs')
}
const require = createRequire(import.meta.url)
const projectDir = process.cwd()
const destination = resolveConfiguredOutput(process.argv.slice(2), projectDir, file => require(resolve(projectDir, file)))
const staging = await mkdtemp(join(tmpdir(), 'dsh-desktop-win-'))
if (isInsideProject(projectDir, staging)) throw new Error('Windows packaging staging directory must stay outside the project so the editor does not lock Electron archives')
process.argv = argvWithStagingOutput(process.argv, staging)
const { build, createYargs, configureBuildCommand } = require('electron-builder/out/builder.js')
const argv = await createYargs()
  .command(['build', '*'], 'Build', configureBuildCommand)
  .strict()
  .parseAsync(process.argv.slice(2))
try {
  await build(argv)
} catch (error) {
  await rm(staging, { recursive: true, force: true })
  throw error
}
const kept = await publishStagedOutput(staging, destination)
if (kept.length > 0) {
  console.error(`Could not replace ${kept.join(', ')} because a process has it open. Those new files remain at ${staging}.`)
}
