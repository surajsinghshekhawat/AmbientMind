import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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

function helperChild(parent: number): number | null {
  try {
    const pid = Number(execFileSync('pgrep', ['-P', String(parent), '-x', 'ambientmind-helper'], { encoding: 'utf8' }).trim())
    return pid || null
  } catch {
    // pgrep exits 1 when nothing matches.
    return null
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Each run starts as a first run for onboarding, but keeps the downloaded speech model. */
function resetOnboarding(dataDir: string) {
  const file = join(dataDir, 'config.json')
  if (!existsSync(file)) return
  const config = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  delete config.onboarded
  writeFileSync(file, JSON.stringify(config, null, 2))
}

test('launches and opens every window', async () => {
  resetOnboarding(join(ROOT, '.local', 'e2e-data'))
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
    const onboarding = await windowNamed(app, 'onboarding')
    await expect(onboarding.getByRole('heading', { name: 'Meet AmbientMind' })).toBeVisible()
    await onboarding.screenshot({ path: join(ROOT, '.local', 'shots', 'onboarding-window.png') })
    await onboarding.getByRole('button', { name: 'Get started' }).click()
    for (let i = 0; i < 4; i++) await onboarding.getByRole('button', { name: /^(Continue|Skip for now)$/ }).click()
    await onboarding.getByRole('button', { name: 'Start using AmbientMind' }).click()
    await expect.poll(() => openWindows(app)).toEqual(['overlay', 'quickadd'])

    const overlay = await windowNamed(app, 'overlay')
    const orb = overlay.getByRole('button', { name: /^AmbientMind: / })
    await expect(orb).toBeVisible()

    const overlayState = () =>
      app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/overlay/'))
        return win ? { ...win.getBounds(), focusable: win.isFocusable() } : null
      })
    expect(await overlayState()).toMatchObject({ width: 64, height: 64, focusable: false })

    // Open: the window becomes the panel, sized to its content, and takes keys.
    await orb.click()
    const panel = overlay.getByRole('listbox', { name: 'Tasks' })
    await expect(panel).toBeVisible()
    await expect.poll(async () => (await overlayState())?.focusable).toBe(true)
    await expect.poll(async () => (await overlayState())?.width).toBe(380)
    // offsetHeight, not the bounding box: the opening animation scales the card.
    const panelHeight = await panel.evaluate((el) => (el as HTMLElement).offsetHeight)
    await expect.poll(async () => (await overlayState())?.height).toBe(Math.ceil(panelHeight) + 2)
    await overlay.screenshot({ path: join(ROOT, '.local', 'shots', 'overlay-panel.png') })

    await panel.press('Escape')
    await expect(orb).toBeVisible()
    await expect.poll(overlayState).toMatchObject({ width: 64, height: 64, focusable: false })

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

    await expect(settings.getByRole('navigation', { name: 'Settings' })).toBeVisible()
    await settings.screenshot({ path: join(ROOT, '.local', 'shots', 'settings-window.png') })
    const rebound = await settings.evaluate(async () => {
      await window.ambient.setConfig({ shortcuts: { chat: 'Control+Alt+K' } })
      const after = await window.ambient.getShortcuts()
      await window.ambient.setConfig({ shortcuts: {} })
      return after.find((s) => s.action === 'chat')?.accelerator
    })
    expect(rebound).toBe('Control+Alt+K')
    expect((await settings.evaluate(() => window.ambient.getShortcuts())).find((s) => s.action === 'chat')?.accelerator).toBe(
      shortcuts.find((s) => s.action === 'chat')?.accelerator
    )

    const chat = await windowNamed(app, 'chat')
    await expect(chat.getByRole('textbox', { name: 'Message' })).toBeFocused()
    await chat.screenshot({ path: join(ROOT, '.local', 'shots', 'chat-window.png') })
    await chat.getByRole('button', { name: 'Close (Esc)' }).click()
    await expect.poll(() => openWindows(app)).toEqual(['overlay', 'quickadd', 'settings'])
    await overlay.evaluate(() => window.ambient.openChat())
    await expect.poll(() => openWindows(app)).toEqual(['chat', 'overlay', 'quickadd', 'settings'])

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

    let helperPid: number | null = null
    if (process.platform === 'darwin') {
      // The Swift helper runs as the app's child and leaves with it.
      await expect.poll(() => helperChild(proc.pid!)).not.toBeNull()
      helperPid = helperChild(proc.pid!)
      const kinds = (await overlay.evaluate(() => window.ambient.getPermissions())).map((p) => p.kind)
      expect(kinds).toEqual(['microphone', 'screen', 'accessibility'])
      // Main asks the helper which voice engine to use once it is up.
      await expect.poll(async () => (await overlay.evaluate(() => window.ambient.speech.engine())).apple).not.toBeNull()
    }

    expect(pageErrors).toEqual([])

    const closed = app.waitForEvent('close', { timeout: 15_000 })
    await app.evaluate(({ app }) => setTimeout(() => app.quit(), 0))
    await closed
    expect(proc.exitCode).toBe(0)
    if (helperPid) await expect.poll(() => alive(helperPid!)).toBe(false)
  } finally {
    if (proc.exitCode === null) proc.kill('SIGKILL')
  }
})
