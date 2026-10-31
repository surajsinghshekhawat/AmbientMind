/**
 * Signs the Mac build with a stable local identity, without touching any
 * keychain.
 *
 * macOS keys privacy grants (microphone, screen recording) to the app's
 * designated requirement. An ad-hoc signature's requirement is its own hash,
 * so every rebuild looks like a new app and loses its grants. Signing with
 * the same certificate and a requirement pinned to it keeps them.
 *
 * codesign only reads identities from a keychain, and adding one changes the
 * user's keychain search list. rcodesign reads the certificate from files, so
 * everything stays in .local/:
 *
 *   .local/bin/rcodesign               pinned, checksum-verified
 *   .local/signing/ambientmind-dev.*   self-signed certificate and key
 *   .local/signing/designated.req      compiled designated requirement
 *
 *   node scripts/mac-sign.cjs setup    create the above (idempotent)
 *   electron-builder afterPack hook    signs the .app before dmg/zip
 */
const { execFileSync } = require('node:child_process')
const { X509Certificate } = require('node:crypto')
const {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')
const LOCAL = join(ROOT, '.local')
const RCODESIGN = join(LOCAL, 'bin', 'rcodesign')
const SIGNING = join(LOCAL, 'signing')
const CERT = join(SIGNING, 'ambientmind-dev.crt')
const KEY = join(SIGNING, 'ambientmind-dev.key')
const REQUIREMENT = join(SIGNING, 'designated.req')
const ENTITLEMENTS = join(ROOT, 'build', 'entitlements.mac.plist')
const HELPER_ENTITLEMENTS = join(ROOT, 'build', 'entitlements.helper.plist')
const SWIFT_HELPER = 'Contents/MacOS/ambientmind-helper'

const RCODESIGN_VERSION = '0.29.0'
const RCODESIGN_URL = `https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign/${RCODESIGN_VERSION}/apple-codesign-${RCODESIGN_VERSION}-macos-universal.tar.gz`

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options })
}

function ensureRcodesign() {
  if (existsSync(RCODESIGN)) return
  const dl = join(LOCAL, 'tmp', 'rcodesign-download')
  rmSync(dl, { recursive: true, force: true })
  mkdirSync(dl, { recursive: true })
  mkdirSync(join(LOCAL, 'bin'), { recursive: true })
  console.log(`[sign] downloading rcodesign ${RCODESIGN_VERSION} into .local/bin`)
  run('curl', ['-fsSL', RCODESIGN_URL, '-o', join(dl, 'r.tgz')])
  const expected = run('curl', ['-fsSL', `${RCODESIGN_URL}.sha256`]).trim().split(/\s+/)[0]
  const actual = run('shasum', ['-a', '256', join(dl, 'r.tgz')]).split(/\s+/)[0]
  if (expected !== actual) throw new Error(`rcodesign checksum mismatch: ${actual} != ${expected}`)
  run('tar', ['-xzf', join(dl, 'r.tgz'), '-C', dl])
  const dir = readdirSync(dl).find((name) => name.startsWith('apple-codesign-'))
  copyFileSync(join(dl, dir, 'rcodesign'), RCODESIGN)
  run('chmod', ['+x', RCODESIGN])
  rmSync(dl, { recursive: true, force: true })
}

/** Created once and kept: a new certificate would reset every grant. */
function ensureCertificate() {
  if (existsSync(CERT) && existsSync(KEY)) return
  mkdirSync(SIGNING, { recursive: true })
  console.log('[sign] creating the local signing certificate in .local/signing')
  run(RCODESIGN, [
    'generate-self-signed-certificate',
    '--person-name', 'AmbientMind Local Development',
    '--validity-days', '3650',
    '--pem-filename', join(SIGNING, 'ambientmind-dev')
  ])
  chmodSync(KEY, 0o600)
}

/**
 * Pinned to the certificate rather than the bundle id, so the requirement is
 * satisfied by the app and by its helpers, which carry their own ids.
 */
function ensureRequirement() {
  const fingerprint = new X509Certificate(readFileSync(CERT)).fingerprint.replace(/:/g, '')
  const set = join(SIGNING, 'designated.reqs')
  run('csreq', ['-r', `=designated => certificate leaf = H"${fingerprint}"`, '-b', set])
  // csreq writes a requirement set (0xfade0c01); rcodesign wants the single
  // designated requirement (0xfade0c00) it contains.
  const blob = readFileSync(set)
  if (blob.readUInt32BE(0) !== 0xfade0c01 || blob.readUInt32BE(12) !== 3) {
    throw new Error('csreq did not produce a designated requirement set')
  }
  const offset = blob.readUInt32BE(16)
  writeFileSync(REQUIREMENT, blob.subarray(offset, offset + blob.readUInt32BE(offset + 4)))
  rmSync(set)
  return fingerprint
}

function setup() {
  if (process.platform !== 'darwin') throw new Error('Mac signing runs on macOS only')
  ensureRcodesign()
  ensureCertificate()
  return ensureRequirement()
}

function signApp(appPath) {
  const fingerprint = setup()
  console.log(`[sign] signing ${appPath} with certificate ${fingerprint.slice(0, 12)}…`)
  run(
    RCODESIGN,
    [
      'sign',
      '--pem-file', CERT,
      '--pem-file', KEY,
      // A local certificate gains nothing from a timestamp; stay offline.
      '--timestamp-url', 'none',
      '--code-signature-flags', 'runtime',
      '--entitlements-xml-file', ENTITLEMENTS,
      '--code-requirements-file', REQUIREMENT,
      ...helperSettings(appPath),
      appPath
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  )
  run('codesign', ['--verify', '--deep', '--strict', appPath])
  console.log('[sign] verified with codesign --verify --deep --strict')
}

/**
 * Electron's helpers run V8 and capture audio too, so they get the same
 * runtime and entitlements. The Swift helper gets the runtime and only what
 * it uses.
 */
function helperSettings(appPath) {
  const frameworks = join(appPath, 'Contents', 'Frameworks')
  const electronHelpers = readdirSync(frameworks)
    .filter((name) => name.endsWith('.app'))
    .flatMap((name) => {
      const scope = `Contents/Frameworks/${name}`
      return [
        '--code-signature-flags', `${scope}:runtime`,
        '--entitlements-xml-file', `${scope}:${ENTITLEMENTS}`
      ]
    })
  const swiftHelper = existsSync(join(appPath, SWIFT_HELPER))
    ? [
        '--code-signature-flags', `${SWIFT_HELPER}:runtime`,
        '--entitlements-xml-file', `${SWIFT_HELPER}:${HELPER_ENTITLEMENTS}`
      ]
    : []
  return [...electronHelpers, ...swiftHelper]
}

/** electron-builder afterPack hook. */
async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  signApp(join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`))
}

module.exports = afterPack
module.exports.default = afterPack

if (require.main === module) {
  const [command, target] = process.argv.slice(2)
  if (command === 'setup') console.log(`[sign] ready; certificate ${setup()}`)
  else if (command === 'sign' && target) signApp(target)
  else {
    console.error('usage: node scripts/mac-sign.cjs setup | sign <path/to/App.app>')
    process.exit(1)
  }
}
