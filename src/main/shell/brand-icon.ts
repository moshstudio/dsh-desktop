/** Sizes drawn with coverage sampling. Windows tray slots are 16 logical pixels. */
export const WINDOWS_TRAY_ICON_SIZES = [16, 20, 24, 32, 40, 48, 64] as const

/** Physical pixels for the notification area at the current display scale. */
export function windowsTrayPixels(scaleFactor: number): number {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1
  return Math.max(16, Math.round(16 * scale))
}

/** The pre-rendered tray bitmap that can cover this pixel size without upscaling. */
export function windowsTrayIconSize(pixels: number): number {
  for (const size of WINDOWS_TRAY_ICON_SIZES) {
    if (size >= pixels) return size
  }
  return 64
}

export function windowsTrayIconFile(pixels: number): string {
  return `tray-icon-${String(windowsTrayIconSize(pixels))}.png`
}
