import type { UserConfig } from 'tsdown'

const config: UserConfig = {
  name: 'dsh-taichi-web',
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: true,
  outputOptions: {
    entryFileNames: '[name].js',
  },
  deps: {
    neverBundle: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-web',
      '@deepseek-ai/schemastery',
    ],
  },
}

export default config
