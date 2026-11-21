/**
 * Host-persisted gallery (user-curated favorites): mirrors the history store
 * (image files + an index.json under ~/.dsh/dsh-taichi-imagegen/gallery/) but with no
 * size cap — every entry is an explicit user choice. Appends are deduplicated
 * by image content so adding the same generated image twice is a no-op.
 *
 * Removal is a SOFT delete: the entry is flagged with `deletedAt` and moved to
 * the trash for `GALLERY_TRASH_RETENTION_MS`, while its files stay exactly
 * where they are. History rows, canvas nodes and open lightboxes hold URLs that
 * point straight at those files — unlinking them on delete would turn every
 * existing reference into a broken image, and restoring would hand back an
 * empty card. `restoreGallery` clears the flag. `purgeGallery`,
 * `purgeGalleryEntry`, a duplicate restore, and the retention sweep are the
 * only things that actually unlink. They rewrite the index first and unlink
 * afterwards: a crash between the two leaves an orphan file, which is
 * recoverable, instead of a trash row whose picture is already gone.
 *
 * Framework-free (node:fs + node:crypto only) so the route layer can drive it
 * directly.
 */

import { createReadStream, promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { GALLERY_API, GALLERY_TRASH_RETENTION_MS, type HistoryEntry, type HistoryEntryInput, type StoredEntryMode } from './protocol.ts'

export { GALLERY_TRASH_RETENTION_MS } from './protocol.ts'

/** Prefix route serving one favorited clip. */
const GALLERY_VIDEO_FILE_ROUTE = GALLERY_API.videoFile
import { notifyImageSaved } from './storage-sync.ts'
import { imageDataRoot } from './image-storage-path.ts'

function historyDir(): string { return imageDataRoot() }
function galleryDir(): string { return path.join(imageDataRoot(), 'gallery') }
function indexPath(): string { return path.join(galleryDir(), 'index.json') }
function imagesDir(): string { return path.join(galleryDir(), 'images') }
function videosDir(): string { return path.join(galleryDir(), 'videos') }

/** One gallery entry carries the same wire shape as a history entry. */
export interface GalleryAppendResult {
  /** The full index after the append, trash included. The route splits it
   *  into the shelf and the trash before the client renders either list. */
  entries: HistoryEntry[]
  /** Whether the shelf gained a visible entry (false = a content-identical
   *  image was already on the shelf, so the append was skipped). Reviving a
   *  trashed copy counts as added. */
  added: boolean
}

// Gallery mutations read and replace one shared index. Serialize them so
// overlapping requests cannot each read an old index and lose the other's row.
let pendingMutation: Promise<void> = Promise.resolve()

function mutateGallery<T>(operation: () => Promise<T>): Promise<T> {
  const next = pendingMutation.then(operation, operation)
  pendingMutation = next.then(() => undefined, () => undefined)
  return next
}

/** One image's on-disk record (file name + mime, never base64). */
interface StoredImage {
  file: string
  mime: string
  revisedPrompt?: string
}

/** One entry's on-disk record. `hash` fingerprints the first image so the
 *  store can refuse duplicate appends cheaply. */
interface StoredEntry {
  id: string
  createdAt: number
  mode: StoredEntryMode
  model: string
  prompt: string
  size: string
  quality: string
  detail: string
  n: number
  images: StoredImage[]
  /** Favorited clip, stored as a copied file in gallery/videos/. */
  video?: StoredVideo
  hash?: string
  refName?: string
  tags?: string[]
  channelId?: string
  channel?: string
  workflow?: 'ecommerce' | 'replica'
  projectId?: string
  projectName?: string
  slotKey?: string
  slotLabel?: string
  canvas?: HistoryEntryInput['canvas']
  /** Set when the entry sits in the trash (soft delete). Absent = live.
   *  Written by newer hosts only, so a manifest from an older version simply
   *  reads back as all-live — no migration step is needed. */
  deletedAt?: number
  /** Combined size of this entry's files. Missing on rows written before the
   *  field existed; those are measured when the trash is projected. */
  bytes?: number
}

/** One favorited clip's on-disk record. */
interface StoredVideo {
  file: string
  mime: string
  duration?: number
}

/** The index.json shape. */
interface IndexFile {
  entries: StoredEntry[]
}

/** File extension for a MIME type (image file names). */
function extensionOf(mime: string): string {
  switch (mime.split(';')[0]!.trim()) {
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'image/gif': return 'gif'
    default: return 'png'
  }
}

/** File extension for a video MIME type. */
function videoExtensionOf(mime: string): string {
  switch (mime.split(';')[0]!.trim().toLowerCase()) {
    case 'video/webm': return 'webm'
    case 'video/quicktime': return 'mov'
    case 'video/x-matroska': return 'mkv'
    default: return 'mp4'
  }
}

/** MIME type for a stored clip file name. */
function videoMimeOfFile(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case '.webm': return 'video/webm'
    case '.mov': return 'video/quicktime'
    case '.mkv': return 'video/x-matroska'
    default: return 'video/mp4'
  }
}

