import assert from 'node:assert/strict'
import test from 'node:test'
import { parseExtraction } from '../electron/services/extract'

const SOURCE = `Q1 volumes

Sally, can you send the Q1 volume numbers for the East desk by Friday? Greg wants them in the board pack.`
const SENT = '2001-03-12T09:14:00'

const json = (tasks: unknown[]) => JSON.stringify({ tasks })

test('Apple leaves out null fields; the task survives with defaults', () => {
  const [task] = parseExtraction(
    json([{ evidence: 'can you send the Q1 volume numbers', title: 'Send Q1 numbers', confidence: 0.9 }]),
    SOURCE,
    0.6,
    SENT
  )
  assert.equal(task?.title, 'Send Q1 numbers')
  assert.equal(task?.deadline, null)
  assert.equal(task?.priority, 'medium')
  assert.deepEqual(task?.people, [])
  assert.equal(task?.verified, true)
  assert.equal(task?.evidence, 'can you send the Q1 volume numbers')
})

test('one malformed task does not lose the others', () => {
  const tasks = parseExtraction(
    json([{ title: 42 }, { evidence: 'Greg wants them in the board pack', title: 'Add numbers to board pack', confidence: 0.8 }]),
    SOURCE,
    0.6,
    SENT
  )
  assert.deepEqual(tasks.map((task) => task.title), ['Add numbers to board pack'])
})

test('low confidence, "no action" answers and unsupported tasks are dropped', () => {
  const tasks = parseExtraction(
    json([
      { evidence: 'can you send', title: 'Send numbers', confidence: 0.4 },
      { evidence: 'n/a', title: 'No action required', confidence: 0.9 },
      { evidence: 'Book the Houston trip', title: 'Book Houston flights', confidence: 0.9 }
    ]),
    SOURCE,
    0.6,
    SENT
  )
  assert.deepEqual(tasks, [])
})

test('a weekday resolves against the message date, not today', () => {
  const [task] = parseExtraction(
    json([{ evidence: 'by Friday', title: 'Send Q1 numbers', deadline: 'Friday', confidence: 0.9 }]),
    SOURCE,
    0.6,
    SENT
  )
  const deadline = new Date(task!.deadline!)
  assert.equal(deadline.getFullYear(), 2001)
  assert.equal(deadline.getMonth(), 2)
  assert.equal(deadline.getDate(), 16)
})

test('a deadline in the wrong year is moved next to the message', () => {
  const [task] = parseExtraction(
    json([{ evidence: 'by Friday', title: 'Send Q1 numbers', deadline: '2025-03-16T17:00:00', confidence: 0.9 }]),
    SOURCE,
    0.6,
    SENT
  )
  assert.equal(new Date(task!.deadline!).getFullYear(), 2001)
})

test('malformed JSON yields nothing rather than throwing', () => {
  assert.deepEqual(parseExtraction('{"tasks": [', SOURCE, 0.6, SENT), [])
})
