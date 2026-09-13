import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isScreenCaptureIntent } from '../shared/voiceIntent'

test('recognises the phrasing from the product ask', () => {
  assert.equal(
    isScreenCaptureIntent('hey AmbientMind, add this on my screen to the task'),
    true
  )
})

test('recognises shorter screen-capture phrasings', () => {
  for (const phrase of [
    'add what is on my screen',
    "add what's on the screen",
    'capture the screen',
    'make a task from my screen',
    'add this to my tasks',
    'file this as a task',
    'see my screen',
    'see my screen, add this task and deadline is tomorrow'
  ]) {
    assert.equal(isScreenCaptureIntent(phrase), true, phrase)
  }
})

test('leaves ordinary task wording alone', () => {
  for (const phrase of [
    'buy milk tomorrow',
    'email Sarah the budget',
    'add a reminder to call mom',
    'finish the vendor questionnaire by Thursday'
  ]) {
    assert.equal(isScreenCaptureIntent(phrase), false, phrase)
  }
})
