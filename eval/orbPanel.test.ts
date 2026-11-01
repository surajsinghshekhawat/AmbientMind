import assert from 'node:assert/strict'
import test from 'node:test'
import { orbLook } from '../shared/orb'
import { allClearLine, confidenceLabel, matchesQuery, panelSections, safeSourceUrl } from '../shared/panel'
import type { Task } from '../shared/types'

const HOUR = 3_600_000
/** Local noon, so "today" has room on both sides. */
const NOW = new Date(2026, 10, 2, 12, 0, 0).getTime()
const at = (hours: number) => new Date(NOW + hours * HOUR).toISOString()

let seq = 0
function task(partial: Partial<Task> = {}): Task {
  seq += 1
  return {
    id: `t${seq}`,
    title: `Task ${seq}`,
    deadline: null,
    priority: 'medium',
    source: 'manual',
    sourceId: null,
    people: [],
    rawContext: null,
    confidence: 1,
    status: 'pending',
    createdAt: new Date(0).toISOString(),
    completedAt: null,
    snoozedUntil: null,
    sourceUrl: null,
    evidence: null,
    ...partial
  }
}

test('an idle orb with nothing open breathes calmly and says so', () => {
  const look = orbLook({ tasks: [], now: NOW, activity: 'idle', attention: false })
  assert.equal(look.motion, 'breathing')
  assert.equal(look.calm, true)
  assert.equal(look.arc, null)
  assert.equal(look.badge, null)
  assert.equal(look.peek, 'Nothing due')
})

test('the badge counts overdue and due today, never the total', () => {
  const tasks = [
    task({ deadline: at(-3) }),
    task({ deadline: at(2) }),
    task({ deadline: at(24 * 5) }),
    task({}),
    task({ deadline: at(-1), status: 'done' })
  ]
  const look = orbLook({ tasks, now: NOW, activity: 'idle', attention: false })
  assert.equal(look.badge, 2)
  assert.equal(look.arc, 'overdue')
})

test('the arc shows the most pressing open task', () => {
  const soon = orbLook({ tasks: [task({ deadline: at(48) })], now: NOW, activity: 'idle', attention: false })
  assert.equal(soon.arc, 'approaching')
  const today = orbLook({ tasks: [task({ deadline: at(5) }), task({ deadline: at(48) })], now: NOW, activity: 'idle', attention: false })
  assert.equal(today.arc, 'urgent')
})

test('activity drives the motion and the peek line', () => {
  const look = orbLook({ tasks: [task({ deadline: at(1) })], now: NOW, activity: 'syncing', attention: false })
  assert.equal(look.motion, 'connecting')
  assert.equal(look.calm, false)
  assert.equal(look.peek, 'Checking mail and calendar…')
  assert.equal(orbLook({ tasks: [], now: NOW, activity: 'reading', attention: false }).motion, 'searching')
  assert.equal(orbLook({ tasks: [], now: NOW, activity: 'listening', attention: false }).motion, 'listening')
})

test('the idle peek names the next thing and when it is due', () => {
  const look = orbLook({
    tasks: [task({ title: 'Later thing', deadline: at(30) }), task({ title: 'Reply to Priya', deadline: at(2) })],
    now: NOW,
    activity: 'idle',
    attention: false
  })
  assert.equal(look.peek, 'Reply to Priya · in 2h')
})

test('sections split open tasks into now, upcoming and later', () => {
  const overdue = task({ deadline: at(-2) })
  const today = task({ deadline: at(3) })
  const meeting = task({ source: 'gcalendar', deadline: at(26) })
  const later = task({ deadline: at(24 * 4) })
  const undated = task({})
  const suggested = task({ status: 'suggested' })
  const sections = panelSections([undated, later, meeting, today, overdue, suggested], NOW)
  assert.deepEqual(sections.now.map((t) => t.id), [overdue.id, today.id])
  assert.deepEqual(sections.upcoming.map((t) => t.id), [meeting.id])
  assert.deepEqual(sections.later.map((t) => t.id), [later.id, undated.id])
  assert.deepEqual(sections.suggested.map((t) => t.id), [suggested.id])
})

test('done today excludes yesterday; snoozed sorts by wake time', () => {
  const doneNow = task({ status: 'done', completedAt: at(-1) })
  const doneYesterday = task({ status: 'done', completedAt: at(-20) })
  const wakeLate = task({ status: 'snoozed', snoozedUntil: at(10) })
  const wakeSoon = task({ status: 'snoozed', snoozedUntil: at(1) })
  const sections = panelSections([doneNow, doneYesterday, wakeLate, wakeSoon], NOW)
  assert.deepEqual(sections.doneToday.map((t) => t.id), [doneNow.id])
  assert.deepEqual(sections.snoozed.map((t) => t.id), [wakeSoon.id, wakeLate.id])
})

test('search matches title, people and evidence, ignoring case', () => {
  const t = task({ title: 'Send deck', people: ['Priya Shah'], evidence: 'by Friday please' })
  assert.equal(matchesQuery(t, 'priya'), true)
  assert.equal(matchesQuery(t, 'FRIDAY'), true)
  assert.equal(matchesQuery(t, 'invoice'), false)
  assert.equal(matchesQuery(t, '   '), true)
  assert.equal(panelSections([t], NOW, 'invoice').later.length, 0)
})

test('the all-clear line says when the next check is', () => {
  assert.equal(allClearLine(null, 15, NOW), 'All clear.')
  assert.equal(allClearLine(new Date(NOW - 3 * 60_000).toISOString(), 15, NOW), 'All clear. Next check in 12 min.')
  assert.equal(allClearLine(new Date(NOW - 30 * 60_000).toISOString(), 15, NOW), 'All clear. Checking again shortly.')
})

test('confidence is a word, not a percentage', () => {
  assert.equal(confidenceLabel(0.94), 'High')
  assert.equal(confidenceLabel(0.75), 'Medium')
  assert.equal(confidenceLabel(0.65), 'Low')
})

test('a task link only opens where its button says', () => {
  assert.equal(safeSourceUrl('https://mail.google.com/mail/u/0/#all/abc'), 'https://mail.google.com/mail/u/0/#all/abc')
  assert.equal(safeSourceUrl('https://evil.example/mail.google.com'), null)
  assert.equal(safeSourceUrl('http://mail.google.com/'), null)
  assert.equal(safeSourceUrl('javascript:alert(1)'), null)
  assert.equal(safeSourceUrl('https://mail.google.com.evil.example/'), null)
  assert.equal(safeSourceUrl(null), null)
})
