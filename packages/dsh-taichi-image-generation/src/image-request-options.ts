/**
 * Per-model image options published by the Taichi gateway.
 * Pure data: the panel and the host both resolve a request through here.
 */

export type ImageOutputFormat = 'png' | 'gif' | 'svg'

export interface ImageCatalogSize {
  aspect_ratio?: string
  quality?: string
  size?: string
}

export interface ImageCatalogModel {
  id: string
  name: string
  show_in_picker?: boolean
  credits?: number
  max_reference_images?: number
  quality_options?: string[]
  quality_map?: Record<string, string>
  sizes?: ImageCatalogSize[]
  render_quality_options?: string[]
  background_options?: string[]
  output_formats?: string[]
}

export interface ImageRequestChoice {
  aspect?: string
  quality?: string
  renderQuality?: string
  background?: string
  outputFormat?: string
  mode?: 'text' | 'edit'
}

export interface ResolvedImageRequest {
  model: string
  size: string
  outputFormat: ImageOutputFormat
  renderQuality?: string
  background?: 'transparent'
}

export class ImageOptionError extends Error {
  readonly code = 'invalid-image-options'

  constructor(message: string) {
    super(message)
    this.name = 'ImageOptionError'
  }
}

const OUTPUT_FORMATS = new Set<ImageOutputFormat>(['png', 'gif', 'svg'])

function listed(values: readonly string[] | undefined): string {
  return values === undefined || values.length === 0 ? '无' : values.join('、')
}

/** Aspect ratios in the order the gateway published them. */
export function aspectsOf(model: ImageCatalogModel): string[] {
  const seen = new Set<string>()
  const aspects: string[] = []
  for (const row of model.sizes ?? []) {
    const aspect = typeof row.aspect_ratio === 'string' ? row.aspect_ratio.trim() : ''
    if (aspect === '' || seen.has(aspect)) continue
    seen.add(aspect)
    aspects.push(aspect)
  }
  return aspects
}

/** Resolution tiers that this aspect actually has a pixel size for. */
export function qualitiesFor(model: ImageCatalogModel, aspect: string): string[] {
  const present = new Set(
    (model.sizes ?? [])
      .filter(row => row.aspect_ratio === aspect && typeof row.quality === 'string' && row.quality.trim() !== '')
      .map(row => row.quality!.trim().toLowerCase()),
  )
  return (model.quality_options ?? []).map(item => item.toLowerCase()).filter(tier => present.has(tier))
}

/** medium when the model lists it, otherwise the first published render quality. */
export function defaultRenderQuality(model: ImageCatalogModel): string | undefined {
  const options = model.render_quality_options ?? []
  if (options.length === 0) return undefined
  return options.includes('medium') ? 'medium' : options[0]
}

/** Output formats this model can answer. Edits stay PNG. */
export function outputFormatsOf(model: ImageCatalogModel, mode: 'text' | 'edit' = 'text'): ImageOutputFormat[] {
  const published = (model.output_formats ?? ['png'])
    .map(item => item.toLowerCase())
    .filter((item): item is ImageOutputFormat => OUTPUT_FORMATS.has(item as ImageOutputFormat))
  const formats = published.length > 0 ? published : ['png' as const]
  return mode === 'edit' ? formats.filter(item => item === 'png') : formats
}

export function referenceLimitOf(model: ImageCatalogModel | undefined, fallback = 5): number {
  const value = model?.max_reference_images
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return fallback
  return value
}

export function findCatalogModel(models: readonly ImageCatalogModel[], key: string): ImageCatalogModel | undefined {
  const needle = key.trim()
  if (needle === '') return undefined
  return models.find(model => model.id === needle || model.name === needle)
}

/**
 * Map a panel or agent choice onto the gateway body.
 * An omitted aspect or tier uses the model's first legal value. An explicit
 * value that the model does not list is rejected instead of being rewritten.
 */
