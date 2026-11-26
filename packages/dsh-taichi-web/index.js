/**
 * Committed package entry. `lib/` is build output, so `main` points here.
 * `npm run build` (and the desktop `web:build` step) emits `lib/index.js`.
 */
export * from './lib/index.js'
export { apply } from './lib/index.js'
