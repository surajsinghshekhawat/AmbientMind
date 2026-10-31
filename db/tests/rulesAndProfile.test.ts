import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import {
  addRule,
  deleteRule,
  onRuleChange,
  updateRule,
  type RuleChange
} from '../../electron/services/ruleStore'
import { acceptSuggestion } from '../../electron/services/suggestionStore'
import { perform } from '../../electron/services/chat'
import { startScheduler, stopScheduler } from '../../electron/services/sync'
import { addTask, applyEnrichment, getTask, updateTask } from '../../electron/services/taskStore'
import { freshStore, ruleInput } from './helpers'

function recordChanges() {
  const changes: RuleChange[] = []
  const stop = onRuleChange((change) => changes.push(change))
  return { changes, stop }
}

test('every way of creating, editing or deleting a rule is announced', () => {
  const db = freshStore()
  const { changes, stop } = recordChanges()

  const rule = addRule(ruleInput({ title: 'Tuition', weekdays: [2], time: '17:00' }))
  updateRule(rule.id, { time: '18:00' })
  perform({ action: 'add_rule', title: 'Gym', weekdays: [1, 3], time: '07:00' })
  db.prepare(
    `INSERT INTO recurrence_suggestions (id, signature, title, weekdays, time_of_day, occurrences, status, created_at)
     VALUES ('s1', 'standup:1', 'Standup', '[1,2,3,4,5]', '09:30', 3, 'pending', '2026-11-01T00:00:00.000Z')`
  ).run()
  acceptSuggestion('s1')
  deleteRule(rule.id)
  stop()

  assert.deepEqual(
    changes.map((change) => change.kind),
    ['added', 'updated', 'added', 'added', 'deleted']
  )
  assert.equal(changes[0]!.id, rule.id)
})

test('enrichment fills in a fresh task but never overwrites a user edit', () => {
  freshStore()
  const fresh = addTask({ title: 'call sam tmrw' })
  const edited = addTask({ title: 'pay rent' })
  updateTask(edited.id, { title: 'Pay rent to Alex' })

  const enriched = { title: 'Call Sam', deadline: '2026-11-03T09:00:00.000Z', priority: 'high' as const, people: ['Sam'] }
  assert.equal(applyEnrichment(fresh.id, enriched), true)
  assert.equal(applyEnrichment(edited.id, { ...enriched, title: 'Pay rent' }), false)

  assert.equal(getTask(fresh.id)?.title, 'Call Sam')
  assert.equal(getTask(fresh.id)?.priority, 'high')
  assert.equal(getTask(edited.id)?.title, 'Pay rent to Alex')

  updateTask(fresh.id, { title: 'Call Sam about the lease' })
  assert.equal(applyEnrichment(fresh.id, enriched), false, 'a late result after an edit is dropped')
})

test('the scheduler reads the current profile on every run', () => {
  freshStore()
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  try {
    let reads = 0
    startScheduler(5, () => {
      reads++
      return { userName: `name-${reads}` }
    })
    mock.timers.tick(60_000)
    mock.timers.tick(5 * 60_000)
    mock.timers.tick(5 * 60_000)
    assert.equal(reads, 3)
  } finally {
    stopScheduler()
    mock.timers.reset()
  }
})