export function resolveImageRequest(model: ImageCatalogModel, choice: ImageRequestChoice): ResolvedImageRequest {
  const aspects = aspectsOf(model)
  if (aspects.length === 0) throw new ImageOptionError(`${model.name} 没有可用的比例。`)
  const requestedAspect = typeof choice.aspect === 'string' ? choice.aspect.trim() : ''
  const aspect = requestedAspect === '' ? aspects[0]! : requestedAspect
  if (!aspects.includes(aspect)) {
    throw new ImageOptionError(`${model.name} 不支持比例 ${aspect}。可选：${listed(aspects)}。`)
  }

  const tiers = qualitiesFor(model, aspect)
  const requestedQuality = typeof choice.quality === 'string' ? choice.quality.trim().toLowerCase() : ''
  const rowForAspect = (model.sizes ?? []).find(row => row.aspect_ratio === aspect && typeof row.size === 'string' && row.size.trim() !== '')
  let tier = ''
  if (tiers.length === 0) {
    const only = rowForAspect?.quality?.trim().toLowerCase() ?? ''
    if (requestedQuality !== '' && requestedQuality !== 'auto' && requestedQuality !== only) {
      throw new ImageOptionError(`${model.name} 没有清晰度档位。`)
    }
    tier = only
  } else {
    tier = requestedQuality === '' || requestedQuality === 'auto' ? tiers[0]! : requestedQuality
    if (!tiers.includes(tier)) {
      throw new ImageOptionError(`${model.name} 在 ${aspect} 下不支持清晰度 ${requestedQuality || tier}。可选：${listed(tiers)}。`)
    }
  }
  const row = (model.sizes ?? []).find(item => item.aspect_ratio === aspect && (tier === '' || item.quality?.trim().toLowerCase() === tier))
    ?? rowForAspect
  const size = row?.size?.trim() ?? ''
  if (size === '') throw new ImageOptionError(`${model.name} 没有 ${aspect} 的像素尺寸。`)
  const mapped = tier === '' ? undefined : model.quality_map?.[tier]
  const modelId = typeof mapped === 'string' && mapped.trim() !== '' ? mapped.trim() : model.id

  const renders = (model.render_quality_options ?? []).map(item => item.toLowerCase())
  const requestedRender = typeof choice.renderQuality === 'string' ? choice.renderQuality.trim().toLowerCase() : ''
  let renderQuality: string | undefined
  if (requestedRender !== '') {
    if (!renders.includes(requestedRender)) {
      throw new ImageOptionError(`${model.name} 不支持渲染质量 ${requestedRender}。可选：${listed(renders)}。`)
    }
    renderQuality = requestedRender
  }

  const backgrounds = (model.background_options ?? []).map(item => item.toLowerCase())
  const requestedBackground = typeof choice.background === 'string' ? choice.background.trim().toLowerCase() : ''
  let background: 'transparent' | undefined
  if (requestedBackground !== '' && requestedBackground !== 'auto' && requestedBackground !== 'opaque') {
    if (requestedBackground !== 'transparent' || !backgrounds.includes('transparent')) {
      throw new ImageOptionError(`${model.name} 不支持背景 ${requestedBackground}。可选：${listed(backgrounds)}。`)
    }
    background = 'transparent'
  }

  const mode = choice.mode === 'edit' ? 'edit' : 'text'
  const formats = outputFormatsOf(model, mode)
  const requestedFormat = typeof choice.outputFormat === 'string' && choice.outputFormat.trim() !== ''
    ? choice.outputFormat.trim().toLowerCase()
    : 'png'
  if (!formats.includes(requestedFormat as ImageOutputFormat)) {
    throw new ImageOptionError(`${model.name} 不支持输出格式 ${requestedFormat}。可选：${listed(formats)}。`)
  }

  return {
    model: modelId,
    size,
    outputFormat: requestedFormat as ImageOutputFormat,
    ...renderQuality === undefined ? {} : { renderQuality },
    ...background === undefined ? {} : { background },
  }
}
