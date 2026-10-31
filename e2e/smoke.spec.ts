import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'

const ROOT = join(__dirname, '..')

/** Window names from their renderer path, e.g. ".../settings/index.html" -> "settings". */
async function openWindows(app: ElectronApplication): Promise<string[]> {
  const urls = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((win) => win.webContents.getURL())
  )
  // A window that hasn't started loading reports an empty URL.
  return urls.map((url) => /\/(\w+)\/index\.html/.exec(url)?.[1] ?? '(loading)').sort()
}

async function windowNamed(app: ElectronApplication, name: string): Promise<Page> {
  const isMatch = (page: Page) => page.url().includes(`/${name}/index.html`)
  return app.windows().find(isMatch) ?? app.waitForEvent('window', { predicate: isMatch })
}

test('launches and opens every window', async () => {
  const app = await electron.launch({
    args: ['.'],
    cwd: ROOT,
    env: {
      ...process.env,
      // Persistent so the speech model is downloaded once, not on every run.
      AMBIENTMIND_DATA_DIR: join(ROOT, '.local', 'e2e-data')
    }
  })
  const pageErrors: string[] = []
  const watch = (page: Page) => {
    page.on('pageerror', (err) => pageErrors.push(err.message))
    page.on('console', (message) => {
      if (/Content Security Policy/i.test(message.text())) pageErrors.push(message.text())
    })
  }
  app.windows().forEach(watch)
  app.on('window', watch)

  try {
    const overlay = await windowNamed(app, 'overlay')
    await expect(overlay.getByRole('button', { name: /^Show tasks, \d+ due today$|^Minimize/ })).toBeVisible()

    await expect.poll(() => openWindows(app)).toEqual(['overlay', 'quickadd'])

    await overlay.evaluate(() => window.ambient.openSettings())
    await overlay.evaluate(() => window.ambient.openChat())
    await expect.poll(() => openWindows(app)).toEqual(['chat', 'overlay', 'quickadd', 'settings'])

    for (const page of app.windows()) {
      await expect(page.locator('#root > *').first()).toBeAttached()
      await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
        'content',
        /script-src 'self';/
      )
    }
    const renderers = await app.evaluate(({ app }) =>
      app.getAppMetrics().filter((metric) => metric.type === 'Tab').map((metric) => metric.sandboxed)
    )
    expect(renderers.length).toBeGreaterThanOrEqual(4)
    expect(renderers.every(Boolean)).toBe(true)
    expect(pageErrors).toEqual([])
  } finally {
    // The overlay refuses to close, which cancels a normal quit (Phase 2 fix).
    app.process().kill('SIGKILL')
  }
})
