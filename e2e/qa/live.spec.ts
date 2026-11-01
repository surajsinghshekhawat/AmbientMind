import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { AppleEvent, AppleReminder } from '../../shared/helperProtocol'
import type { ChatReply, HealthReport, Task } from '../../shared/types'
import { appendJsonl, query, until } from './harness'
import { launchLive, type LiveApp } from './live'

/**
 * The live mission (docs/AGENT_QA.md): real Gmail and Calendar read, writes
 * only to things named "AmbientMind QA", all deleted at the end. macOS asks
 * once each for Reminders and Calendar; someone at the Mac clicks Allow.
 */

const QA = 'AmbientMind QA'
const PREFIX = 'QA live:'
/** Keeps a second run's folders apart from the first's. */
const TAG = process.env.QA_LIVE_TAG ? `-${process.env.QA_LIVE_TAG}` : ''
test.skip(process.env.QA_LIVE !== '1', 'Touches your real accounts; run with QA_LIVE=1')
test.describe.configure({ mode: 'serial', timeout: 15 * 60_000 })

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()

interface Decision {
  subject: string
  decision: 'skipped' | 'task' | 'not a task'
  reason?: string
  gmailCategory?: string[]
  snippet?: string
  tasks?: { title: string; status: string; priority: string; deadline: string | null; confidence: number; evidence: string | null }[]
}

