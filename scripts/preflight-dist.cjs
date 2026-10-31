/**
 * Checks that packaging can succeed before spending minutes on it.
 *
 * Windows: refuses while the app is running. `sharp` arrives transitively
 * through @xenova/transformers and is rebuilt during packaging. A running
 * Electron process holds libgobject-2.0-0.dll open, the rebuild fails with
 * EPERM, and the error names a DLL rather than the cause.
 *
 * macOS: refuses while the previous build in release/ is running, since its
 * bundle is about to be replaced, and makes sure the local signing identity
 * exists so the build is signed the same way every time.
 */
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

function fail(lines) {
  console.error('')
  for (const line of lines) console.error(`  ${line}`)
  console.error('')
  process.exit(1)
}

function windows() {
  const names = ['AmbientMind.exe', 'electron.exe']
  const running = names.filter((name) => {
    try {
      const out = execFileSync('tasklist', ['/fi', `imagename eq ${name}`, '/nh'], { encoding: 'utf8' })
      return out.toLowerCase().includes(name.toLowerCase())
    } catch {
      return false
    }
  })
  if (running.length > 0) {
    fail([
      `Cannot package while these are running: ${running.join(', ')}`,
      "They hold sharp's native DLLs open and the rebuild will fail with EPERM.",
      'Close AmbientMind (including the tray icon) and any dev instance, then retry.'
    ])
  }
  console.log('[preflight] no running Electron processes; safe to package.')
}

function mac() {
  const release = join(__dirname, '..', 'release')
  let pids = ''
  try {
    pids = execFileSync('pgrep', ['-f', `${release}/mac.*/AmbientMind.app/Contents/MacOS/`], {
      encoding: 'utf8'
    }).trim()
  } catch {
    // pgrep exits 1 when nothing matches.
  }
  if (pids) {
    fail([
      `The previous build is still running (pid ${pids.split('\n').join(', ')}).`,
      'Quit it from the menu bar icon first; its bundle is about to be replaced.'
    ])
  }
  execFileSync(process.execPath, [join(__dirname, 'mac-sign.cjs'), 'setup'], { stdio: 'inherit' })
  console.log('[preflight] previous build not running; signing identity ready.')
}

if (process.platform === 'win32') windows()
else if (process.platform === 'darwin') mac()
