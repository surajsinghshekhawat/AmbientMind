import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isDuplicate, rejectDuplicates } from '../electron/services/dedup'
import type { NewTask } from '../electron/services/taskStore'
import type { Task } from '../shared/types'

const existing = (over: Partial<Task> = {}): Task => ({
  id: 'existing-1',
  title: 'Send the Q3 budget report to Sarah',
  deadline: '2026-09-10T17:00:00.000Z',
  priority: 'high',
  source: 'gmail',
  sourceId: 'msg-1',
  people: ['Sarah'],
  rawContext: null,
  confidence: 0.9,
  status: 'pending',
  createdAt: '2026-09-07T09:00:00.000Z',
  completedAt: null,
  ...over
})

const candidate = (over: Partial<NewTask> = {}): NewTask => ({
  title: 'Send Q3 budget report to Sarah',
  deadline: '2026-09-10T17:00:00.000Z',
  source: 'outlook',
  sourceId: 'outlook-1',
  ...over
})

test('the same task arriving via a second source is rejected', () => {
  assert.equal(isDuplicate(candidate(), existing()), true)
})

test('an unrelated task is kept even when deadlines coincide', () => {
  assert.equal(
    isDuplicate(candidate({ title: 'Book flights to Bangalore' }), existing()),
    false
  )
})

test('similar titles with deadlines far apart are treated as distinct', () => {
  assert.equal(
    isDuplicate(candidate({ deadline: '2026-10-20T17:00:00.000Z' }), existing()),
    false
  )
})

test('a missing deadline on one side does not block a match', () => {
  assert.equal(isDuplicate(candidate({ deadline: null }), existing()), true)
})

test('an archived task does not suppress a genuinely recurring one', () => {
  assert.equal(isDuplicate(candidate(), existing({ status: 'archived' })), false)
})

test('two phrasings within one batch collapse to a single task', () => {
  const { accepted, rejected } = rejectDuplicates(
    [
      candidate({ title: 'Call Rob Walls about the indemnity language' }),
      candidate({ title: 'Call Rob Walls about indemnity language', sourceId: 'outlook-2' })
    ],
    []
  )
  assert.equal(accepted.length, 1)
  assert.equal(rejected.length, 1)
  assert.match(rejected[0]!.reason, /same sync batch/)
})

test('distinct tasks in one batch all survive', () => {
  const { accepted, rejected } = rejectDuplicates(
    [
      candidate({ title: 'Sign the counterparty consent form' }),
      candidate({ title: 'Call Rob Walls about indemnity', sourceId: 'outlook-2' }),
      candidate({ title: 'Prepare the credit exposure deck', sourceId: 'outlook-3' })
    ],
    []
  )
  assert.equal(accepted.length, 3)
  assert.equal(rejected.length, 0)
})
