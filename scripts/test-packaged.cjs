/**
 * Installs the newest DMG the way a user would, then runs the packaged e2e
 * test against the installed copy.
 *
 * "Installed" means copied out of the mounted image into .local/install, not
 * /Applications: nothing for this project goes outside the repo.
 */
const { execFileSync, spawnSync } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } = require('node:fs')
const { join } = require('node:path')

if (process.platform !== 'darwin') {
  console.error('test:packaged installs a DMG and runs on macOS only')
  process.exit(1)
}

const ROOT = join(__dirname, '..')
const release = join(ROOT, 'release')
const dmg = readdirSync(release)
  .filter((name) => name.endsWith('.dmg'))
  .map((name) => join(release, name))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
if (!dmg) {
  console.error('No DMG in release/. Run ./dev npm run dist:mac first.')
  process.exit(1)
}

const mount = join(ROOT, '.local', 'mnt', 'dmg')
const installDir = join(ROOT, '.local', 'install')
const app = join(installDir, 'AmbientMind.app')
mkdirSync(mount, { recursive: true })
mkdirSync(installDir, { recursive: true })

console.log(`[packaged] installing ${dmg.replace(`${ROOT}/`, '')} into .local/install`)
execFileSync('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount], {
  stdio: 'ignore'
})
try {
  rmSync(app, { recursive: true, force: true })
  execFileSync('ditto', [join(mount, 'AmbientMind.app'), app])
} finally {
  execFileSync('hdiutil', ['detach', mount, '-quiet'])
}

execFileSync('codesign', ['--verify', '--deep', '--strict', app])
console.log('[packaged] installed copy passes codesign --verify --deep --strict')

const selftest = spawnSync(join(app, 'Contents', 'MacOS', 'AmbientMind'), ['--selftest'], {
  encoding: 'utf8'
})
const report = JSON.parse(selftest.stdout.slice(selftest.stdout.indexOf('{')))
for (const check of report.checks) console.log(`[packaged] ${check.ok ? 'ok  ' : 'FAIL'} ${check.name}`)
if (!report.ok) process.exit(1)

// Launched through LaunchServices, as a user would, so macOS decides who is
// responsible for the helper the same way it will in real use. Run straight
// from this script, the terminal would be responsible for everything.
const helper = join(app, 'Contents', 'MacOS', 'ambientmind-helper')
execFileSync('codesign', ['--verify', '--strict', helper])

// Without these the hardened runtime makes macOS refuse silently: no prompt,
// no row in System Settings.
const NEEDED = [
  'com.apple.security.device.audio-input',
  'com.apple.security.personal-information.calendars',
  'com.apple.security.personal-information.addressbook'
]
for (const target of [app, helper]) {
  const xml = execFileSync('codesign', ['-d', '--entitlements', '-', '--xml', target], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
  const missing = NEEDED.filter((key) => !xml.includes(`<key>${key}</key>`))
  if (missing.length > 0) {
    console.error(`[packaged] FAIL ${target} lacks ${missing.join(', ')}`)
    process.exit(1)
  }
}
console.log('[packaged] app and helper carry the privacy entitlements')
const checkDir = join(ROOT, '.local', 'e2e-helper-check')
rmSync(checkDir, { recursive: true, force: true })
mkdirSync(checkDir, { recursive: true })
spawnSync('open', ['-n', '-W', '-a', app, '--env', `AMBIENTMIND_DATA_DIR=${checkDir}`, '--args', '--helper-check'])
const checkFile = join(checkDir, 'helper-check.json')
if (!existsSync(checkFile)) {
  console.error('[packaged] FAIL helper check wrote no report')
  process.exit(1)
}
const check = JSON.parse(readFileSync(checkFile, 'utf8'))
console.log(`[packaged] ${check.ok ? 'ok  ' : 'FAIL'} helper ${check.helper?.version ?? '?'} answers for ${check.helper?.responsibleApp ?? 'nobody'}`)
for (const permission of check.permissions) {
  console.log(`[packaged]      ${permission.kind}: app ${permission.app}, helper ${permission.helper}`)
}
for (const problem of check.problems) console.error(`[packaged]      ${problem}`)
if (!check.ok) process.exit(1)

const result = spawnSync('playwright', ['test', 'e2e/packaged.spec.ts'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, AMBIENTMIND_PACKAGED_APP: join(app, 'Contents', 'MacOS', 'AmbientMind') }
})
process.exit(result.status ?? 1)
