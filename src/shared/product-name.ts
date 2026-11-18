import { desktopLocale } from './desktop-locale'

/** ASCII product name used for English UI, packages, and paths. */
export const PRODUCT_NAME_EN = 'taichi-dsh'
/** Chinese UI name. Paths and package identity stay on the English name. */
export const PRODUCT_NAME_ZH = '太极-dsh'

/** Name to show for this process in the given interface language. */
export function productDisplayName(locale: unknown, processName = PRODUCT_NAME_EN): string {
  if (processName !== PRODUCT_NAME_EN && processName !== `${PRODUCT_NAME_EN} Dev`) return processName
  const base = desktopLocale(locale) === 'zh' ? PRODUCT_NAME_ZH : PRODUCT_NAME_EN
  return processName.endsWith(' Dev') ? `${base} Dev` : base
}

/** Replace a catalog product token with the name this process should show. */
export function applyProductDisplayName(label: string, locale: unknown, processName: string): string {
  const display = productDisplayName(locale, processName)
  return label.replaceAll(PRODUCT_NAME_ZH, display).replaceAll(PRODUCT_NAME_EN, display)
}
