import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type Page } from '@playwright/test'
import { activeRun, appendJsonl, axe, hashOf, launchQa, PageWatch, type QaApp, type WindowKind } from './harness'

/**
 * M1: every screen, every control (docs/AGENT_QA.md). For each control:
 * screenshot, operate, screenshot, and note what changed, what the console
 * said and what the app tried to reach. Inputs and toggles are put back.
 */

test.skip(!activeRun(), 'needs an active QA run')
test.describe.configure({ mode: 'serial' })
test.setTimeout(45 * 60_000)

const PROFILES = (process.env.QA_PROFILES ?? 'snapshot,typical,heavy,adversarial,empty').split(',')
const THEMES = (process.env.QA_THEMES ?? 'light,dark').split(',')
const STEP_CAP = Number(process.env.QA_STEP_CAP ?? 120)
const FAMILY_CAP = 3
const ONLY = process.env.QA_SCREENS?.split(',')
/** Operated last on each screen, since they take the screen away. */
const CLOSER = /close|collapse|cancel|quit|sign out|disconnect|delete|erase|forget/i

const SETTINGS = ['general', 'sources', 'ai', 'capture', 'shortcuts', 'recurring', 'learned', 'privacy', 'data', 'permissions', 'about']

interface Screen {
  id: string
  kind: WindowKind
  open: (qa: QaApp) => Promise<void>
}

const SCREENS: Screen[] = [
  { id: 'overlay-collapsed', kind: 'overlay', open: async (qa) => void (await qa.action('expand', false)) },
  { id: 'overlay-expanded', kind: 'overlay', open: async (qa) => void (await qa.action('expand', true)) },
  { id: 'quickadd', kind: 'quickadd', open: async (qa) => void (await qa.action('quickAdd')) },
  { id: 'chat', kind: 'chat', open: async (qa) => void (await qa.action('chat')) },
  ...SETTINGS.map((section) => ({
    id: `settings-${section}`,
    kind: 'settings' as const,
    open: async (qa: QaApp) => void (await qa.action('settings', section))
  })),
  { id: 'onboarding', kind: 'onboarding', open: async (qa) => void (await qa.action('onboarding')) }
]

interface Control {
  idx: number
  key: string
  family: string
  role: string
  name: string
  tag: string
  type: string
  checked: boolean | null
}

/** Marks every visible, enabled control with data-qa-idx and describes it. */
async function enumerate(page: Page): Promise<Control[]> {
  return page.evaluate(() => {
    const selector =
      'button, a[href], input, select, textarea, [role=switch], [role=radio], [role=tab], [role=menuitem], [role=checkbox], [role=option], [tabindex]:not([tabindex="-1"])'
    // Marks from an earlier pass stay on elements that are now hidden, so a
    // number could match two elements and the click lands on neither.
    for (const old of Array.from(document.querySelectorAll<HTMLElement>('[data-qa-idx]'))) delete old.dataset.qaIdx
    const seen = new Set<Element>()
    const out: Control[] = []
    let idx = 0
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (seen.has(el)) continue
      seen.add(el)
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden' || style.display === 'none') continue
      if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') continue
      if (el.closest('[aria-hidden="true"], [inert]')) continue
      const tag = el.tagName.toLowerCase()
      const type = (el as HTMLInputElement).type ?? ''
      const role = el.getAttribute('role') ?? (tag === 'a' ? 'link' : tag === 'input' ? `input-${type}` : tag)
      const labelled = el.getAttribute('aria-labelledby')
      const labelledText = labelled
        ? labelled
            .split(' ')
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ')
        : ''
      const labelFor = el.id ? (document.querySelector(`label[for="${el.id}"]`)?.textContent ?? '') : ''
      const name = (
        el.getAttribute('aria-label') ||
        labelledText ||
        labelFor ||
        el.closest('label')?.textContent ||
        (tag === 'input' || tag === 'textarea' ? (el as HTMLInputElement).placeholder : el.textContent) ||
        el.getAttribute('title') ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
      el.dataset.qaIdx = String(idx)
      const checkedAttr = el.getAttribute('aria-checked') ?? el.getAttribute('aria-pressed')
      const checked = type === 'checkbox' || type === 'radio' ? (el as HTMLInputElement).checked : checkedAttr === null ? null : checkedAttr === 'true'
      // "Complete Pay rent", "Complete Call mum": one family, a few samples.
      const words = name.split(' ')
      const family = `${role}:${words.length > 1 ? words[0] : name}`
      out.push({ idx, key: `${role}:${name}`, family, role, name, tag, type, checked })
      idx++
    }
    return out
  })
}

