/** How many catalog rows "load more" is allowed to keep in the DOM. */

export const MAX_SHOWN_PAGES = 8

export function shownWindow(count: number, limit: number, chunk: number, pages = MAX_SHOWN_PAGES): {
  shown: number
  more: number
  atCap: boolean
} {
  const cap = Math.max(chunk, chunk * pages)
  const shown = Math.min(count, limit, cap)
  const atCap = count > shown && shown >= cap
  return {
    shown,
    more: atCap ? 0 : Math.max(0, count - shown),
    atCap,
  }
}
