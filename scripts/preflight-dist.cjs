/**
 * Refuses to package while the app is running.
 *
 * `sharp` arrives transitively through @xenova/transformers and is rebuilt
 * during packaging. A running Electron process holds libgobject-2.0-0.dll
 * open, the rebuild fails with EPERM, and the error names a DLL rather than
 * the cause — which has already cost one confusing failed build. Cheaper to
 * check for the process than to recognise the symptom a second time.
 */
const { execFileSync } = require('node:child_process')

const NAMES = ['AmbientMind.exe', 'electron.exe']

function running(name) {
  try {
    const out = execFileSync('tasklist', ['/fi', `imagename eq ${name}`, '/nh'], {
      encoding: 'utf8'
    })
    return out.toLowerCase().includes(name.toLowerCase())
  } catch {
    // No tasklist means not Windows, where this particular lock does not apply.
    return false
  }
}

const found = NAMES.filter(running)

if (found.length > 0) {
  console.error(`\n  Cannot package while these are running: ${found.join(', ')}`)
  console.error('  They hold sharp\'s native DLLs open and the rebuild will fail with EPERM.')
  console.error('  Close AmbientMind (including the tray icon) and any dev instance, then retry.\n')
  process.exit(1)
}

console.log('[preflight] no running Electron processes; safe to package.')