/** MIME type for a stored image file name (image route responses). */
function mimeOfFile(file: string): string {
  const ext = path.extname(file).toLowerCase()
  switch (ext) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: return 'image/png'
  }
}

/** Sanitize an entry id for use as a file-name prefix. */
function safeId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9-]/g, '-')
  return cleaned === '' ? 'entry' : cleaned
}

/** Short content fingerprint of the entry's first image. */
function fingerprint(input: HistoryEntryInput): string | undefined {
  const first = input.images[0]
  if (first === undefined) return undefined
  return createHash('sha1').update(first.b64).digest('hex')
}

/** Content fingerprint of a file, streamed so a long clip is not buffered. */
function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha1')
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', chunk => { hash.update(chunk) })
    stream.on('error', reject)
    stream.on('end', () => { resolve(hash.digest('hex')) })
  })
}

/** Write the fields a re-add is allowed to refresh. Omitted optionals stay:
 *  the panel's "add again" call does not resend the channel snapshot, and
 *  wiping it would make a revive look like a different asset. Tags are not
 *  on the append input; they stay as they were. */
function applyImageMetadata(entry: StoredEntry, input: HistoryEntryInput): void {
  entry.mode = input.mode
  entry.model = input.model
  entry.prompt = input.prompt
  entry.size = input.size
  entry.quality = input.quality
  entry.detail = input.detail
  entry.n = input.n
  if (input.refName !== undefined) entry.refName = input.refName
  if (input.channelId !== undefined) entry.channelId = input.channelId
  if (input.channel !== undefined) entry.channel = input.channel
  if (input.workflow !== undefined) entry.workflow = input.workflow
  if (input.projectId !== undefined) entry.projectId = input.projectId
  if (input.projectName !== undefined) entry.projectName = input.projectName
  if (input.slotKey !== undefined) entry.slotKey = input.slotKey
  if (input.slotLabel !== undefined) entry.slotLabel = input.slotLabel
  if (input.canvas !== undefined) entry.canvas = input.canvas
}

function applyVideoMetadata(entry: StoredEntry, input: {
  model: string
  prompt: string
  aspectRatio: string
  tags?: string[]
  channelId?: string
  channel?: string
  duration?: number
}): void {
  entry.model = input.model
  entry.prompt = input.prompt
  entry.size = input.aspectRatio
  if (input.tags !== undefined) entry.tags = input.tags
  if (input.channelId !== undefined) entry.channelId = input.channelId
  if (input.channel !== undefined) entry.channel = input.channel
  if (input.duration !== undefined && entry.video !== undefined) {
    entry.video = { ...entry.video, duration: input.duration }
  }
}

/** Ensure the storage directories exist. */
async function ensureDirs(): Promise<void> {
  await fs.mkdir(imagesDir(), { recursive: true })
  await fs.mkdir(videosDir(), { recursive: true })
}

