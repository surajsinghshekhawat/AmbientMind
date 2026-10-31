import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

const executablePath = process.env.AMBIENTMIND_PACKAGED_APP

test.skip(!executablePath, 'run through npm run test:packaged')

test('the installed build is a menu-bar app that quits cleanly', async () => {
  const app = await electron.launch({
    executablePath: executablePath!,
    env: { ...process.env, AMBIENTMIND_DATA_DIR: join(__dirname, '..', '.local', 'e2e-data') }
  })
  const proc = app.process()
  try {
    const isOverlay = (page: Page) => page.url().includes('/overlay/index.html')
    const overlay = app.windows().find(isOverlay) ?? (await app.waitForEvent('window', { predicate: isOverlay }))
    await expect(overlay.getByRole('button', { name: /^Show tasks, \d+ due today$/ })).toBeVisible()

    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    expect(await app.evaluate(({ app }) => app.dock?.isVisible())).toBe(false)
    // LSUIElement, as LaunchServices sees it: no Dock icon, no app menu.
    const type = execFileSync('lsappinfo', ['info', '-only', 'ApplicationType', String(proc.pid)], {
      encoding: 'utf8'
    })
    expect(type).toMatch(/UIElement/)

    const closed = app.waitForEvent('close', { timeout: 15_000 })
    await app.evaluate(({ app }) => setTimeout(() => app.quit(), 0))
    await closed
    expect(proc.exitCode).toBe(0)
  } finally {
    if (proc.exitCode === null) proc.kill('SIGKILL')
  }
})
