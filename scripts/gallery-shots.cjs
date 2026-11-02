/**
 * Saves 2x screenshots of gallery sections to .local/shots for design review.
 *
 *   ./dev npm run gallery            (in another terminal)
 *   ./dev npm run gallery:shots [id ...]
 *
 * Ids are the gallery's section and state anchors (e.g. orb, a-sample-day).
 */
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { app, BrowserWindow } = require('electron')

const URL = process.env.GALLERY_URL || 'http://localhost:5199/gallery/index.html'
const OUT = join(__dirname, '..', '.local', 'shots')
const DEFAULT_IDS = ['primitives', 'orb', 'live-interactive-space-completes-s-snoozes-z-undoes-enter-opens-details', 'a-sample-day', 'all-clear']

app.commandLine.appendSwitch('force-device-scale-factor', '2')

app.whenReady().then(async () => {
  const ids = process.argv.slice(2).filter((arg) => !arg.startsWith('-') && !arg.endsWith('.cjs'))
  const win = new BrowserWindow({
    width: 1300,
    height: 4000,
    show: false,
    enableLargerThanScreen: true,
    webPreferences: { sandbox: true }
  })
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.error('[page]', event.message)
  })
  await win.loadURL(URL)
  // The dev server transforms modules on first load; wait for the gallery itself.
  for (let i = 0; i < 60; i++) {
    if (await win.webContents.executeJavaScript(`Boolean(document.getElementById('orb'))`)) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  // Let the orbs draw a few frames.
  await new Promise((resolve) => setTimeout(resolve, 1200))
  mkdirSync(OUT, { recursive: true })

  for (const id of ids.length ? ids : DEFAULT_IDS) {
    const rect = await win.webContents.executeJavaScript(`(() => {
      const el = document.getElementById(${JSON.stringify(id)})
      if (!el) return null
      el.scrollIntoView({ block: 'start' })
      const r = el.getBoundingClientRect()
      return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }
    })()`)
    if (!rect) {
      console.error(`no element #${id}`)
      continue
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
    const image = await win.webContents.capturePage(rect)
    const file = join(OUT, `${id.slice(0, 40)}.png`)
    writeFileSync(file, image.toPNG())
    console.log(file)
  }
  app.quit()
})
