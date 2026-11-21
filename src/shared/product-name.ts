/** Filesystem and package identity. The name shown to people is PRODUCT_NAME_ZH. */
export const PRODUCT_NAME_EN = 'taichi-dsh'
/** Display name in every interface language. */
export const PRODUCT_NAME_ZH = '太极-dsh'

/** Name to show for this process. The brand does not change with locale. */
export function productDisplayName(_locale: unknown, processName = PRODUCT_NAME_EN): string {
  if (processName === PRODUCT_NAME_EN) return PRODUCT_NAME_ZH
  if (processName === `${PRODUCT_NAME_EN} Dev`) return `${PRODUCT_NAME_ZH} Dev`
  return processName
}

/** Replace a catalog product token with the name this process should show. */
export function applyProductDisplayName(label: string, locale: unknown, processName: string): string {
  const display = productDisplayName(locale, processName)
  return label.replaceAll(PRODUCT_NAME_ZH, display).replaceAll(PRODUCT_NAME_EN, display)
}
