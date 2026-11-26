import { describe, expect, it } from 'vitest'
import {
  describeVideoModel,
  durationsOf,
  snapToFamilySeconds,
} from '../packages/dsh-taichi-image-generation/src/video-model-catalog.ts'

describe('snapToFamilySeconds', () => {
  it('snaps veo off-tier and omitted default to 8', () => {
    const veo = describeVideoModel('veo')
    expect(durationsOf(veo)).toEqual([8])
    expect(snapToFamilySeconds(5, veo)).toBe(8)
    expect(snapToFamilySeconds(durationsOf(veo)[0]!, veo)).toBe(8)
  })

  it('snaps grok 5 up to 10', () => {
    const grok = describeVideoModel('grok')
    expect(snapToFamilySeconds(5, grok)).toBe(10)
  })

  it('snaps muse-video 7 down to 5 and keeps 10', () => {
    const muse = describeVideoModel('muse-video')
    expect(snapToFamilySeconds(7, muse)).toBe(5)
    expect(snapToFamilySeconds(10, muse)).toBe(10)
  })

  it('prefers not widening when a shorter-or-equal tier exists', () => {
    const muse = describeVideoModel('muse-video')
    expect(snapToFamilySeconds(7, muse)).toBe(5)
    expect(snapToFamilySeconds(7, muse)).not.toBe(10)
  })
})