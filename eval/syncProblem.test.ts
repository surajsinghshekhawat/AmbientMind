import assert from 'node:assert/strict'
import test from 'node:test'
import { describeGoogleError } from '../shared/googleError'
import { syncProblem } from '../shared/syncProblem'

test('a failed pass reaches the panel', () => {
  assert.equal(
    syncProblem(describeGoogleError('Calendar', 500, '{"error":{"code":500,"message":"Internal error"}}')),
    'Last sync: Calendar: Google had a problem on its side (500); it will try again next sync'
  )
  assert.equal(
    syncProblem('The AI model stopped responding; the rest of this pass was left for later'),
    'Last sync: The AI model stopped responding; the rest of this pass was left for later'
  )
})

test('nothing to say, or something health already says, adds no line', () => {
  assert.equal(syncProblem(null), null)
  assert.equal(syncProblem('  '), null)
  assert.equal(syncProblem('a sync is already in progress'), null)
  assert.equal(syncProblem('Google account is not connected'), null)
  assert.equal(syncProblem('AI paused until 3:00 PM. Recurring tasks still appear.'), null)
  assert.equal(syncProblem('No AI model is available (Apple Intelligence off, Ollama not running); mail was not read this pass'), null)
})
