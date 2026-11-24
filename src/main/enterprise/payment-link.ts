/** PC website payment returns this official page. The renderer loads it directly. */
export function alipayQrPayload(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') return undefined
    if (url.hostname !== 'openapi.alipay.com' || url.pathname !== '/gateway.do') return undefined
    if (url.searchParams.get('method') !== 'alipay.trade.page.pay') return undefined
    if (url.searchParams.get('sign_type') !== 'RSA2' || !url.searchParams.get('sign')) return undefined
    if (value.length > 8192) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}
