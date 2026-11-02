/**
 * Builds the copy you hand to other people:
 *
 *   ./dev npm run dist:release -- --mac     (or --win)
 *
 * AMBIENTMIND_RELEASE=1 compiles out the developer overrides (see
 * electron/devHooks.ts) and makes the afterPack hook set the Electron fuses.
 * Output goes to .local/release-public, never release/, which is where the
 * build you run day to day lives.
 */
const { spawnSync } = require('node:child_process')

const platform = process.argv.includes('--win') ? 'win' : 'mac'
const env = { ...process.env, AMBIENTMIND_RELEASE: '1' }

function step(cmd, args) {
  console.log(`[release] ${cmd} ${args.join(' ')}`)
  const result = spawnSync(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

step('node', ['scripts/require-isolation.cjs'])
step('npm', ['run', 'preflight'])
step('npm', ['run', 'notices:check'])
if (platform === 'mac') step('npm', ['run', 'helper'])
step('npm', ['run', 'build'])
step('npx', ['electron-builder', `--${platform}`, '--config.directories.output=.local/release-public'])
console.log(`[release] done: .local/release-public (${platform}, fuses set, developer overrides off)`)
