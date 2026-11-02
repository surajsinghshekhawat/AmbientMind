import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { activeRun, launchQa, PageWatch, query, seed, until, type LaunchOptions, type QaApp } from './harness'

/**
 * M2: the flows people use, end to end, checked in the database and not just
 * on screen (docs/AGENT_QA.md). Every flow starts from a fresh profile copy.
 */

test.skip(!activeRun(), 'needs an active QA run')
test.setTimeout(5 * 60_000)

interface Task {
  id: string
  title: string
  status: string
  deadline: string | null
  snoozed_until: string | null
  user_edited_at: string | null
  remind_at: string | null
  source: string
}

let qa: QaApp | null = null
let watch: PageWatch | null = null
let shot = 0

async function open(options: Omit<LaunchOptions, 'mission'>) {
  const flow = test.info().title.split(' ')[0]!
  qa = await launchQa({ mission: 'm2', ...options, variant: options.variant ?? flow })
  shot = 0
  return qa
}

test.afterEach(async ({}, info) => {
  if (!qa) return
  if (info.status !== info.expectedStatus) {
    qa.candidate({ severity: 'S2', title: `Flow failed: ${info.title}`, detail: info.error?.message?.split('\n').slice(0, 6).join('\n') })
  }
  if (watch?.errors.length) qa.candidate({ severity: 'S3', title: `Console errors during ${info.title}`, detail: watch.errors.slice(0, 5) })
  await qa.close()
  qa = null
  watch = null
})

async function snap(page: Page, label: string) {
  if (!qa || page.isClosed()) return
  shot++
  await page.screenshot({ path: join(qa.out, `${String(shot).padStart(2, '0')}-${label}.png`) }).catch(() => {})
}

async function panel(app: QaApp) {
  await app.action('expand', true)
  const page = await app.window('overlay')
  watch ??= new PageWatch(page)
  const region = page.getByRole('region', { name: 'Tasks' })
  if (!(await region.waitFor({ timeout: 8000 }).then(() => true, () => false))) {
    await snap(page, 'panel-did-not-open')
    app.candidate({ severity: 'S3', title: 'The panel did not open on the first expand', evidence: [app.out] })
    await app.action('expand', true)
    await region.waitFor()
  }
  return page
}

const tasks = (app: QaApp, where: string) => query<Task>(app.dataDir, `select * from tasks where ${where}`)
const byTitle = (app: QaApp, title: string) => tasks(app, `title = '${title.replace(/'/g, "''")}'`)[0]

async function firstOpenTitle(page: Page) {
  const name = await page.getByRole('checkbox', { name: /^Complete / }).first().getAttribute('aria-label')
  return name!.replace(/^Complete /, '')
}

test('F1 quick add parses a date and lands in the list', async () => {
  const app = await open({ profile: 'typical' })
  await app.action('quickAdd')
  const page = await app.window('quickadd')
  watch = new PageWatch(page)
  const box = page.getByRole('textbox', { name: 'What needs doing?' })
  await box.fill('Call the plumber tomorrow at 10am')
  await snap(page, 'typed')
  await box.press('Enter')
  const task = await until(() => tasks(app, "title like '%plumber%'")[0], 90_000, 500)
  await snap(page, 'after')
  expect(task, 'the task was saved').toBeTruthy()
  expect(task!.status).toBe('pending')
  const due = new Date(task!.deadline!)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  expect(due.toDateString(), 'due tomorrow').toBe(tomorrow.toDateString())
  expect(due.getHours(), 'at 10').toBe(10)
  const list = await panel(app)
  await expect(list.getByRole('checkbox', { name: `Complete ${task!.title}` })).toBeVisible()
  await snap(list, 'in-list')
})