/** Read the index, tolerating a missing/corrupt file. */
async function readIndex(): Promise<StoredEntry[]> {
  try {
    const raw = await fs.readFile(indexPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return []
    const entries = (parsed as { entries?: unknown }).entries
    if (!Array.isArray(entries)) return []
    return entries.filter(isStoredEntry)
  } catch {
    return []
  }
}

/** Persist the index. */
async function writeIndex(entries: StoredEntry[]): Promise<void> {
  await ensureDirs()
  const payload: IndexFile = { entries }
  const tmp = `${indexPath()}.tmp-${process.pid}`
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf8')
  await fs.rename(tmp, indexPath())
}

/** Structural guard for a stored entry. */
function isStoredEntry(value: unknown): value is StoredEntry {
  if (value === null || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return typeof entry.id === 'string'
    && typeof entry.createdAt === 'number'
    && (entry.mode === 'text' || entry.mode === 'edit' || entry.mode === 'video')
    && (entry.deletedAt === undefined || typeof entry.deletedAt === 'number')
    && (entry.workflow === undefined || entry.workflow === 'ecommerce' || entry.workflow === 'replica')
    && (entry.projectId === undefined || typeof entry.projectId === 'string')
    && (entry.projectName === undefined || typeof entry.projectName === 'string')
    && (entry.slotKey === undefined || typeof entry.slotKey === 'string')
    && (entry.slotLabel === undefined || typeof entry.slotLabel === 'string')
    && typeof entry.prompt === 'string'
    && Array.isArray(entry.images)
    && entry.images.every(image => {
      if (image === null || typeof image !== 'object') return false
      const record = image as Record<string, unknown>
      return typeof record.file === 'string' && typeof record.mime === 'string'
    })
}

/** Remove one entry's image files (best effort). */
async function removeEntryFiles(entry: StoredEntry): Promise<void> {
  for (const image of entry.images) {
    try { await fs.rm(path.join(imagesDir(), image.file), { force: true }) } catch { /* ignore */ }
  }
  if (entry.video !== undefined) {
    try { await fs.rm(path.join(videosDir(), entry.video.file), { force: true }) } catch { /* ignore */ }
  }
}

/** Project a stored entry onto the wire shape (image URLs). */
function toWire(entry: StoredEntry): HistoryEntry {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    mode: entry.mode,
    model: entry.model,
    prompt: entry.prompt,
    size: entry.size,
    quality: entry.quality,
    detail: entry.detail,
    n: entry.n,
    images: entry.images.map(image => ({
      url: `/api/dsh-taichi-imagegen/gallery/image/${image.file}`,
      mime: image.mime,
      ...image.revisedPrompt === undefined ? {} : { revisedPrompt: image.revisedPrompt },
    })),
    ...entry.refName === undefined ? {} : { refName: entry.refName },
    ...entry.tags === undefined ? {} : { tags: entry.tags },
    ...entry.channel === undefined ? {} : { channel: entry.channel },
    ...entry.channelId === undefined ? {} : { channelId: entry.channelId },
    ...entry.workflow === undefined ? {} : { workflow: entry.workflow },
    ...entry.projectId === undefined ? {} : { projectId: entry.projectId },
    ...entry.projectName === undefined ? {} : { projectName: entry.projectName },
    ...entry.slotKey === undefined ? {} : { slotKey: entry.slotKey },
    ...entry.slotLabel === undefined ? {} : { slotLabel: entry.slotLabel },
    ...entry.canvas === undefined ? {} : { canvas: entry.canvas },
    ...entry.deletedAt === undefined ? {} : { deletedAt: entry.deletedAt },
    ...entry.video === undefined ? {} : {
      video: {
        url: `${GALLERY_VIDEO_FILE_ROUTE}/${entry.video.file}`,
        mime: entry.video.mime,
        ...entry.video.duration === undefined ? {} : { duration: entry.video.duration },
      },
    },
  }
}

/** Whether an entry is still part of the visible gallery (not in the trash). */
function isLiveEntry(entry: StoredEntry): boolean {
  return entry.deletedAt === undefined
}

/** Newest deletion first. Shelf order is a separate sort on the client. */
function byDeletedAt(left: StoredEntry, right: StoredEntry): number {
  return (right.deletedAt ?? 0) - (left.deletedAt ?? 0)
}

/**
 * Split a combined index the way the client renders it.
 *
 * Trash order is part of the contract: a mutation response and a later reload
 * must both put the entry deleted last at the top. Sorting only inside
 * `listGalleryTrash` made a just-deleted row jump after the next visit.
 */
export function splitGalleryEntries(entries: HistoryEntry[]): { entries: HistoryEntry[]; trash: HistoryEntry[] } {
  return {
    entries: entries.filter(entry => entry.deletedAt === undefined),
    trash: entries
      .filter(entry => entry.deletedAt !== undefined)
      .sort((left, right) => (right.deletedAt ?? 0) - (left.deletedAt ?? 0)),
  }
}

/** Sum the files still on disk. A missing file counts as zero, not a failure. */
async function measureEntryBytes(entry: StoredEntry): Promise<number> {
  let total = 0
  for (const image of entry.images) {
    try {
      const stat = await fs.stat(path.join(imagesDir(), image.file))
      if (stat.isFile()) total += stat.size
    } catch { /* the index outlived the file; the row still has to render */ }
  }
  if (entry.video !== undefined) {
    try {
      const stat = await fs.stat(path.join(videosDir(), entry.video.file))
      if (stat.isFile()) total += stat.size
    } catch { /* same as a missing image */ }
  }
  return total
}

function storedBytes(entry: StoredEntry): number | undefined {
  return typeof entry.bytes === 'number' && Number.isFinite(entry.bytes) && entry.bytes >= 0 ? entry.bytes : undefined
}

/** Wire list with `bytes` filled on trash rows only. */
async function projectAll(entries: StoredEntry[]): Promise<HistoryEntry[]> {
  const wires = entries.map(toWire)
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const wire = wires[index]
    if (entry === undefined || wire === undefined || entry.deletedAt === undefined) continue
    const bytes = storedBytes(entry) ?? await measureEntryBytes(entry)
    wires[index] = { ...wire, bytes }
  }
  return wires
}

