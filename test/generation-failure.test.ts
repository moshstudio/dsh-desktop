import { describe, expect, it } from 'vitest'
import { generationFailureSummaryKey } from '../packages/dsh-taichi-image-generation/src/client/generation-failure.ts'

describe('generation failure headlines', () => {
  it('maps image and video credit failures onto one reason', () => {
    expect(generationFailureSummaryKey('insufficient credits')).toBe('error.reason.quota')
    expect(generationFailureSummaryKey('Insufficient credits')).toBe('error.reason.quota')
    expect(generationFailureSummaryKey('积分不足，无法生成视频。')).toBe('error.reason.quota')
    expect(generationFailureSummaryKey('额度不足，无法生成图像。')).toBe('error.reason.quota')
  })

  it('keeps a specific local sentence as the headline', () => {
    expect(generationFailureSummaryKey('参考图最多 3 张。')).toBeNull()
  })

  it('hides a raw provider address behind the generic failure', () => {
    expect(generationFailureSummaryKey('request failed at http://10.0.0.1/v1/images/generations')).toBe('canvas.generateFailed')
    expect(generationFailureSummaryKey('upstream returned a malformed data url')).toBe('canvas.generateFailed')
  })
})
