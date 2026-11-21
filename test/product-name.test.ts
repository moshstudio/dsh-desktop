import { describe, expect, it } from 'vitest'
import { applyProductDisplayName, productDisplayName } from '../src/shared/product-name'

describe('product display name', () => {
  it('uses 太极-dsh in every language', () => {
    expect(productDisplayName('zh-CN')).toBe('太极-dsh')
    expect(productDisplayName('en')).toBe('太极-dsh')
    expect(productDisplayName('ja')).toBe('太极-dsh')
  })

  it('keeps the development suffix and other process names', () => {
    expect(productDisplayName('zh', 'taichi-dsh Dev')).toBe('太极-dsh Dev')
    expect(productDisplayName('en', 'taichi-dsh Dev')).toBe('太极-dsh Dev')
    expect(productDisplayName('zh', 'BISHENG')).toBe('BISHENG')
  })

  it('substitutes the catalog token without doubling the development suffix', () => {
    expect(applyProductDisplayName('关于 太极-dsh', 'zh', 'taichi-dsh')).toBe('关于 太极-dsh')
    expect(applyProductDisplayName('关于 太极-dsh', 'zh', 'taichi-dsh Dev')).toBe('关于 太极-dsh Dev')
    expect(applyProductDisplayName('About taichi-dsh', 'en', 'taichi-dsh Dev')).toBe('About 太极-dsh Dev')
    expect(applyProductDisplayName('关于 太极-dsh', 'zh', 'BISHENG')).toBe('关于 BISHENG')
  })
})