async function overflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    const clipped = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => {
        if (el.children.length > 0 || !el.textContent?.trim()) return false
        const r = el.getBoundingClientRect()
        return r.right > window.innerWidth + 1 && r.width > 0
      })
      .slice(0, 5)
      .map((el) => el.textContent!.trim().slice(0, 60))
    return { horizontal: doc.scrollWidth > doc.clientWidth + 1, offscreenText: clipped }
  })
}

const PROBE_TEXT = 'QA probe ✓ <b>bold</b> 日本語'

async function operate(page: Page, control: Control): Promise<string> {
  const locator = page.locator(`[data-qa-idx="${control.idx}"]`)
  if (control.tag === 'select') {
    const original = await locator.inputValue()
    const values = await locator.locator('option').evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value))
    const next = values.find((v) => v !== original)
    if (next === undefined) return 'select: one option'
    await locator.selectOption(next)
    await page.waitForTimeout(400)
    await locator.selectOption(original).catch(() => {})
    return `select ${next} then back`
  }
  if (control.tag === 'textarea' || (control.tag === 'input' && /^(text|search|url|email|number|password|)$/.test(control.type))) {
    const original = await locator.inputValue()
    await locator.fill(control.type === 'number' ? '7' : PROBE_TEXT)
    await page.waitForTimeout(400)
    await locator.fill(original).catch(() => {})
    await locator.blur().catch(() => {})
    return 'typed then restored'
  }
  if (control.checked !== null) {
    await locator.click({ timeout: 3000 })
    await page.waitForTimeout(500)
    if (control.role !== 'radio' && control.type !== 'radio') {
      await page.locator(`[data-qa-idx="${control.idx}"]`).click({ timeout: 3000 }).catch(() => {})
      return 'toggled twice'
    }
    return 'chose'
  }
  await locator.click({ timeout: 3000 })
  return 'clicked'
}

