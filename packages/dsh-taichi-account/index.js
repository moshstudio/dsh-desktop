/**
 * Committed package entry. `lib/` is build output and is not part of a source
 * checkout, so `main` points here and the built host module lives behind it.
 * `npm run build` (and the desktop `account:build` step) emits `lib/index.js`.
 */
export * from './lib/index.js'
export { apply } from './lib/index.js'