test('F2 complete a task, then undo', async () => {
  const app = await open({ profile: 'typical' })
  const page = await panel(app)
  const title = await firstOpenTitle(page)
  await page.getByRole('checkbox', { name: `Complete ${title}` }).click()
  await snap(page, 'completed')
  expect(await until(() => byTitle(app, title)?.status === 'done')).toBe(true)
  expect(query(app.dataDir, `select 1 from decisions where kind = 'completed' and title = '${title.replace(/'/g, "''")}'`).length).toBe(1)
  await page.getByRole('button', { name: 'Undo' }).click()
  await snap(page, 'undone')
  expect(await until(() => byTitle(app, title)?.status === 'pending')).toBe(true)
})

test('F3 snooze a task', async () => {
  const app = await open({ profile: 'typical' })
  const page = await panel(app)
  const title = await firstOpenTitle(page)
  await page.getByText(title, { exact: true }).click()
  await page.getByRole('button', { name: 'Snooze', exact: true }).click()
  await snap(page, 'choices')
  await page.getByRole('group', { name: 'Snooze until' }).getByRole('button').first().click()
  await snap(page, 'snoozed')
  const task = await until(() => (byTitle(app, title)?.status === 'snoozed' ? byTitle(app, title) : undefined))
  expect(task, 'snoozed in the database').toBeTruthy()
  expect(new Date(task!.snoozed_until!).getTime()).toBeGreaterThan(Date.now())
})

test('F4 accept one suggestion and dismiss another', async () => {
  const app = await open({ profile: 'typical' })
  const page = await panel(app)
  const suggested = tasks(app, "status = 'suggested'")
  expect(suggested.length).toBeGreaterThan(1)
  const accept = page.getByRole('button', { name: 'Add to tasks (Space)' })
  const row = page.locator('li', { has: accept.first() })
  const acceptedTitle = (await row.first().locator('p').first().textContent())!.trim()
  await accept.first().click()
  expect(await until(() => byTitle(app, acceptedTitle)?.status === 'pending'), `“${acceptedTitle}” accepted`).toBe(true)
  const dismissRow = page.locator('li', { has: page.getByRole('button', { name: 'Dismiss (Delete)' }) }).first()
  const dismissedTitle = (await dismissRow.locator('p').first().textContent())!.trim()
  await dismissRow.getByRole('button', { name: 'Dismiss (Delete)' }).click()
  await snap(page, 'after')
  expect(await until(() => byTitle(app, dismissedTitle)?.status === 'deleted'), `“${dismissedTitle}” dismissed`).toBe(true)
  // A dismissed suggestion counts as a delete, which is what suppression learns from.
  expect(query(app.dataDir, `select 1 from decisions where kind = 'deleted' and title = '${dismissedTitle.replace(/'/g, "''")}'`).length).toBe(1)
})

test('F5 edit a title, then delete the task', async () => {
  const app = await open({ profile: 'typical' })
  const page = await panel(app)
  const title = await firstOpenTitle(page)
  const id = byTitle(app, title)!.id
  await page.getByText(title, { exact: true }).dblclick()
  const input = page.getByRole('textbox', { name: 'Task title' })
  await input.fill(`${title} (edited by QA)`)
  await input.press('Enter')
  await snap(page, 'edited')
  const edited = await until(() => tasks(app, `id = '${id}' and title like '%(edited by QA)'`)[0])
  expect(edited, 'title saved').toBeTruthy()
  expect(edited!.user_edited_at, 'marked as edited by you').toBeTruthy()
  await page.getByText(edited!.title, { exact: true }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await snap(page, 'deleted')
  expect(await until(() => tasks(app, `id = '${id}'`)[0]?.status === 'deleted')).toBe(true)
})

test('F6 search narrows the list', async () => {
  const app = await open({ profile: 'typical' })
  const page = await panel(app)
  await page.getByRole('button', { name: /^Search/ }).click()
  await page.getByRole('searchbox', { name: 'Search tasks' }).or(page.getByRole('textbox', { name: 'Search tasks' })).fill('dentist')
  await page.waitForTimeout(400)
  await snap(page, 'search')
  const titles = await page.getByRole('checkbox', { name: /^Complete / }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!))
  expect(titles.length).toBeGreaterThan(0)
  for (const t of titles) expect(t.toLowerCase()).toContain('dentist')
})

