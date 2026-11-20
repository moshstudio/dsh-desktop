import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'
import { assetDirectory, normalizeImage, workspaceFor } from './lib/assets.js'
import { commitImage, writerPlan } from './lib/commit.js'
import { ImageError, safeError } from './lib/errors.js'
import { gatewayConfig, generateImage, listModels, readBounded, sizeFor } from './lib/gateway.js'
import { previewImage } from './lib/preview.js'

export const name = 'dsh-taichi-image-generation'
export const inject = ['connection', 'tools', 'skills', 'systemPrompt', 'sandboxPolicy', 'sandbox', 'subprocess', 'sessionController']
export const Config = z.object({})
export const IMAGE_PROMPT_SECTION = 'tool:image-generation'
export const UNCONFIGURED_IMAGE_PROMPT = 'Do not call image_generate. Direct the user to sign in with the Taichi account. Never ask for an API key in conversation.'
export const CONFIGURED_IMAGE_PROMPT = 'For image creation, load the generate-image Skill and call image_generate. Presentations and documents may call it in parallel for multiple visuals. Reuse its PNG workspace path in PPT and Word. Image generation uses the signed-in Taichi account and its credits.'

export function imageTool(ctx, env = process.env) {
  return defineTool({
    name: 'image_generate',
    description: 'Generate one photo, illustration or background through the signed-in Taichi account and save an Office-compatible PNG in the session workspace. Load the generate-image Skill first. A presentation may call this concurrently for multiple visuals. Keep charts, tables and simple diagrams editable.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Visual subject, composition, palette, lighting, and space for document or slide text.' },
      style_context: { type: 'string', description: 'Shared brand, template and illustration style for consistency across the document.' },
      purpose: { type: 'string', enum: ['general', 'presentation', 'document', 'web', 'marketing'] },
      aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'], description: 'Target composition; actual dimensions are returned.' }
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        asset_id: { type: 'string', required: true }, workspace_path: { type: 'string', required: true },
        media_type: { type: 'string', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true },
        bytes: { type: 'integer', required: true }, sha256: { type: 'string', required: true },
        provider: { type: 'string', required: true }, model: { type: 'string', required: true }
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]
    },
    timeoutMs: 240_000,
    isConcurrencySafe: () => true,
    presentCall: args => ({ card: 'generic', kind: 'execute', title: 'Generate image', rawInput: args }),
    async execute(args, exec) {
      try {
        const root = await workspaceFor(ctx, exec)
        await assetDirectory(root)
        await writerPlan(ctx, root, exec)
        const models = await listModels(env, exec.signal)
        const selected = models.find(model => model?.show_in_picker) ?? models[0]
        const choice = sizeFor(selected, args.aspect_ratio || '1:1')
        const prompt = [args.prompt, args.style_context, args.purpose].filter(part => typeof part === 'string' && part.trim() !== '').join('\n')
        ctx.logger.info('taichi-image: generation started; model=%s size=%s', choice.model, choice.size)
        const raw = await generateImage({ prompt, model: choice.model, size: choice.size, signal: exec.signal, env })
        const image = await normalizeImage(raw)
        if (await workspaceFor(ctx, exec) !== root) throw new Error('workspace changed')
        const asset = await commitImage(ctx, root, image.data, exec)
        ctx.logger.info('taichi-image: generation saved; model=%s sha256=%s', choice.model, asset.sha256)
        return { ...asset, asset_id: `sha256:${asset.sha256}`, media_type: 'image/png', width: image.width, height: image.height, bytes: image.data.length, provider: 'taichi', model: choice.model }
      } catch (error) {
        const safe = safeError(error)
        ctx.logger.info('taichi-image: generation failed; code=%s', safe.code)
        throw safe
      }
    }
  })
}

// Cordis calls apply(ctx, config). The validated config is an empty object and
// must not replace the host environment that carries the Taichi session.
export async function apply(ctx, _config, env = process.env) {
  const jsonResponse = async (run) => {
    try {
      return Response.json(await run(), { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      const safe = safeError(error)
      return Response.json({ code: safe.code, error: safe.message }, { status: safe.status, headers: { 'Cache-Control': 'no-store' } })
    }
  }
  const registerJson = (path, methods, fetch) => ctx.connection.fetch.register({ path, methods, requestBody: 'buffered', fetch })
  registerJson('/api/taichi-image.models', ['GET'], () => jsonResponse(async () => {
    if (!gatewayConfig(env).signedIn) return { signedIn: false, models: [] }
    return { signedIn: true, models: await listModels(env) }
  }))
  registerJson('/api/taichi-image.generate', ['POST'], request => jsonResponse(async () => {
    const input = JSON.parse((await readBounded(request, 64 * 1024, request.signal)).toString('utf8'))
    const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : ''
    const model = typeof input?.model === 'string' ? input.model.trim() : ''
    const size = typeof input?.size === 'string' ? input.size.trim() : ''
    if (!prompt || !model || !size) throw new ImageError('REQUEST', 'Choose a prompt, model and size.', 400)
    const raw = await generateImage({ prompt, model, size, signal: request.signal, env })
    const image = await normalizeImage(raw)
    return { media_type: 'image/png', width: image.width, height: image.height, b64_json: image.data.toString('base64') }
  }))
  registerJson('/api/taichi-image.preview', ['GET'], request => previewImage(ctx, request))
  ctx.tools.register(imageTool(ctx, env))
  const locator = new URL('./skills/generate-image/SKILL.md', import.meta.url)
  const candidate = {
    name: 'generate-image',
    description: 'Create reusable photos, illustrations and backgrounds for presentations, documents and other image requests with the Taichi image_generate tool.',
    invocation: { modelInvocable: true, userInvocable: true },
    provider: name,
    source: 'bundled',
    rank: BUNDLED_SKILL_RANK,
    locator,
    resourceBase: { kind: 'directory', path: fileURLToPath(new URL('.', locator)) }
  }
  ctx.skills.registerProvider(() => ({
    name,
    list: async () => [candidate],
    get: async selected => selected.name === candidate.name
      ? { ...candidate, content: (await readFile(locator, 'utf8')).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '').trim() }
      : undefined
  }))
  ctx.systemPrompt.section({ name: IMAGE_PROMPT_SECTION, order: 114, text: UNCONFIGURED_IMAGE_PROMPT })
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next()
    const text = gatewayConfig(env).signedIn ? CONFIGURED_IMAGE_PROMPT : UNCONFIGURED_IMAGE_PROMPT
    return {
      ...assembly,
      sections: assembly.sections.map(section => section.name === IMAGE_PROMPT_SECTION ? { ...section, text } : section)
    }
  })
}
