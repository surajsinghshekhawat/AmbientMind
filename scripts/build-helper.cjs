/**
 * Builds the Swift helper (native/mac-helper) with every SwiftPM cache,
 * config and build product inside .local/. A no-op off macOS.
 *
 *   node scripts/build-helper.cjs           release build
 *   node scripts/build-helper.cjs --debug   debug build
 *
 * Prints the path of the built binary.
 */
const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')
const LOCAL = join(ROOT, '.local')
const PACKAGE = join(ROOT, 'native', 'mac-helper')
const SCRATCH = join(LOCAL, 'build', 'mac-helper')

function helperPath(configuration = 'release') {
  return join(SCRATCH, configuration, 'ambientmind-helper')
}

function build(configuration = 'release') {
  if (process.platform !== 'darwin') {
    console.log('[helper] not macOS; nothing to build')
    return null
  }
  const swiftpm = join(LOCAL, 'cache', 'swiftpm')
  for (const dir of [SCRATCH, swiftpm, join(LOCAL, 'home', 'swiftpm', 'config'), join(LOCAL, 'home', 'swiftpm', 'security')]) {
    mkdirSync(dir, { recursive: true })
  }
  execFileSync(
    'swift',
    [
      'build',
      '--package-path', PACKAGE,
      '--configuration', configuration,
      '--arch', 'arm64',
      '--scratch-path', SCRATCH,
      '--cache-path', swiftpm,
      '--config-path', join(LOCAL, 'home', 'swiftpm', 'config'),
      '--security-path', join(LOCAL, 'home', 'swiftpm', 'security'),
      '--manifest-cache', 'local',
      // The manifest sandbox nests sandbox-exec, which an outer sandbox refuses.
      '--disable-sandbox'
    ],
    {
      stdio: 'inherit',
      env: { ...process.env, CLANG_MODULE_CACHE_PATH: join(LOCAL, 'cache', 'clang') }
    }
  )
  const binary = helperPath(configuration)
  if (!existsSync(binary)) throw new Error(`swift build finished but ${binary} is missing`)
  return binary
}

module.exports = { build, helperPath }

if (require.main === module) {
  const binary = build(process.argv.includes('--debug') ? 'debug' : 'release')
  if (binary) console.log(binary)
}