/**
 * Drop rows from the index, then unlink their files.
 *
 * The index write is the commit point. Unlink failures are swallowed inside
 * `removeEntryFiles`, so a file that stays behind is an orphan, not a trash
 * row pointing at nothing.
 */
async function commitRemoval(entries: StoredEntry[], removing: StoredEntry[]): Promise<StoredEntry[]> {
  if (removing.length === 0) return entries
  const ids = new Set(removing.map(entry => entry.id))
  const kept = entries.filter(entry => !ids.has(entry.id))
  await writeIndex(kept)
  for (const entry of removing) await removeEntryFiles(entry)
  return kept
}

/**
 * Unlink every trashed entry that is past the retention window.
 *
 * Called from inside `mutateGallery` only: it reads and rewrites the shared
 * index, so it must already hold the mutation queue. A fresh process gets its
 * cleanup for free on the first store call (list counts), which is the lazy
 * "next start" behaviour — no timer, nothing to shut down.
 */
async function purgeExpiredLocked(): Promise<void> {
  const entries = await readIndex()
  const now = Date.now()
  const expired = entries.filter(entry => entry.deletedAt !== undefined && now - entry.deletedAt >= GALLERY_TRASH_RETENTION_MS)
  await commitRemoval(entries, expired)
}

/** List the persisted gallery (live entries only), newest first, as wire entries. */
export async function listGallery(): Promise<HistoryEntry[]> {
  return mutateGallery(async () => {
    await purgeExpiredLocked()
    const entries = await readIndex()
    return entries.filter(isLiveEntry).map(toWire)
  })
}

