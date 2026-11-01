import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

/**
 * QA mode (docs/AGENT_QA.md, G2) launched for real: it refuses any data folder
 * outside .local/qa/runs/, and inside one every reach outside the app is
 * recorded instead of done.
 */

const ROOT = join(__dirname, '..')
const RUN = join(ROOT, '.local', 'qa', 'runs', `selftest-${Date.now()}`)
const DATA = join(RUN, 'data')
const electronBinary = require('electron') as unknown as string

test.afterAll(() => rmSync(RUN, { recursive: true, force: true }))

test('refuses to start on a data folder outside a QA run', () => {
  const outside = join(ROOT, '.local', 'e2e-data')
  const result = spawnSync(electronBinary, ['.'], {
    cwd: ROOT,
    env: { ...process.env, AMBIENTMIND_QA: '1', AMBIENTMIND_DATA_DIR: outside },
    timeout: 30_000,
    encoding: 'utf8'
  })
  expect(result.status).toBe(2)
  expect(result.stderr).toContain('refusing to start')
})

test('records every reach outside the app instead of doing it', async () => {
  mkdirSync(DATA, { recursive: true })
  writeFileSync(join(DATA, 'config.json'), JSON.stringify({ onboarded: true }))
  const app = await electron.launch({
    args: ['.'],
    cwd: ROOT,
    env: { ...process.env, AMBIENTMIND_QA: '1', AMBIENTMIND_DATA_DIR: DATA }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    const result = await app.evaluate(async ({ app: electronApp, BrowserWindow, dialog, Notification, shell }) => {
      await shell.openExternal('https://example.com/')
      await shell.openPath('/')
      new Notification({ title: 'Probe', body: 'Due now', actions: [{ type: 'button', text: 'Done' }] }).show()
      const confirm = await dialog.showMessageBox({ message: 'Forget?', buttons: ['Forget', 'Cancel'], cancelId: 1 })
      globalThis.__qa!.dialogAnswer = 'cancel'
      const cancel = await dialog.showMessageBox({ message: 'Forget?', buttons: ['Forget', 'Cancel'], cancelId: 1 })
      const outcome = async (url: string, init?: RequestInit) => {
        try {
          await fetch(url, init)
          return 'reached'
        } catch (err) {
          return (err as Error).message.startsWith('QA mode blocked') ? 'blocked' : `failed: ${(err as Error).message}`
        }
      }
      const offMachine = await outcome('https://example.com/')
      const calendarWrite = await outcome('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', body: '{}' })
      const revoke = await outcome('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token: 'x' }) })
      electronApp.setLoginItemSettings({ openAtLogin: true })
      return {
        confirm: confirm.response,
        cancel: cancel.response,
        offMachine,
        calendarWrite,
        revoke,
        kinds: globalThis.__qa!.attempts.map((a) => a.kind),
        windows: BrowserWindow.getAllWindows().map((w) => ({ opacity: w.getOpacity(), focused: w.isFocused() }))
      }
    })

    expect(result.confirm).toBe(0)
    expect(result.cancel).toBe(1)
    expect(result.offMachine).toBe('blocked')
    expect(result.calendarWrite).toBe('blocked')
    expect(result.revoke).toBe('blocked')
    for (const kind of ['shell.openExternal', 'shell.openPath', 'notification', 'network', 'app.setLoginItemSettings', 'globalShortcut.register']) {
      expect(result.kinds).toContain(kind)
    }
    expect(result.windows.length).toBeGreaterThan(0)
    for (const win of result.windows) expect(win).toEqual({ opacity: 0, focused: false })

    const fromWindow = await page.evaluate(() => fetch('https://example.com/').then(() => 'reached', () => 'blocked'))
    expect(fromWindow).toBe('blocked')

    const logged = readFileSync(join(RUN, 'attempts-app.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { kind: string })
    expect(logged[0]!.kind).toBe('qa.start')
    expect(logged.some((a) => a.kind === 'notification')).toBe(true)
  } finally {
    await app.close()
  }
})
