import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeDecisions,
  normaliseSubject,
  recallFor,
  shouldSuppress,
  SUPPRESS_AFTER_DELETES,
  type Decision,
  type DecisionKind
} from '../shared/decisions'

let counter = 0

function decision(kind: DecisionKind, title: string, day = ++counter): Decision {
  return {
    id: `d${day}`,
    kind,
    subject: normaliseSubject(title),
    title,
    source: 'gmail',
    detail: null,
    decidedAt: `2026-09-${String(day).padStart(2, '0')}T10:00:00.000Z`
  }
}

test('recall groups wording variations of one commitment', () => {
  const log = [decision('deleted', 'Gym session'), decision('deleted', 'Go to the gym')]
  // Both are about the gym; neither should need exact wording to be found.
  assert.equal(recallFor(log, 'gym session').length, 1)
})

test('recall keeps unrelated commitments apart', () => {
  const log = [decision('deleted', 'Dentist appointment')]
  assert.equal(recallFor(log, 'Submit tax return').length, 0)
})

test('recall returns newest first', () => {
  const log = [decision('deleted', 'Newsletter digest', 1), decision('snoozed', 'Newsletter digest', 9)]
  const found = recallFor(log, 'Newsletter digest')
  assert.equal(found[0]?.kind, 'snoozed')
})

test('one or two deletions are not yet a preference', () => {
  const log = [decision('deleted', 'Weekly report'), decision('deleted', 'Weekly report')]
  assert.equal(shouldSuppress(log, 'Weekly report').suppressed, false)
})

test('repeated deletions suppress, and explain themselves', () => {
  const log = Array.from({ length: SUPPRESS_AFTER_DELETES }, () =>
    decision('deleted', 'Weekly report')
  )
  const verdict = shouldSuppress(log, 'Weekly report')
  assert.equal(verdict.suppressed, true)
  assert.match(verdict.reason ?? '', /deleted this 3 times/)
})

test('having completed it once outweighs any number of deletions', () => {
  // A suppressed task is invisible, so the user can never discover the
  // mistake. Evidence that they sometimes want it has to win.
  const log = [
    ...Array.from({ length: 10 }, () => decision('deleted', 'Pay rent')),
    decision('completed', 'Pay rent')
  ]
  assert.equal(shouldSuppress(log, 'Pay rent').suppressed, false)
})

test('decisions render as plain lines a small model can read', () => {
  const lines = describeDecisions([
    decision('deleted', 'Gym', 3),
    decision('dismissed_suggestion', 'Dentist', 4)
  ])
  assert.match(lines[0] ?? '', /deleted "Gym" without doing it/)
  assert.match(lines[1] ?? '', /not a recurring commitment/)
})
