import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type Page } from '@playwright/test'
import { activeRun, launchQa, type QaApp } from './harness'

/**
 * T3: a Windows-shaped simulation (docs/AGENT_QA.md). The renderer reads the
 * OS from the user agent, so every window gets a Windows one and each screen
 * is checked for Mac-only wording. The main process still runs on macOS, so
 * text it computes (shortcut labels, platform checks) stays Mac; the report
 * says which is which.
 */

test.skip(!activeRun(), 'needs an active QA run')
test.setTimeout(20 * 60_000)

const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) AmbientMind Chrome/130.0.0.0 Safari/537.36'
const MAC_WORDS = /\bthis Mac\b|\bmacOS\b|⌘|⌥|⌃|\bFinder\b|System Settings|menu bar|\bDock\b|Apple Intelligence|Apple Calendar|\bReminders\b|Accessibility/g

const SETTINGS = ['general', 'sources', 'ai', 'capture', 'shortcuts', 'recurring', 'learned', 'privacy', 'data', 'permissions', 'about']

async function asWindows(qa: QaApp) {
  await qa.app.evaluate(({ app, BrowserWindow }, ua) => {
    app.userAgentFallback = ua
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.setUserAgent(ua)
      w.webContents.reload()
    }
  }, WIN_UA)
  await new Promise((r) => setTimeout(r, 1500))
}

async function inspect(page: Page, screen: string, dir: string) {
  await page.waitForTimeout(700)
  const ua = await page.evaluate(() => navigator.userAgent)
  await page.screenshot({ path: join(dir, `${screen}.png`) })
  const text = await page.evaluate(() => document.body.innerText)
  const hits = [...new Set(text.match(MAC_WORDS) ?? [])]
  const lines = text.split('\n').filter((l) => MAC_WORDS.test(l)).slice(0, 8)
  MAC_WORDS.lastIndex = 0
  return { screen, windowsUa: ua.includes('Windows'), hits, lines }
}

test('T3 Windows-shaped wording pass', async () => {
  const results: unknown[] = []
  for (const profile of ['typical', 'empty']) {
    const qa = await launchQa({ mission: 't3', profile })
    const dir = join(qa.out)
    mkdirSync(dir, { recursive: true })
    try {
      await asWindows(qa)
      if (profile === 'empty') {
        const page = await qa.window('onboarding')
        for (let step = 0; step < 8 && !page.isClosed(); step++) {
          results.push(await inspect(page, `onboarding-${step}`, dir))
          const next = page.getByRole('button', { name: /^(continue|next|get started|start.*|done|finish|skip.*|not now|later)$/i }).last()
          if (!(await next.isVisible().catch(() => false))) break
          await next.click().catch(() => {})
        }
        continue
      }
      await qa.action('expand', true)
      results.push(await inspect(await qa.window('overlay'), 'overlay-expanded', dir))
      await qa.action('quickAdd')
      results.push(await inspect(await qa.window('quickadd'), 'quickadd', dir))
      await qa.action('chat')
      results.push(await inspect(await qa.window('chat'), 'chat', dir))
      for (const section of SETTINGS) {
        await qa.action('settings', section)
        results.push(await inspect(await qa.window('settings'), `settings-${section}`, dir))
      }
    } finally {
      await qa.close()
    }
  }
  const run = activeRun()!
  writeFileSync(join(run, 't3-windows.json'), JSON.stringify(results, null, 2))
})
