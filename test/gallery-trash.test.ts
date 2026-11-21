import { mkdtemp, readFile, rm, writeFile, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendGallery,
  appendGalleryVideo,
  listGallery,
  listGalleryTrash,
  purgeGallery,
  purgeGalleryEntry,
  removeGallery,
  restoreGallery,
  splitGalleryEntries,
} from '../packages/dsh-taichi-image-generation/src/gallery-store.ts'
import { GALLERY_TRASH_RETENTION_MS } from '../packages/dsh-taichi-image-generation/src/protocol.ts'
import { setImageDataRoot } from '../packages/dsh-taichi-image-generation/src/image-storage-path.ts'
import type { HistoryEntryInput } from '../packages/dsh-taichi-image-generation/src/protocol.ts'

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function imageInput(id: string, prompt: string, bytes: Buffer = PNG): HistoryEntryInput {
  return {
    id,
    createdAt: Date.now(),
    mode: 'text',
    model: 'gpt-image-2',
    prompt,
    size: '1:1',
    quality: 'auto',
    detail: '',
    n: 1,
    images: [{ b64: bytes.toString('base64'), mime: 'image/png' }],
  }
}

describe('gallery trash', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'dsh-gallery-trash-'))
    setImageDataRoot(root)
  })

  afterEach(async () => {
    setImageDataRoot(undefined)
    await rm(root, { recursive: true, force: true })
  })

  it('revives a trashed image with the new prompt instead of writing a second copy', async () => {
    const added = await appendGallery(imageInput('img-1', 'old prompt'))
    expect(added.added).toBe(true)
    await removeGallery('img-1')
    const revived = await appendGallery(imageInput('img-2', 'new prompt'))
    expect(revived.added).toBe(true)
    const shelf = splitGalleryEntries(revived.entries)
    expect(shelf.entries.map(entry => entry.id)).toEqual(['img-1'])
    expect(shelf.entries[0]?.prompt).toBe('new prompt')
    expect(shelf.trash).toEqual([])
    const files = await readdir(path.join(root, 'gallery', 'images'))
    expect(files).toHaveLength(1)
  })

  it('lists trash newest-deletion first on both the list and a mutation split', async () => {
    await appendGallery(imageInput('older', 'older', Buffer.from('older-bytes')))
    await appendGallery(imageInput('newer', 'newer', Buffer.from('newer-bytes')))
    await removeGallery('older')
    await new Promise(resolve => { setTimeout(resolve, 5) })
    const removed = splitGalleryEntries(await removeGallery('newer'))
    expect(removed.trash.map(entry => entry.id)).toEqual(['newer', 'older'])
    const listed = await listGalleryTrash()
    expect(listed.map(entry => entry.id)).toEqual(['newer', 'older'])
    expect(listed[0]?.bytes).toBe(Buffer.from('newer-bytes').length)
  })

  it('drops an expired row and its file before a restore can claim success', async () => {
    await appendGallery(imageInput('stale', 'stale'))
    await removeGallery('stale')
    const indexFile = path.join(root, 'gallery', 'index.json')
    const index = JSON.parse(await readFile(indexFile, 'utf8')) as { entries: Array<{ deletedAt?: number; images: Array<{ file: string }> }> }
    const row = index.entries[0]
    const file = row?.images[0]?.file
    expect(row).toBeDefined()
    expect(file).toBeTypeOf('string')
    if (row === undefined || file === undefined) return
    row.deletedAt = Date.now() - GALLERY_TRASH_RETENTION_MS - 1000
    await writeFile(indexFile, JSON.stringify(index))
    const restored = await restoreGallery('stale')
    expect(restored.outcome).toBe('missing')
    expect(splitGalleryEntries(restored.entries).trash).toEqual([])
    expect(await listGallery()).toEqual([])
    const files = await readdir(path.join(root, 'gallery', 'images'))
    expect(files).not.toContain(file)
  })

  it('drops a trashed duplicate when the same picture is already on the shelf', async () => {
    const added = await appendGallery(imageInput('live', 'live'))
    const live = added.entries.find(entry => entry.id === 'live')
    const file = live?.images[0]?.url.split('/').pop()
    expect(file).toBeTypeOf('string')
    const indexFile = path.join(root, 'gallery', 'index.json')
    const index = JSON.parse(await readFile(indexFile, 'utf8')) as { entries: Array<Record<string, unknown>> }
    const source = index.entries[0]
    expect(source).toBeDefined()
    if (source === undefined) return
    const copyName = 'copy-0.png'
    const imagesDir = path.join(root, 'gallery', 'images')
    await writeFile(path.join(imagesDir, copyName), PNG)
    index.entries.push({
      ...source,
      id: 'copy',
      deletedAt: Date.now(),
      images: [{ file: copyName, mime: 'image/png' }],
    })
    await writeFile(indexFile, JSON.stringify(index))
    const restored = await restoreGallery('copy')
    expect(restored.outcome).toBe('duplicate')
    const shelf = splitGalleryEntries(restored.entries)
    expect(shelf.entries.map(entry => entry.id)).toEqual(['live'])
    expect(shelf.trash).toEqual([])
    const files = await readdir(imagesDir)
    expect(files).toContain(file)
    expect(files).not.toContain(copyName)
  })

  it('purges one trashed entry and leaves the rest recoverable', async () => {
    await appendGallery(imageInput('keep', 'keep', Buffer.from('keep-bytes')))
    await appendGallery(imageInput('drop', 'drop', Buffer.from('drop-bytes')))
    await removeGallery('keep')
    await removeGallery('drop')
    const before = await listGalleryTrash()
    const dropped = before.find(entry => entry.id === 'drop')
    const droppedFile = dropped?.images[0]?.url.split('/').pop()
    await purgeGalleryEntry('drop')
    const trash = await listGalleryTrash()
    expect(trash.map(entry => entry.id)).toEqual(['keep'])
    const files = await readdir(path.join(root, 'gallery', 'images'))
    expect(files).not.toContain(droppedFile)
    expect(files.length).toBeGreaterThan(0)
    await purgeGallery()
    expect(await listGalleryTrash()).toEqual([])
    expect(await readdir(path.join(root, 'gallery', 'images'))).toEqual([])
  })

  it('favorites one clip once, and a later favorite revives the trashed copy', async () => {
    const videos = path.join(root, 'clips')
    await mkdir(videos, { recursive: true })
    const source = path.join(videos, 'cat.mp4')
    const clip = Buffer.concat([Buffer.from('00000018667479706d703432', 'hex'), Buffer.alloc(32, 7)])
    await writeFile(source, clip)
    const favorite = {
      id: 'fav-1',
      createdAt: Date.now(),
      model: 'agnes-video',
      prompt: 'first',
      aspectRatio: '16:9',
      seconds: 5,
      sourcePath: source,
      mime: 'video/mp4',
      duration: 5,
    }
    const first = await appendGalleryVideo(favorite)
    expect(first.added).toBe(true)
    const second = await appendGalleryVideo({ ...favorite, id: 'fav-2', prompt: 'second' })
    expect(second.added).toBe(false)
    expect(splitGalleryEntries(second.entries).entries).toHaveLength(1)
    expect(await readdir(path.join(root, 'gallery', 'videos'))).toHaveLength(1)
    await removeGallery('fav-1')
    const revived = await appendGalleryVideo({ ...favorite, id: 'fav-3', prompt: 'revived' })
    expect(revived.added).toBe(true)
    const shelf = splitGalleryEntries(revived.entries)
    expect(shelf.entries.map(entry => entry.id)).toEqual(['fav-1'])
    expect(shelf.entries[0]?.prompt).toBe('revived')
    expect(shelf.trash).toEqual([])
    expect(await readdir(path.join(root, 'gallery', 'videos'))).toHaveLength(1)
  })
})
