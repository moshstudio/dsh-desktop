/**
 * Standalone tsdown build for dsh-taichi-account.
 *
 * Mirrors the image-generation client bundle so this package can be written
 * in TypeScript and TSX without the dsh monorepo:
 *
 *  - Node half  -> lib/index.js (ESM, host peers stay bare)
 *  - Client half -> lib/client.js (one CJS browser bundle that registers
 *    itself via window.__ModuleLoader__.load). Platform modules resolve
 *    through the injected require; everything else is inlined. CSS Modules
 *    are compiled by lightningcss and injected as <style> tags.
 */
import { readFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve as resolvePath } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

const ID = 'dsh-taichi-account'

/** Specifiers the web shell shares into the module table. Anything else,
 *  including a future npm UI dependency, must be listed in alwaysBundle or
 *  the browser loader will see a require it cannot resolve. */
const CLIENT_EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-slots'
]

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

function cssVirtualId(absolutePath: string): string {
  return CSS_VIRTUAL_PREFIX + relative(process.cwd(), absolutePath) + CSS_VIRTUAL_SUFFIX
}

function cssRealPath(virtualId: string): string {
  return resolvePath(process.cwd(), virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length))
}

function cssRepoPath(virtualId: string): string {
  return virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
}

const nodeConfig: UserConfig = {
  name: ID,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: true,
  outputOptions: {
    entryFileNames: '[name].js'
  },
  deps: {
    neverBundle: ['@deepseek-ai/cordis']
  }
}

const clientConfig: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  // CJS otherwise ignores `platform` and targets Node. The client runs in the web shell.
  inputOptions: { platform: 'browser' },
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: [...CLIENT_EXTERNALS]
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production')
  },
  plugins: [{
    name: 'dsh-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const abs = importer === undefined ? resolvePath(source) : resolvePath(dirname(importer), source)
      return { id: cssVirtualId(abs), moduleSideEffects: true }
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = cssRealPath(virtualId)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: cssRepoPath(virtualId),
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true
      })
      const classMap: Record<string, string> = {}
      const exported = cssExports ?? {}
      for (const local of Object.keys(exported).sort()) {
        const entry = exported[local]
        if (entry !== undefined) classMap[local] = entry.name
      }
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(`${ID}/${basename(fileId)}`)};`,
        'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
        '  const tag = document.createElement(\'style\');',
        `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`
      ].join('\n')
    }
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;'
  }
}

export default [nodeConfig, clientConfig]
