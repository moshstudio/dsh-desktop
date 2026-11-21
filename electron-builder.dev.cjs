const packageJson = require('./package.json')

module.exports = {
  ...packageJson.build,
  appId: 'io.taichi.dsh.dev',
  productName: '太极-dsh Dev',
  directories: {
    ...packageJson.build.directories,
    output: 'dist-dev'
  },
  extraMetadata: {
    name: 'dsh-desktop-dev',
    productName: '太极-dsh Dev',
    dshDesktopChannel: 'development'
  },
  artifactName: 'dsh-desktop-dev-${os}-${arch}.${ext}',
  win: {
    ...packageJson.build.win,
    executableName: 'taichi-dsh Dev'
  },
  linux: {
    ...packageJson.build.linux,
    executableName: 'taichi-dsh-dev',
    artifactName: 'dsh-desktop-dev-linux-${arch}-${version}.${ext}'
  },
  nsis: {
    ...packageJson.build.nsis,
    artifactName: 'dsh-desktop-dev-windows-${arch}-setup.${ext}'
  },
  publish: null
}
