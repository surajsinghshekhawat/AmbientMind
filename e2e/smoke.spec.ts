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
  const proc = app.process()
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

    const roles = await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.items.flatMap((item) => item.submenu?.items.map((sub) => sub.role) ?? [])
    )
    for (const role of ['copy', 'paste', 'cut', 'selectAll', 'undo']) {
      expect(roles?.map((r) => r?.toLowerCase())).toContain(role.toLowerCase())
    }

    const settings = await windowNamed(app, 'settings')
    const shortcuts = await settings.evaluate(() => window.ambient.getShortcuts())
    expect(shortcuts.map((s) => s.action).sort()).toEqual(['capture', 'chat', 'quickAdd', 'settings'])
    if (process.platform === 'darwin') {
      expect(shortcuts.every((s) => s.accelerator.startsWith('Control+Alt+'))).toBe(true)
    }
    expect(shortcuts.filter((s) => s.problem)).toEqual([])

    if (process.platform === 'darwin') {
      const dockVisible = () => app.evaluate(({ app }) => app.dock?.isVisible())
      // Settings and chat are open, so the Dock icon is too.
      await expect.poll(dockVisible).toBe(true)
      await app.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (/\/(settings|chat)\//.test(win.webContents.getURL())) win.close()
        }
      })
      await expect.poll(() => openWindows(app)).toEqual(['overlay', 'quickadd'])
      await expect.poll(dockVisible).toBe(false)
    }

    expect(pageErrors).toEqual([])

    const closed = app.waitForEvent('close', { timeout: 15_000 })
    await app.evaluate(({ app }) => setTimeout(() => app.quit(), 0))
    await closed
    expect(proc.exitCode).toBe(0)
  } finally {
    if (proc.exitCode === null) proc.kill('SIGKILL')
  }
})