test('F7 a due alert offers Done and Snooze 1 hour, and both work', async () => {
  const soon = new Date(Date.now() + 5 * 60_000).toISOString()
  const app = await open({
    profile: 'typical',
    prepare: (dataDir) =>
      seed(
        dataDir,
        `update tasks set deadline = '${soon}', reminded_at = null, remind_at = null where id in (select id from tasks where status = 'pending' order by title limit 2);`
      )
  })
  const due = tasks(app, `deadline = '${soon}'`)
  expect(due.length).toBe(2)
  await app.action('dueAlerts')
  const notices = await until(async () => {
    const list = await app.app.evaluate(() => (globalThis.__qa?.notifications ?? []).map((n) => ({ title: n.title, body: n.body, actions: n.actions.map((a) => a.text) })))
    return list.length >= 2 ? list : null
  })
  expect(notices, 'two notifications').toBeTruthy()
  for (const n of notices!) expect(n.actions).toEqual(['Done', 'Snooze 1 hour'])
  const first = notices!.findIndex((n) => `${n.title} ${n.body}`.includes(due[0]!.title))
  const second = notices!.findIndex((n) => `${n.title} ${n.body}`.includes(due[1]!.title))
  expect(first).toBeGreaterThanOrEqual(0)
  expect(second).toBeGreaterThanOrEqual(0)
  await app.app.evaluate((_e, [i]) => globalThis.__qa!.press(i!, 0), [first] as const)
  await app.app.evaluate((_e, [i]) => globalThis.__qa!.press(i!, 1), [second] as const)
  expect(await until(() => tasks(app, `id = '${due[0]!.id}'`)[0]?.status === 'done'), 'Done completed it').toBe(true)
  const later = await until(() => tasks(app, `id = '${due[1]!.id}' and remind_at is not null`)[0])
  expect(later, 'Snooze set a new reminder').toBeTruthy()
  const gap = new Date(later!.remind_at!).getTime() - Date.now()
  expect(gap).toBeGreaterThan(50 * 60_000)
  expect(gap).toBeLessThan(70 * 60_000)
  await app.action('dueAlerts')
  const count = await app.app.evaluate(() => globalThis.__qa!.notifications.length)
  expect(count, 'no second alert for the same tasks').toBe(notices!.length)
})

test('F8 settings changes are saved', async () => {
  const app = await open({ profile: 'typical', config: { theme: 'light' } })
  await app.action('settings', 'general')
  const page = await app.window('settings')
  watch = new PageWatch(page)
  await page.getByRole('radio', { name: 'Dark' }).click()
  const remind = page.getByRole('combobox', { name: 'Remind me' })
  const values = await remind.locator('option').evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value))
  const current = await remind.inputValue()
  const pick = values.find((v) => v !== current && v !== 'off') ?? values[0]!
  await remind.selectOption(pick)
  await page.waitForTimeout(1000)
  await snap(page, 'changed')
  const config = JSON.parse(readFileSync(join(app.dataDir, 'config.json'), 'utf8')) as { theme: string; remindBeforeMinutes: number | null }
  expect(config.theme).toBe('dark')
  expect(String(config.remindBeforeMinutes)).toBe(pick)
})

test('F9 export writes JSON with your tasks and no tokens', async () => {
  const app = await open({ profile: 'snapshot', variant: 'export', liveGoogle: true })
  await app.action('settings', 'data')
  const page = await app.window('settings')
  watch = new PageWatch(page)
  await page.getByRole('button', { name: 'Export…' }).click()
  const saved = join(dirname(app.dataDir), 'saved')
  const file = await until(() => (existsSync(saved) ? readdirSync(saved).find((f) => f.endsWith('.json')) : undefined), 15_000)
  await snap(page, 'exported')
  expect(file, 'a file was written').toBeTruthy()
  const text = readFileSync(join(saved, file!), 'utf8')
  expect(text).not.toMatch(/refresh_token|access_token|ya29\.|1\/\/0/)
  const data = JSON.parse(text) as { tasks?: unknown[] }
  const inDb = query<{ n: number }>(app.dataDir, "select count(*) n from tasks where status != 'deleted'")[0]!.n
  expect(data.tasks?.length, 'every task exported').toBe(inDb)
})