/** List the trash (soft-deleted entries), newest deletion first. */
export async function listGalleryTrash(): Promise<HistoryEntry[]> {
  return mutateGallery(async () => {
    await purgeExpiredLocked()
    const entries = await readIndex()
    const trashed = entries.filter(entry => !isLiveEntry(entry)).sort(byDeletedAt)
    return (await projectAll(trashed)).sort((left, right) => (right.deletedAt ?? 0) - (left.deletedAt ?? 0))
  })
}

/** Append one image to the gallery. Deduplicates by first-image content —
 *  appending an image already on the shelf returns `added: false` with the
 *  list unchanged. The same picture sitting in the trash is revived instead
 *  of written again: a second row plus the trashed row is what the shelf
 *  showed as two copies. No size cap: every entry is an explicit user choice. */
export async function appendGallery(input: HistoryEntryInput): Promise<GalleryAppendResult> {
  return mutateGallery(async () => {
    await purgeExpiredLocked()
    await ensureDirs()
    const hash = fingerprint(input)
    if (hash !== undefined) {
      const existing = await readIndex()
      if (existing.some(entry => entry.hash === hash && isLiveEntry(entry))) {
        return { entries: await projectAll(existing), added: false }
      }
      const trashed = existing
        .filter(entry => entry.hash === hash && !isLiveEntry(entry))
        .sort(byDeletedAt)
      const revive = trashed[0]
      if (revive !== undefined) {
        delete revive.deletedAt
        applyImageMetadata(revive, input)
        await writeIndex(existing)
        return { entries: await projectAll(existing), added: true }
      }
    }
    const prefix = safeId(input.id)
    const storedImages: StoredImage[] = []
    let bytes = 0
    try {
      for (let index = 0; index < input.images.length; index++) {
        const image = input.images[index]
        if (image === undefined) continue
        const file = `${prefix}-${index}.${extensionOf(image.mime)}`
        const data = Buffer.from(image.b64, 'base64')
        bytes += data.length
        await fs.writeFile(path.join(imagesDir(), file), data)
        notifyImageSaved('gallery', path.join(imagesDir(), file))
        storedImages.push({
          file,
          mime: image.mime,
          ...image.revisedPrompt === undefined ? {} : { revisedPrompt: image.revisedPrompt },
        })
      }
    } catch (error) {
      await removeEntryFiles({ images: storedImages } as StoredEntry)
      throw error
    }
    const entry: StoredEntry = {
      id: input.id,
      createdAt: input.createdAt,
      mode: input.mode,
      model: input.model,
      prompt: input.prompt,
      size: input.size,
      quality: input.quality,
      detail: input.detail,
      n: input.n,
      images: storedImages,
      bytes,
      ...hash === undefined ? {} : { hash },
      ...input.refName === undefined ? {} : { refName: input.refName },
      ...input.channelId === undefined ? {} : { channelId: input.channelId },
      ...input.channel === undefined ? {} : { channel: input.channel },
      ...input.workflow === undefined ? {} : { workflow: input.workflow },
      ...input.projectId === undefined ? {} : { projectId: input.projectId },
      ...input.projectName === undefined ? {} : { projectName: input.projectName },
      ...input.slotKey === undefined ? {} : { slotKey: input.slotKey },
      ...input.slotLabel === undefined ? {} : { slotLabel: input.slotLabel },
      ...input.canvas === undefined ? {} : { canvas: input.canvas },
    }
    const merged = [entry, ...await readIndex()]
    await writeIndex(merged)
    return { entries: await projectAll(merged), added: true }
  })
}

/**
 * Move one entry to the trash (soft delete).
 *
 * The files are deliberately NOT unlinked: they stay readable through the
 * existing image/clip routes for the whole retention window, so `restore`
 * returns the real picture and every URL already held elsewhere keeps working.
 * Returns the full list (live + trash) — the route layer splits it.
 */