/** Forces a Gmail pass and reads back what was decided for each message. */
async function classifyMail(app: LiveApp, label: string) {
  const started = Date.now()
  const report = await app.action<Record<string, unknown>>('syncNow')
  const ms = Date.now() - started
  const decisions: Decision[] = []
  for (const line of app.log()) {
    const skip = line.match(/^\[sync\] skip "(.*)": (.*)$/)
    if (skip) decisions.push({ subject: skip[1]!, decision: 'skipped', reason: skip[2]! })
    const read = line.match(/^\[sync\] extract "(.*)" as .*: (\d+) task/)
    if (read) decisions.push({ subject: read[1]!, decision: Number(read[2]) > 0 ? 'task' : 'not a task' })
  }
  const rows = query<{ subject: string; title: string; status: string; priority: string; deadline: string | null; confidence: number; evidence: string | null }>(
    app.dataDir,
    `select substr(raw_context, 1, instr(raw_context || char(10), char(10)) - 1) as subject,
            title, status, priority, deadline, confidence, evidence
       from tasks where source = 'gmail'`
  )
  // Gmail's own categories for each message, to set beside the decision.
  const categories = new Map<string, { labels: string[]; snippet: string }>()
  for (const { source_id: id } of query<{ source_id: string }>(app.dataDir, "select source_id from processed_messages where source = 'gmail'")) {
    const meta = await app.action<{ body: { labelIds?: string[]; snippet?: string; payload?: { headers?: { name: string; value: string }[] } } | null }>(
      'googleGet',
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject`
    )
    const subject = meta.body?.payload?.headers?.find((h) => h.name === 'Subject')?.value ?? ''
    const labels = (meta.body?.labelIds ?? []).filter((l) => l.startsWith('CATEGORY_')).map((l) => l.slice(9).toLowerCase())
    categories.set(subject, { labels, snippet: meta.body?.snippet ?? '' })
  }
  for (const d of decisions) {
    const tasks = rows.filter((row) => row.subject === d.subject).map(({ subject: _, ...task }) => task)
    if (tasks.length) d.tasks = tasks
    const gmail = categories.get(d.subject)
    d.gmailCategory = gmail?.labels ?? []
    // Skipped by a header although Gmail filed it as personal: worth a look.
    if (gmail && d.decision === 'skipped' && d.gmailCategory.includes('personal')) d.snippet = gmail.snippet
  }
  writeFileSync(join(app.out, `gmail-${label}.json`), JSON.stringify({ ms, report, decisions }, null, 2))
  return { ms, report, decisions, tasks: rows.length }
}

test.describe('live: Apple model', () => {
  let app: LiveApp
  let listId = ''
  const results: Record<string, unknown> = {}
  const note = (step: string, outcome: unknown) => {
    results[step] = outcome
    appendJsonl(join(app.out, 'live-results.jsonl'), { at: new Date().toISOString(), step, outcome })
  }
  const tasks = () => app.api<Task[]>('ambient.getTasks()')
  const findTask = async (title: string) => (await tasks()).find((t) => t.title === title)
  const reminders = async () => (await app.action<{ reminders: AppleReminder[] }>('helper', 'reminders.list', { listId })).reminders

  test.beforeAll(async () => {
    app = await launchLive(`apple${TAG}`, { aiEngine: 'apple' })
  })

  test.afterAll(async () => {
    if (!app) return
    const cleanup: Record<string, unknown> = {}
    // Sources off first, or the next pass makes the list again.
    for (const source of ['reminders', 'calendar']) {
      cleanup[`${source} off`] = await app.api(`ambient.appleSources.set('${source}', false)`).then(() => 'ok', (e: Error) => e.message)
    }
    await app.api('ambient.setConfig({ calendarWriteBack: false })').catch(() => {})
    cleanup.remindersList = await app.action('helper', 'qa.reminders.deleteList').catch((e: Error) => e.message)
    cleanup.appleCalendar = await app.action('helper', 'qa.calendar.delete').catch((e: Error) => e.message)
    const attempts = await app.action<{ kind: string; detail: { id?: string } }[]>('attempts').catch(() => [])
    const googleIds = [...new Set(attempts.filter((a) => a.kind === 'qa.liveCalendar').map((a) => a.detail.id!))]
    cleanup.googleCalendars = await Promise.all(
      googleIds.map((id) => app.action<{ status: number }>('googleCalendar', `/calendars/${encodeURIComponent(id)}`, 'DELETE').then((r) => r.status, (e: Error) => e.message))
    )
    // A second pass finds nothing left.
    cleanup.leftovers = {
      reminders: await app.action('helper', 'qa.reminders.deleteList').catch((e: Error) => e.message),
      calendar: await app.action('helper', 'qa.calendar.delete').catch((e: Error) => e.message)
    }
    note('cleanup', cleanup)
    await app.close()
    writeFileSync(join(app.out, 'live-results.json'), JSON.stringify(results, null, 2))
  })

  test('starts with the real helper, attributed to the QA app', async () => {
    const ready = await until(() => app.log().some((l) => l.includes('[helper] ready')), 20_000)
    const health = await app.api<HealthReport>('ambient.getHealth()')
    const perms = await app.action('helper', 'perms.status', { kinds: ['reminders', 'calendar'] })
    const accounts = await app.api<{ google: boolean }>('ambient.accounts.status()')
    note('health', { helperReady: ready, ai: health.ai, problems: health.problems, google: accounts.google, perms })
    await app.action('screenshot', 'overlay', join(app.out, 'shots', 'overlay-start.png'))
    expect(ready).toBe(true)
    expect(accounts.google).toBe(true)
  })

  test('reads Gmail and sorts task from not-task with the Apple model', async () => {
    const result = await classifyMail(app, 'apple')
    const counts = { skipped: 0, task: 0, 'not a task': 0 }
    for (const d of result.decisions) counts[d.decision]++
    note('gmail.apple', { ms: result.ms, report: result.report, counts, tasks: result.tasks })
    expect(result.decisions.length).toBeGreaterThan(0)
  })

  test('Reminders: the QA list follows tasks both ways', async () => {
    const status = await app.api<{ reminders: { enabled: boolean; list: string | null; access: string; lastError: string | null } }>(
      "ambient.appleSources.set('reminders', true)"
    )
    const list = await app.action<{ id: string; title: string; account: string }>('helper', 'reminders.ensureList', { title: QA })
    listId = list.id
    const steps: Record<string, unknown> = { access: status.reminders.access, list: `${list.title} · ${list.account}` }
    expect(status.reminders.enabled).toBe(true)

    // Suggestions from mail stay out of Reminders until accepted.
    const before = await reminders()
    steps.onlyQaTasksPushed = before.every((r) => r.title.startsWith(PREFIX))

    const paper = `${PREFIX} buy printer paper`
    await app.api(`ambient.addTask(${JSON.stringify(paper)})`)
    steps.appToReminders = !!(await until(async () => (await reminders()).some((r) => r.title === paper), 30_000, 1000))

    const paperTask = await findTask(paper)
    if (paperTask) await app.api(`ambient.completeTask(${JSON.stringify(paperTask.id)})`)
    steps.completeFollows = !!(await until(async () => (await reminders()).find((r) => r.title === paper)?.completed, 30_000, 1000))

    const dentist = `${PREFIX} call the dentist`
    const made = await app.action<AppleReminder>('helper', 'reminders.upsert', { listId, title: dentist, due: inHours(26) })
    steps.remindersToApp = !!(await until(async () => (await findTask(dentist))?.source === 'reminders', 60_000, 1000))

    const renamed = `${PREFIX} call the dentist about Tuesday`
    await app.action('helper', 'reminders.upsert', { id: made.id, title: renamed })
    steps.renameFollows = !!(await until(async () => !!(await findTask(renamed)), 60_000, 1000))

    await app.action('helper', 'reminders.delete', { id: made.id })
    steps.deleteInRemindersFollows = !!(await until(async () => !(await findTask(renamed)), 60_000, 1000))

    const book = `${PREFIX} return the library book`
    await app.api(`ambient.addTask(${JSON.stringify(book)})`)
    await until(async () => (await reminders()).some((r) => r.title === book), 30_000, 1000)
    const bookTask = await findTask(book)
    if (bookTask) await app.api(`ambient.deleteTask(${JSON.stringify(bookTask.id)})`)
    steps.deleteInAppFollows = !!(await until(async () => !(await reminders()).some((r) => r.title === book), 30_000, 1000))

    steps.lastError = (await app.api<{ reminders: { lastError: string | null } }>('ambient.appleSources.status()')).reminders.lastError
    await app.api("ambient.appleSources.set('reminders', false)")
    note('reminders', steps)
    for (const key of ['onlyQaTasksPushed', 'appToReminders', 'completeFollows', 'remindersToApp', 'renameFollows', 'deleteInRemindersFollows', 'deleteInAppFollows']) {
      expect.soft(steps[key], key).toBe(true)
    }
  })

  test('Apple Calendar: reads events, prep tasks only for meetings with people', async () => {
    const status = await app.api<{ calendar: { enabled: boolean; access: string } }>("ambient.appleSources.set('calendar', true)")
    expect(status.calendar.enabled).toBe(true)
    const solo = `${PREFIX} solo focus block`
    const created = await app.action<{ calendarId: string; account: string; events: string[] }>('helper', 'qa.calendar.create', {
      events: [{ title: solo, start: inHours(3), end: inHours(4) }]
    })
    const { events } = await app.action<{ events: AppleEvent[] }>('helper', 'calendar.events', { from: new Date().toISOString(), to: inHours(24) })
    const withPeople = events.filter((e) => !e.cancelled && !e.recurring && !e.allDay && e.attendees.some((a) => !a.me && !a.resource))
    await new Promise((r) => setTimeout(r, 5000))
    const prep = (await tasks()).filter((t) => t.source === 'acalendar')
    const steps = {
      testCalendar: `${QA} · ${created.account}`,
      readsTestEvent: events.some((e) => e.title === solo && e.calendar === QA),
      eventsNext24h: events.length,
      meetingsWithPeople: withPeople.length,
      prepTasks: prep.length,
      noPrepForSolo: !prep.some((t) => t.title.includes(solo)),
      everyPrepIsAMeeting: prep.every((t) => withPeople.some((e) => t.title === `Prepare for ${e.title.trim()}`))
    }
    note('appleCalendar', steps)
    expect.soft(steps.readsTestEvent, 'reads the test event').toBe(true)
    expect.soft(steps.noPrepForSolo, 'no prep task for a solo block').toBe(true)
    expect.soft(steps.everyPrepIsAMeeting, 'every prep task is a meeting with people').toBe(true)
    await app.api("ambient.appleSources.set('calendar', false)")
  })

  test('Google write-back: a routine appears in the QA calendar and goes with it', async () => {
    await app.api('ambient.setConfig({ calendarWriteBack: true })')
    const health = await app.api<HealthReport>('ambient.getHealth()')
    const scopeProblem = health.problems.find((p) => /calendar/i.test(p) && /reconnect|permission|access/i.test(p)) ?? null
    const title = `${PREFIX} water the plants`
    const { rule } = await app.api<{ rule: { id: string } }>(
      `ambient.rules.add({ title: ${JSON.stringify(title)}, weekdays: [1, 3, 5], time: '09:00', priority: 'medium', leadMinutes: 0, enabled: true, source: 'explicit' })`
    )
    const calendarId = await until(async () => {
      const attempts = await app.action<{ kind: string; detail: { id?: string } }[]>('attempts')
      return attempts.find((a) => a.kind === 'qa.liveCalendar')?.detail.id ?? null
    }, 30_000, 1000)
    const steps: Record<string, unknown> = { scopeProblem, calendarMade: !!calendarId }
    if (calendarId) {
      const events = (path: string) => app.action<{ status: number; body: { items?: { summary: string; recurrence?: string[] }[] } | null }>('googleCalendar', path)
      const path = `/calendars/${encodeURIComponent(calendarId)}/events`
      const found = await until(async () => (await events(path)).body?.items?.find((e) => e.summary === title), 30_000, 2000)
      steps.eventCreated = !!found
      steps.recurrence = found?.recurrence ?? null
      await app.api(`ambient.rules.remove(${JSON.stringify(rule.id)})`)
      steps.eventRemoved = !!(await until(async () => !(await events(path)).body?.items?.some((e) => e.summary === title), 30_000, 2000))
    } else {
      await app.api(`ambient.rules.remove(${JSON.stringify(rule.id)})`)
      steps.log = app.log().filter((l) => /calendar/i.test(l)).slice(-5)
    }
    note('googleWriteBack', steps)
    if (!scopeProblem) {
      expect.soft(steps.eventCreated, 'event created').toBe(true)
      expect.soft(steps.eventRemoved, 'event removed').toBe(true)
    }
  })

  test('everyday functions: quick add, snooze, due alert, pause, chat', async () => {
    const steps: Record<string, unknown> = {}
    const quick = `${PREFIX} send the invoice to Acme by Friday 5pm, urgent`
    await app.api(`ambient.quickAdd.submit(${JSON.stringify(quick)})`, 'overlay')
    const added = await until(async () => (await tasks()).find((t) => t.title.startsWith(`${PREFIX} send the invoice`)), 30_000, 500)
    steps.quickAdd = added ? { title: added.title, deadline: added.deadline, priority: added.priority } : null

    if (added) {
      await app.api(`ambient.snoozeTask(${JSON.stringify(added.id)}, ${JSON.stringify(inHours(1))})`)
      steps.snoozeHides = !(await tasks()).some((t) => t.id === added.id && t.status !== 'snoozed')
      await app.api(`ambient.reopenTask(${JSON.stringify(added.id)})`).catch(() => {})
    }

    const soon = `${PREFIX} join the standup`
    await app.api(`ambient.addTask(${JSON.stringify(soon)})`)
    const soonTask = await findTask(soon)
    if (soonTask) await app.api(`ambient.updateTask(${JSON.stringify(soonTask.id)}, { deadline: ${JSON.stringify(inHours(0.1))} })`)
    await app.action('dueAlerts')
    const attempts = await app.action<{ kind: string; detail: { title?: string; body?: string } }[]>('attempts')
    steps.dueAlert = attempts.some((a) => a.kind === 'notification' && JSON.stringify(a.detail).includes('standup'))

    await app.api(`ambient.setConfig({ pauseAiUntil: ${JSON.stringify(inHours(1))} })`)
    // The scheduled sync may be mid-pass; wait for it rather than read its "in progress".
    const paused = await until(async () => {
      const report = await app.action<{ errors?: string[] }>('syncNow')
      return report.errors?.some((e) => /in progress/i.test(e)) ? null : report
    }, 120_000, 2000)
    steps.pauseStopsSync = JSON.stringify(paused).toLowerCase().includes('pause')
    await app.api('ambient.setConfig({ pauseAiUntil: null })')

    const started = Date.now()
    const reply = await app.api<ChatReply>("ambient.chat('What is due soonest?', [])")
    const text = reply.reply
    steps.chat = { ms: Date.now() - started, mentionsATask: /standup|invoice|dentist|paper/i.test(text), length: text.length }
    writeFileSync(join(app.out, 'chat-reply.txt'), text)

    await app.action('expand', true)
    await app.action('screenshot', 'overlay', join(app.out, 'shots', 'overlay-expanded.png'))
    note('everyday', steps)
    expect.soft(steps.quickAdd, 'quick add made a task').not.toBeNull()
    expect.soft(steps.dueAlert, 'due alert fired').toBe(true)
    expect.soft(steps.pauseStopsSync, 'pause stops sync').toBe(true)
  })
})

test.describe('live: Ollama', () => {
  test('reads Gmail and sorts task from not-task with Ollama', async () => {
    const url = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11435'
    const up = await fetch(`${url}/api/tags`).then((r) => r.ok, () => false)
    test.skip(!up, 'Ollama is not running: ./dev ollama start')
    const app = await launchLive(`ollama${TAG}`, { aiEngine: 'ollama' })
    try {
      const result = await classifyMail(app, 'ollama')
      const counts = { skipped: 0, task: 0, 'not a task': 0 }
      for (const d of result.decisions) counts[d.decision]++
      appendJsonl(join(app.out, 'live-results.jsonl'), { at: new Date().toISOString(), step: 'gmail.ollama', outcome: { ms: result.ms, counts, tasks: result.tasks } })
      expect(result.decisions.length).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })
})