test('F10 an encrypted backup restores what was lost', async () => {
  let app = await open({ profile: 'typical', variant: 'backup' })
  await app.action('settings', 'data')
  let page = await app.window('settings')
  watch = new PageWatch(page)
  await page.getByLabel('Passphrase').fill('qa-passphrase-123')
  await page.getByRole('button', { name: 'Save backup…' }).click()
  const saved = join(dirname(app.dataDir), 'saved')
  const file = await until(() => (existsSync(saved) ? readdirSync(saved).find((f) => f.endsWith('.amb')) : undefined), 30_000)
  expect(file, 'backup written').toBeTruthy()
  const before = query<{ n: number }>(app.dataDir, "select count(*) n from tasks where status = 'pending'")[0]!.n
  // Lose something: complete three tasks.
  const list = await panel(app)
  for (let i = 0; i < 3; i++) {
    await list.getByRole('checkbox', { name: /^Complete / }).first().click()
    await list.waitForTimeout(300)
  }
  expect(await until(() => query<{ n: number }>(app.dataDir, "select count(*) n from tasks where status = 'pending'")[0]!.n === before - 3)).toBe(true)
  await app.app.evaluate((_e, [path]) => {
    globalThis.__qa!.openPath = path!
  }, [join(saved, file!)] as const)
  await app.action('settings', 'data')
  page = await app.window('settings')
  await page.getByLabel('Passphrase').fill('qa-passphrase-123')
  await page.getByRole('button', { name: 'Restore…' }).click()
  // Restoring ends the app (the restart is recorded, not done); start it again.
  expect(await until(() => app.exited(), 30_000), 'the app ended to restart').toBe(true)
  const previous = app
  app = await launchQa({ mission: 'm2', profile: 'typical', reuse: previous })
  qa = app
  const after = query<{ n: number }>(app.dataDir, "select count(*) n from tasks where status = 'pending'")[0]!.n
  expect(after, 'restored count').toBe(before)
  expect(existsSync(join(app.dataDir, 'ambientmind.before-restore.db')), 'the replaced database is kept').toBe(true)
})

