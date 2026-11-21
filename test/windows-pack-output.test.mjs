import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { argvWithStagingOutput, isInsideProject, publishStagedOutput, resolveConfiguredOutput } from '../scripts/release/windows-pack-output.mjs'

const scratch = []
afterEach(async () => { for (const directory of scratch.splice(0)) await rm(directory, { recursive: true, force: true }) })
async function temporary() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pack-output-'))
  scratch.push(root)
  return root
}

it('keeps the configured output and points electron-builder outside the project', async () => {
  const root = await temporary()
  const load = file => file === 'package.json'
    ? { build: { directories: { output: 'dist' } } }
    : { directories: { output: 'dist-dev' } }
  expect(resolveConfiguredOutput(['--win', '--x64'], root, load)).toBe(join(root, 'dist'))
  expect(resolveConfiguredOutput(['--config', 'electron-builder.dev.cjs', '--config.directories.output=elsewhere'], root, load)).toBe(join(root, 'elsewhere'))
  const argv = argvWithStagingOutput(['node', 'electron-builder-windows.mjs', '--win', '--config.directories.output=dist'], 'C:\\Temp\\dsh-desktop-win-1')
  expect(argv.at(-1)).toBe('--config.directories.output=C:/Temp/dsh-desktop-win-1')
  expect(argv.some(arg => arg.includes('output=dist'))).toBe(false)
  expect(isInsideProject(root, join(root, 'dist', 'win-unpacked'))).toBe(true)
  expect(isInsideProject(root, join(tmpdir(), 'dsh-desktop-win-1'))).toBe(false)
})

it('moves a finished staging directory into the configured output', async () => {
  const root = await temporary()
  const staging = join(root, 'staging')
  const destination = join(root, 'dist')
  await mkdir(join(staging, 'win-unpacked'), { recursive: true })
  await writeFile(join(staging, 'win-unpacked', 'taichi-dsh.exe'), 'new')
  await writeFile(join(staging, 'setup.exe'), 'installer')
  await mkdir(destination, { recursive: true })
  await writeFile(join(destination, 'setup.exe'), 'old')
  expect(await publishStagedOutput(staging, destination)).toEqual([])
  expect(await readFile(join(destination, 'setup.exe'), 'utf8')).toBe('installer')
  expect(await readFile(join(destination, 'win-unpacked', 'taichi-dsh.exe'), 'utf8')).toBe('new')
})
