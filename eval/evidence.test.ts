import assert from 'node:assert/strict'
import test from 'node:test'
import { bucketFor, findEvidence, shouldAutoAccept } from '../shared/evidence'

const MAIL = `Sally,

Can you pull together the Q1 volume numbers for the East desk and send them over by EOD tomorrow?
Greg wants them in the board pack.

Thanks,
Louise`

test('a quote found in the message is returned as the message wrote it', () => {
  const found = findEvidence('can you pull together the Q1  volume numbers', MAIL, 'Send Q1 numbers')
  assert.equal(found.verified, true)
  assert.equal(found.quote, 'Can you pull together the Q1 volume numbers')
})

test('curly quotes and surrounding quote marks still match', () => {
  const found = findEvidence('“Greg wants them in the board pack.”', MAIL, 'Send numbers')
  assert.equal(found.verified, true)
  assert.equal(found.quote, 'Greg wants them in the board pack.')
})

test('a greeting glued to a real sentence still counts as copied', () => {
  const found = findEvidence('Sally, Greg wants them in the board pack.', MAIL, 'Send numbers')
  assert.equal(found.verified, true)
  assert.equal(found.quote, 'Greg wants them in the board pack.')
})

test('a paraphrase is replaced by the sentence that supports the task', () => {
  const found = findEvidence('Louise asked for the volumes', MAIL, 'Send Q1 East desk volume numbers to Louise')
  assert.equal(found.verified, false)
  assert.match(found.quote ?? '', /^Can you pull together the Q1 volume numbers/)
})

test('a task nothing in the message supports has no evidence', () => {
  const found = findEvidence('Book flights to Houston', MAIL, 'Book flights to Houston')
  assert.equal(found.quote, null)
  assert.equal(found.verified, false)
})

test('long evidence is clipped for display', () => {
  const long = `Please ${'review the attached contract carefully '.repeat(20)}today.`
  const found = findEvidence(long, long, 'Review contract')
  assert.ok((found.quote?.length ?? 0) <= 240)
  assert.ok(found.quote?.endsWith('…'))
})

test('buckets need a found quote to be high', () => {
  assert.equal(bucketFor(0.95, true), 'high')
  assert.equal(bucketFor(0.95, false), 'medium')
  assert.equal(bucketFor(0.75, true), 'medium')
  assert.equal(bucketFor(0.65, true), 'low')
})

test('auto-accept is off by default and never trusts a found-for-it quote', () => {
  assert.equal(shouldAutoAccept(0.99, true, null), false)
  assert.equal(shouldAutoAccept(0.99, false, 0.9), false)
  assert.equal(shouldAutoAccept(0.89, true, 0.9), false)
  assert.equal(shouldAutoAccept(0.9, true, 0.9), true)
})