export async function removeGallery(id: string): Promise<HistoryEntry[]> {
  return mutateGallery(async () => {
    await purgeExpiredLocked()
    const entries = await readIndex()
    const target = entries.find(entry => entry.id === id)
    if (target !== undefined && isLiveEntry(target)) {
      target.deletedAt = Date.now()
      await writeIndex(entries)
    }
    return projectAll(entries)
  })
}

/** Why a restore request did not put the row back on the shelf. */
export type GalleryRestoreOutcome = 'restored' | 'missing' | 'duplicate'

/**
 * Bring one trashed entry back into the gallery.
 *
 * Tags, channel snapshot, canvas lineage and the original `createdAt` stay,
 * so the entry returns to its old position in every sort. An entry the
 * retention sweep just removed answers `missing` — the caller must not tell
 * the user it came back. A second copy of a picture already on the shelf is
 * dropped instead of restored: the shelf keeps the live row, and the trashed
 * files are unlinked.
 */
export async function restoreGallery(id: string): Promise<{ entries: HistoryEntry[]; outcome: GalleryRestoreOutcome }> {
  return mutateGallery(async () => {
    await purgeExpiredLocked()
    const entries = await readIndex()
    const target = entries.find(entry => entry.id === id && !isLiveEntry(entry))
    if (target === undefined) {
      // Already on the shelf (a double click, or undo after it landed). That is
      // not the expired case: the row is still there, so the answer stays success.
      const live = entries.some(entry => entry.id === id && isLiveEntry(entry))
      return { entries: await projectAll(entries), outcome: live ? 'restored' : 'missing' }
    }
    const duplicate = target.hash !== undefined && entries.some(entry => entry.id !== target.id && isLiveEntry(entry) && entry.hash === target.hash)
    if (duplicate) {
      const kept = await commitRemoval(entries, [target])
      return { entries: await projectAll(kept), outcome: 'duplicate' }
    }
    delete target.deletedAt
    await writeIndex(entries)
    return { entries: await projectAll(entries), outcome: 'restored' }
  })
}

/**
 * Empty the trash: permanently delete every trashed entry and its files.
 *
 * Backs the explicit "empty trash" action, which the client guards with a
 * confirmation. The index is rewritten before any unlink.
 */
export async function purgeGallery(): Promise<HistoryEntry[]> {
  return mutateGallery(async () => {
    await purgeExpiredLocked()
    const entries = await readIndex()
    const kept = await commitRemoval(entries, entries.filter(entry => !isLiveEntry(entry)))
    return projectAll(kept)
  })
}

/**
 * Permanently delete one trashed entry and its files.
 *
 * A live id is left alone: this is not a second soft-delete path. A missing
 * or already-expired id returns the current lists without an error — the
 * sweep may have removed it between the click and the request.
 */
export async function purgeGalleryEntry(id: string): Promise<HistoryEntry[]> {
  return mutateGallery(async () => {
    await purgeExpiredLocked()
    const entries = await readIndex()
    const target = entries.find(entry => entry.id === id && !isLiveEntry(entry))
    if (target === undefined) return projectAll(entries)
    const kept = await commitRemoval(entries, [target])
    return projectAll(kept)
  })
}

/** Replace the user-managed labels for one gallery entry. */
export async function updateGalleryTags(id: string, tags: string[]): Promise<HistoryEntry[]> {
  return mutateGallery(async () => {
    await purgeExpiredLocked()
    const normalized = [...new Set(tags.map(tag => tag.trim()).filter(Boolean))].slice(0, 20)
    const entries = await readIndex()
    const target = entries.find(entry => entry.id === id)
    if (target !== undefined) target.tags = normalized
    await writeIndex(entries)
    return projectAll(entries)
  })
}

/**
 * Move every live entry to the trash.
 *
 * "Clear the gallery" used to unlink everything on the spot; under soft delete
 * it is the bulk form of `removeGallery`, so the whole cleared gallery is
 * recoverable for the retention window and only `purgeGallery` really deletes.
 */