async function exploreScreen(qa: QaApp, screen: Screen, label: string) {
  const dir = join(qa.out, screen.id)
  mkdirSync(dir, { recursive: true })
  const steps = join(dir, 'steps.jsonl')
  await screen.open(qa)
  let page = await qa.window(screen.kind)
  let watch = new PageWatch(page)
  await page.waitForTimeout(800)

  const first = await page.screenshot()
  writeFileSync(join(dir, 'screen.png'), first)
  const violations = await axe(page).catch((err) => [{ id: 'axe-failed', impact: null, help: String(err), nodes: 0, targets: [] }])
  writeFileSync(join(dir, 'axe.json'), JSON.stringify(violations, null, 2))
  for (const v of violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')) {
    qa.candidate({ severity: 'S4', title: `axe ${v.id}: ${v.help}`, screen: `${label}/${screen.id}`, evidence: [join(dir, 'axe.json')], detail: v.targets })
  }
  const flow = await overflow(page)
  if (flow.horizontal || flow.offscreenText.length) {
    qa.candidate({ severity: 'S4', title: 'Content runs off the window', screen: `${label}/${screen.id}`, evidence: [join(dir, 'screen.png')], detail: flow })
  }

  const visited = new Set<string>()
  const families = new Map<string, number>()
  let step = 0
  for (let round = 0; round < 4 && step < STEP_CAP; round++) {
    const controls = await enumerate(page)
    for (const c of controls.filter((c) => !c.name)) {
      if (visited.has(`unnamed:${c.tag}:${c.idx}`)) continue
      visited.add(`unnamed:${c.tag}:${c.idx}`)
      qa.candidate({ severity: 'S4', title: `A ${c.role} has no accessible name`, screen: `${label}/${screen.id}` })
    }
    const todo = controls
      .filter((c) => c.name && !visited.has(c.key) && (families.get(c.family) ?? 0) < FAMILY_CAP)
      .sort((a, b) => Number(CLOSER.test(a.name)) - Number(CLOSER.test(b.name)))
    if (todo.length === 0) break
    for (const target of todo) {
      if (step >= STEP_CAP) break
      // The list moves under us: find the control again by what it is.
      const current = (await enumerate(page)).find((c) => c.key === target.key)
      visited.add(target.key)
      families.set(target.family, (families.get(target.family) ?? 0) + 1)
      if (!current) continue
      step++
      const tag = String(step).padStart(4, '0')
      const before = await page.screenshot()
      const errorMark = watch.errors.length
      const attemptMark = (await qa.attempts()).length
      let outcome: string
      try {
        outcome = await operate(page, current)
      } catch (err) {
        outcome = `failed: ${(err as Error).message.split('\n')[0]}`
      }
      await page.waitForTimeout(500).catch(() => {})
      const closed = page.isClosed()
      const after = closed ? null : await page.screenshot().catch(() => null)
      const changed = after ? hashOf(before) !== hashOf(after) : true
      if (changed) {
        writeFileSync(join(dir, `${tag}-before.png`), before)
        if (after) writeFileSync(join(dir, `${tag}-after.png`), after)
      }
      const errors = watch.since(errorMark)
      const attempts = (await qa.attempts()).slice(attemptMark).map((a) => ({ kind: a.kind, blocked: a.blocked, detail: a.detail }))
      const record = { step, control: { role: current.role, name: current.name }, outcome, changed, closed, crashed: watch.crashed, errors, attempts }
      appendJsonl(steps, record)
      if (errors.length || watch.crashed) {
        qa.candidate({
          severity: watch.crashed ? 'S1' : 'S2',
          title: watch.crashed ? `Window crashed after “${current.name}”` : `Console error after “${current.name}”`,
          screen: `${label}/${screen.id}`,
          evidence: [join(dir, `${tag}-before.png`), join(dir, `${tag}-after.png`)],
          detail: errors.slice(0, 3)
        })
      }
      if (!changed && outcome === 'clicked' && attempts.length === 0) {
        qa.candidate({ severity: 'S4', title: `“${current.name}” did nothing visible`, screen: `${label}/${screen.id}`, detail: record })
      }
      // Put the screen back: the control may have closed, collapsed or navigated it.
      await page.keyboard.press('Escape').catch(() => {})
      // Reopening a window mid-close from the inspector crashes Electron (M9).
      await page.waitForEvent('close', { timeout: 500 }).catch(() => {})
      await screen.open(qa)
      await new Promise((r) => setTimeout(r, 300))
      const again = await qa.window(screen.kind)
      if (again !== page) {
        page = again
        watch = new PageWatch(page)
        await page.waitForTimeout(400)
      }
    }
  }
  return step
}

for (const profile of PROFILES) {
  for (const theme of THEMES) {
    test(`M1 explore ${profile} ${theme}`, async () => {
      const qa = await launchQa({ mission: 'm1', profile, variant: theme, config: { theme } })
      const summary: Record<string, number | string> = {}
      try {
        for (const screen of SCREENS) {
          if (profile === 'empty' && screen.id !== 'onboarding') continue
          if (ONLY && !ONLY.some((prefix) => screen.id.startsWith(prefix))) continue
          try {
            summary[screen.id] = await exploreScreen(qa, screen, `${profile}-${theme}`)
          } catch (err) {
            summary[screen.id] = `failed: ${(err as Error).message.split('\n')[0]}`
            qa.candidate({ severity: 'S2', title: `Explorer could not finish ${screen.id}`, screen: `${profile}-${theme}/${screen.id}`, detail: String(err) })
          }
        }
      } finally {
        writeFileSync(join(qa.out, 'summary.json'), JSON.stringify(summary, null, 2))
        await qa.close()
      }
    })
  }
}
