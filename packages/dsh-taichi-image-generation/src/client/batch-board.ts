import type { GeneratedImage, GeneratedImageSlot, GenerateResult } from '../protocol.ts'

/** One requested picture on the board, whether it is still waiting or already back. */
export interface BatchCell {
  index: number
  image?: GeneratedImage
  /** Set when this picture failed. Empty means the caller should use its own fallback copy. */
  error?: string
  pending: boolean
}

/**
 * One cell per requested picture.
 *
 * A running batch reports slots with `index`, so a picture that finishes
 * later does not move the ones already on screen. The finished batch omits
 * `index` and stays in request order. A slot that is not there yet stays pending.
 */
export function batchCells(
  result: Pick<GenerateResult, 'images' | 'slots'> | undefined,
  total: number,
  settled: boolean,
): BatchCell[] {
  const count = Math.max(1, Math.min(4, Math.trunc(total) || 1))
  const images = result?.images ?? []
  const slots = result?.slots
  const cells: BatchCell[] = []
  for (let index = 0; index < count; index += 1) {
    cells.push(cellAt(images, slots, index, count, settled))
  }
  return cells
}

function cellAt(
  images: readonly GeneratedImage[],
  slots: readonly GeneratedImageSlot[] | undefined,
  index: number,
  count: number,
  settled: boolean,
): BatchCell {
  if (slots === undefined) {
    const image = images[index]
    if (image !== undefined) return { index, image, pending: false }
    return settled ? { index, pending: false, error: '' } : { index, pending: true }
  }
  const indexed = slots.some(slot => slot.index !== undefined)
  const slot = indexed
    ? slots.find(item => item.index === index)
    : slots.length >= count ? slots[index] : undefined
  if (slot === undefined) {
    return settled ? { index, pending: false, error: '' } : { index, pending: true }
  }
  const image = slot.imageIndex === undefined ? undefined : images[slot.imageIndex]
  if (image !== undefined) return { index, image, pending: false }
  return { index, error: slot.error ?? '', pending: false }
}
