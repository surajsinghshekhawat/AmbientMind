import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeConfig } from '../shared/config'
import { alertBody, ALERT_GRACE_MINUTES, shouldAlert } from '../shared/dueAlerts'

const NOW = Date.parse('2026-11-01T10:00:00.000Z')
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()
const task = (deadline: string | null, extra: { remindedAt?: string; remindAt?: string } = {}) => ({
  deadline,
  remindedAt: extra.remindedAt ?? null,
  remindAt: extra.remindAt ?? null
})

test('an alert goes out inside the lead time, once', () => {
  assert.equal(shouldAlert(task(at(20)), NOW, 15), false)
  assert.equal(shouldAlert(task(at(15)), NOW, 15), true)
  assert.equal(shouldAlert(task(at(1)), NOW, 15), true)
  assert.equal(shouldAlert(task(at(10), { remindedAt: at(-5) }), NOW, 15), false)
  assert.equal(shouldAlert(task(null), NOW, 15), false)
  assert.equal(shouldAlert(task(at(0)), NOW, 0), true)
})

test('a deadline long gone is not announced after the fact', () => {
  assert.equal(shouldAlert(task(at(-30)), NOW, 15), true)
  assert.equal(shouldAlert(task(at(-ALERT_GRACE_MINUTES - 1)), NOW, 15), false)
})

test('snoozing from an alert brings it back at that time, whatever the deadline', () => {
  assert.equal(shouldAlert(task(at(-200), { remindedAt: at(-60), remindAt: at(5) }), NOW, 15), false)
  assert.equal(shouldAlert(task(at(-200), { remindedAt: at(-60), remindAt: at(-1) }), NOW, 15), true)
})

test('the body says how long is left, or how late it is', () => {
  assert.equal(alertBody(at(15), NOW), 'Due in 15 min')
  assert.equal(alertBody(at(60), NOW), 'Due in 1 hour')
  assert.equal(alertBody(at(0.2), NOW), 'Due now')
  assert.equal(alertBody(at(-20), NOW), 'Was due 20 min ago')
})

test('reminders default to 15 minutes before; junk falls back', () => {
  assert.equal(sanitizeConfig({}).remindBeforeMinutes, 15)
  assert.equal(sanitizeConfig({ remindBeforeMinutes: null }).remindBeforeMinutes, null)
  assert.equal(sanitizeConfig({ remindBeforeMinutes: 60 }).remindBeforeMinutes, 60)
  assert.equal(sanitizeConfig({ remindBeforeMinutes: 7 as never }).remindBeforeMinutes, 15)
})
