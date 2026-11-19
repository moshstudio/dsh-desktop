/** Alipay precreate returns a code on this host. Anything else is not drawn. */
export function alipayQrPayload(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hostname !== 'qr.alipay.com') return undefined
    if (url.pathname.length < 2 || value.length > 512) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}
