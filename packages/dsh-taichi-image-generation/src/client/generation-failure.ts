/**
 * One headline for the same generation failure, whichever surface shows it.
 *
 * Image and video used to print the provider string as-is. A 402 whose body
 * said "insufficient credits" stayed English on an image, while a video 402
 * with an empty body fell back to 「积分不足」. The headline is chosen here so
 * both say the same sentence in the active language. The original string stays
 * available for the disclosure; this function only picks the headline key.
 *
 * A `null` key means the message is already something the user can act on
 * (a short sentence this app wrote). Callers should show it directly instead
 * of burying it under a generic 「生成失败」.
 */
import type { ImageGenKey } from './locales.ts'

const QUOTA = /insufficient\s+credits|insufficient\s+quota|insufficient\s+balance|not enough credits|out of credits|quota exceeded|payment required|credit balance|积分不足|额度不足|余额不足/i
const AUTH = /请先登录|未登录|sign in|unauthorized|authentication|invalid api key/i
const TIMEOUT = /超时|timed out|\btimeout\b/i
const UNAVAILABLE = /暂时不可用|service unavailable|ECONNREFUSED|ENOTFOUND|network error|failed to fetch/i

/** True when the text is the provider speaking (a URL, or Latin with no CJK). */
function looksUpstream(text: string): boolean {
  if (/https?:\/\//i.test(text)) return true
  if (/request[_ ]id/i.test(text)) return true
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  return latin > 0 && cjk === 0
}

/**
 * Locale key for the failure headline.
 *
 * @returns `null` when `message` should be shown unchanged.
 */
export function generationFailureSummaryKey(message: string): ImageGenKey | null {
  const text = message.trim()
  if (text === '') return 'canvas.generateFailed'
  if (QUOTA.test(text)) return 'error.reason.quota'
  if (AUTH.test(text)) return 'error.reason.auth'
  if (TIMEOUT.test(text)) return 'error.reason.timeout'
  if (UNAVAILABLE.test(text)) return 'error.reason.unavailable'
  if (looksUpstream(text)) return 'canvas.generateFailed'
  return null
}
