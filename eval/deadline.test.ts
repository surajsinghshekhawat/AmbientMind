import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveDeadline } from '../shared/deadline'

/** Monday 7 September 2026, 22:00 local. */
const MONDAY = new Date(2026, 8, 7, 22, 0, 0)

function localDay(iso: string | null): string {
  assert.ok(iso, 'expected a deadline')
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}`
}

test('resolves a bare weekday to the next one ahead', () => {
  assert.equal(localDay(resolveDeadline('Thursday', MONDAY)), '2026-09-10 17')
})

test('a weekday matching today means next week, not today', () => {
  assert.equal(localDay(resolveDeadline('Monday', MONDAY)), '2026-09-14 17')
})

test('"next friday" resolves like "friday"', () => {
  assert.equal(localDay(resolveDeadline('next Friday', MONDAY)), '2026-09-11 17')
})

test('today and EOD both mean end of the current day', () => {
  assert.equal(localDay(resolveDeadline('today', MONDAY)), '2026-09-07 17')
  assert.equal(localDay(resolveDeadline('EOD', MONDAY)), '2026-09-07 17')
})

test('tomorrow advances one day', () => {
  assert.equal(localDay(resolveDeadline('tomorrow', MONDAY)), '2026-09-08 17')
})

test('a date-only string lands at end of that local day, not UTC midnight', () => {
  assert.equal(localDay(resolveDeadline('2026-09-10', MONDAY)), '2026-09-10 17')
})

test('a full timestamp is preserved exactly', () => {
  const iso = resolveDeadline('2026-09-10T09:30:00', MONDAY)
  assert.equal(localDay(iso), '2026-09-10 09')
})

test('unparseable and empty values yield null', () => {
  for (const value of ['', '   ', 'null', 'none', 'sometime soon', 42, null, undefined]) {
    assert.equal(resolveDeadline(value, MONDAY), null, `expected null for ${String(value)}`)
  }
})
