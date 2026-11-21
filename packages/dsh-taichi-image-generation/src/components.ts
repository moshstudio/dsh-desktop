/** Host components share configuration and queues, but own their registrations. */
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

export const COMPONENT_SERVICE = 'taichiImagegenComponents'
export const ROUTE_SERVICE = 'taichiImagegenRoutes'
export const FEATURES = ['image', 'video', 'canvas', 'gallery', 'templates', 'skills', 'ppt', 'ecommerce', 'outfit', 'prompt', 'storage', 'diagnostics'] as const
export type Feature = typeof FEATURES[number]
export interface ComponentRuntime {
  mount(feature: Feature, ctx: Context): void
}
export interface ComponentRoutes { routes: WebRoute[] }

/** Specific paths precede their containing family. Unknown endpoints stay in core. */
export function routeComponent(path: string): Feature | 'core' {
  const relative = path.replace('/api/dsh-taichi-imagegen/', '')
  if (relative.startsWith('canvas/skills/')) return 'skills'
  if (relative.startsWith('ppt/')) return 'ppt'
  if (relative.startsWith('canvas')) return 'canvas'
  if (relative.startsWith('video/') || relative.startsWith('code/')) return 'video'
  if (relative.startsWith('gallery/') || relative.startsWith('models/')) return 'gallery'
  if (relative.startsWith('templates/') || relative.startsWith('template-favorites/')) return 'templates'
  if (relative.startsWith('outfit/')) return 'outfit'
  if (relative.startsWith('ecommerce/') || relative === 'listing-copy') return 'ecommerce'
  if (relative.startsWith('prompt-enhance')) return 'prompt'
  if (relative.startsWith('storage/')) return 'storage'
  if (relative.startsWith('diagnostics/') || relative.startsWith('signals/')) return 'diagnostics'
  if (relative === 'generate' || relative === 'agent-image' || relative === 'conversation-image' || relative === 'image-models' || relative.startsWith('tasks/') || relative.startsWith('history/')) return 'image'
  return 'core'
}

/**
 * Each exported feature is a real Cordis plugin with its own disposable fiber.
 *
 * The root entry publishes its services after it has applied, and only once
 * settings and attachments exist. A loader row that injects those services
 * stays pending, and Desktop treats a pending row as a required startup
 * failure. Wait inside the row instead, so the entry itself can activate.
 */
export function featurePlugin(feature: Feature) {
  return {
    name: 'taichi-imagegen-' + feature,
    inject: ['webServer'],
    apply(ctx: Context): void {
      ctx.inject([COMPONENT_SERVICE, ROUTE_SERVICE], (featureCtx) => {
        const runtime = featureCtx.get(COMPONENT_SERVICE) as ComponentRuntime
        const routes = featureCtx.get(ROUTE_SERVICE) as ComponentRoutes
        featureCtx.effect(() => {
          const disposers: Array<() => void> = []
          try {
            for (const route of routes.routes) {
              if (routeComponent(route.path) === feature) disposers.push(featureCtx.webServer.register(route))
            }
          } catch (error) {
            for (const dispose of disposers.reverse()) dispose()
            throw error
          }
          return () => { for (const dispose of disposers.reverse()) dispose() }
        }, 'dsh-taichi-imagegen: ' + feature + ' routes')
        runtime.mount(feature, featureCtx)
      })
    },
  }
}
