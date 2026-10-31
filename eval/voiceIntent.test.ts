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
    "what's on my screen",
    'capture the screen',
    'capture my screen and set it for tomorrow',
    'make a task from my screen',
    'turn my screen into a task',
    'read the screen',
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

test('"this task" or "that todo" without the screen is a task, not a capture', () => {
  for (const phrase of [
    'Finish this task by Friday',
    'update that todo about rent',
    'add this to my tasks',
    'file this as a task',
    'move this task to tomorrow'
  ]) {
    assert.equal(isScreenCaptureIntent(phrase), false, phrase)
  }
})

test('the word "screen" in a task is not a capture', () => {
  for (const phrase of [
    'fix the screen door tomorrow',
    'screen the candidates for the role',
    'my screen time is too high, cut it',
    'order a screen protector',
    'add cleaning the screen to my list',
    'put the review on screen share tomorrow',
    'the bug shows on my screen and I need to report it'
  ]) {
    assert.equal(isScreenCaptureIntent(phrase), false, phrase)
  }
})