test('F11 forgetting a source removes its tasks', async () => {
  const app = await open({ profile: 'typical', variant: 'forget' })
  const chat = query<{ n: number }>(app.dataDir, "select count(*) n from tasks where source = 'chat' and status != 'deleted'")[0]!.n
  expect(chat).toBeGreaterThan(0)
  await app.action('settings', 'data')
  const page = await app.window('settings')
  watch = new PageWatch(page)
  const row = page.locator('div', { has: page.getByText('Chat', { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Forget…' }) }).last()
  await row.getByRole('button', { name: 'Forget…' }).click()
  await page.waitForTimeout(1500)
  await snap(page, 'forgotten')
  expect(query<{ n: number }>(app.dataDir, "select count(*) n from tasks where source = 'chat' and status not in ('deleted')")[0]!.n).toBe(0)
})

test('F15 the policy opens from About, and erasing everything starts fresh', async () => {
  let app = await open({ profile: 'typical' })
  expect(query<{ n: number }>(app.dataDir, 'select count(*) n from tasks')[0]!.n).toBeGreaterThan(0)
  await app.action('settings', 'about')
  let page = await app.window('settings')
  watch = new PageWatch(page)
  // Privacy policy, terms, licences: the policy's Open comes first.
  await page.getByRole('button', { name: 'Open', exact: true }).first().click()
  const opened = await until(async () => (await app.attempts()).find((a) => a.kind === 'shell.openPath' && String(a.detail.path).endsWith('PRIVACY.md')))
  expect(opened, 'the privacy policy was opened').toBeTruthy()
  expect(existsSync(String(opened!.detail.path)), 'the policy file ships').toBe(true)

  await app.action('settings', 'data')
  page = await app.window('settings')
  await page.getByRole('button', { name: 'Erase…' }).click()
  const relaunch = await until(async () => (await app.attempts()).find((a) => a.kind === 'app.relaunch'))
  expect((relaunch?.detail.args as string[] | undefined) ?? [], 'restarts to erase').toContain('--erase-data')
  await app.close()

  const previous = app
  app = await launchQa({ mission: 'm2', profile: 'typical', reuse: previous, args: ['--erase-data'] })
  qa = app
  expect(query<{ n: number }>(app.dataDir, 'select count(*) n from tasks')[0]!.n, 'no tasks left').toBe(0)
  expect(existsSync(join(app.dataDir, 'secrets.json')), 'no sign-in kept').toBe(false)
  expect(existsSync(join(app.dataDir, 'google-credentials.json')), 'the Google client file stays').toBe(true)
  const configPath = join(app.dataDir, 'config.json')
  const config = existsSync(configPath) ? (JSON.parse(readFileSync(configPath, 'utf8')) as { onboarded?: boolean }) : {}
  expect(config.onboarded, 'starts with the welcome tour').not.toBe(true)
})

test('F12 onboarding can be walked start to finish', async () => {
  const app = await open({ profile: 'empty' })
  const page = await app.window('onboarding')
  watch = new PageWatch(page)
  const forward = /^(continue|next|get started|start.*|done|finish|skip.*|not now|later|open ambientmind|all set.*)$/i
  for (let i = 0; i < 15 && !page.isClosed(); i++) {
    await snap(page, `step-${i}`)
    const button = page.getByRole('button', { name: forward }).last()
    if (!(await button.isVisible().catch(() => false))) break
    await button.click().catch(() => {})
    await page.waitForTimeout(700).catch(() => {})
  }
  const config = await until(() => {
    const c = JSON.parse(readFileSync(join(app.dataDir, 'config.json'), 'utf8')) as { onboarded: boolean }
    return c.onboarded ? c : null
  }, 5000)
  expect(config?.onboarded, 'onboarding finished').toBe(true)
})

test('F13 chat answers and can add a task', async () => {
  const app = await open({ profile: 'typical' })
  await app.action('chat')
  const page = await app.window('chat')
  watch = new PageWatch(page)
  const box = page.getByRole('textbox', { name: 'Message' })
  await box.fill("What's urgent today?")
  await box.press('Enter')
  const log = page.getByRole('log')
  await expect(log).toContainText(/\w+/, { timeout: 120_000 })
  const reply = await until(async () => {
    const text = (await log.textContent()) ?? ''
    return text.length > "What's urgent today?".length + 20 ? text : null
  }, 120_000, 1000)
  await snap(page, 'answer')
  expect(reply, 'an answer arrived').toBeTruthy()
  await box.fill('Add: pay the tuition fees on Friday')
  await box.press('Enter')
  const task = await until(() => tasks(app, "title like '%tuition fee%' and status in ('pending','suggested')")[0], 120_000, 1000)
  await snap(page, 'added')
  expect(task, 'the task was added').toBeTruthy()
  expect(new Date(task!.deadline ?? 0).getDay(), 'due on a Friday').toBe(5)
})

test('F14 hostile titles render as text', async () => {
  const app = await open({ profile: 'adversarial' })
  const page = await panel(app)
  await page.getByRole('button', { name: /^Show \d+ more/ }).click().catch(() => {})
  await snap(page, 'list')
  const injected = await page.evaluate(() => document.querySelectorAll('[role=region] li script, [role=region] li img, [role=region] li b, [role=region] li iframe').length)
  expect(injected, 'no markup from titles became elements').toBe(0)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  expect(overflow, 'nothing pushes the panel sideways').toBe(false)
})