export async function clearGallery(): Promise<HistoryEntry[]> {
  return mutateGallery(async () => {
    await purgeExpiredLocked()
    const entries = await readIndex()
    const now = Date.now()
    for (const entry of entries) if (isLiveEntry(entry)) entry.deletedAt = now
    await writeIndex(entries)
    return projectAll(entries)
  })
}

/** Read one stored image file by its (validated) file name. */
/**
 * Favorite one finished clip.
 *
 * The bytes are COPIED out of the video store rather than referenced: the video
 * history is capped (oldest clips are evicted), so a reference would silently
 * rot. Copying is the same tradeoff the image path already makes, and it keeps
 * a favorite durable without the client ever sending video bytes.
 */
export async function appendGalleryVideo(input: {
  id: string
  createdAt: number
  model: string
  prompt: string
  aspectRatio: string
  seconds: number
  /** Absolute path of the source clip inside the video store. */
  sourcePath: string
  mime: string
  duration?: number
  tags?: string[]
  channelId?: string
  channel?: string
}): Promise<GalleryAppendResult> {
  return mutateGallery(async () => {
    await purgeExpiredLocked()
    await ensureDirs()
    // Fingerprint the source before copying. A second favorite of the same
    // clip used to write another file and leave the first one in the trash
    // for the whole retention window.
    const hash = await hashFile(input.sourcePath)
    const existing = await readIndex()
    if (existing.some(entry => entry.hash === hash && isLiveEntry(entry))) {
      return { entries: await projectAll(existing), added: false }
    }
    const trashed = existing.filter(entry => entry.hash === hash && !isLiveEntry(entry)).sort(byDeletedAt)
    const revive = trashed[0]
    if (revive !== undefined) {
      delete revive.deletedAt
      applyVideoMetadata(revive, input)
      await writeIndex(existing)
      return { entries: await projectAll(existing), added: true }
    }
    const file = `${safeId(input.id)}-0.${videoExtensionOf(input.mime)}`
    const target = path.join(videosDir(), file)
    await fs.copyFile(input.sourcePath, target)
    const copied = await fs.stat(target)
    const entry: StoredEntry = {
      id: input.id,
      createdAt: input.createdAt,
      mode: 'video',
      model: input.model,
      prompt: input.prompt,
      size: input.aspectRatio,
      quality: '',
      detail: '',
      n: 1,
      images: [],
      video: {
        file,
        mime: input.mime,
        ...input.duration === undefined ? {} : { duration: input.duration },
      },
      hash,
      bytes: copied.size,
      ...input.tags === undefined ? {} : { tags: input.tags },
      ...input.channelId === undefined ? {} : { channelId: input.channelId },
      ...input.channel === undefined ? {} : { channel: input.channel },
    }
    const merged = [entry, ...existing]
    await writeIndex(merged)
    return { entries: await projectAll(merged), added: true }
  })
}

/**
 * Read one favorited clip by name.
 *
 * The name pattern is exactly what this store writes, so the route can never
 * escape the videos directory; `size` supports Range responses (seeking).
 */
export async function readGalleryVideo(file: string): Promise<{ path: string; size: number; mime: string } | undefined> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*-[0-9]+\.(mp4|webm|mov|mkv)$/.test(file)) return undefined
  const absolute = path.join(videosDir(), file)
  try {
    const stat = await fs.stat(absolute)
    if (!stat.isFile()) return undefined
    return { path: absolute, size: stat.size, mime: videoMimeOfFile(file) }
  } catch {
    return undefined
  }
}

export async function readGalleryImage(file: string): Promise<{ data: Buffer; mime: string } | undefined> {
  // Only accept <id>-<index>.<png|jpg|jpeg|webp|gif> — the exact names this
  // store writes — so the route can never escape the images directory.
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*-[0-9]+\.(png|jpg|jpeg|webp|gif)$/.test(file)) return undefined
  try {
    const data = await fs.readFile(path.join(imagesDir(), file))
    return { data, mime: mimeOfFile(file) }
  } catch {
    return undefined
  }
}
