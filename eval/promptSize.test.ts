import assert from 'node:assert/strict'
import test from 'node:test'
import { appleTextBudget, fitsApple } from '../electron/services/ai'
import { ENRICHMENT_SCHEMA, buildEnrichmentPrompt } from '../prompts/taskEnrichment'
import { EXTRACTION_SCHEMA, buildExtractionPrompt } from '../prompts/taskExtraction'
import { SCREEN_TASK_SCHEMA, buildScreenTaskPrompt } from '../prompts/screenTask'
import { ABOUT_ME_MAX_CHARS } from '../shared/types'

/**
 * Apple's model has a 4K-token window for instructions, prompt, schema and
 * answer together. These guard the fixed parts of each prompt: if one grows
 * past its budget, Apple can no longer read a real message beside it.
 */

const aboutMe = 'x'.repeat(ABOUT_ME_MAX_CHARS)

test('extraction leaves room for at least 3,000 characters of mail', () => {
  const empty = buildExtractionPrompt({
    userName: 'Sally Beck',
    userEmail: 'sally.beck@enron.com',
    aboutMe,
    fewShotExamples: '',
    sender: 'louise.kitchen@enron.com',
    recipients: 'sally.beck@enron.com',
    sentAt: '2001-03-12T09:14:00',
    subject: 'A fairly long subject line about quarterly volumes',
    body: ''
  })
  const budget = appleTextBudget(empty.system + empty.user, EXTRACTION_SCHEMA, 800)
  assert.ok(budget >= 3000, `only ${budget} characters left for the message`)
})

test('quick-add enrichment fits with a long typed task', () => {
  const { system, user } = buildEnrichmentPrompt({ input: 'w'.repeat(500), currentTime: 'Monday 2 November 2026, 12:00' })
  assert.ok(fitsApple(system, user, ENRICHMENT_SCHEMA, 200))
})

test('screen capture leaves room for at least 3,000 characters of screen', () => {
  const empty = buildScreenTaskPrompt({
    userName: 'Sally Beck',
    aboutMe,
    instruction: 'none given; use your judgement',
    currentTime: 'Monday 2 November 2026, 12:00',
    windowTitle: 'Mail — Inbox',
    screenText: '',
    source: 'ocr'
  })
  const budget = appleTextBudget(empty.system + empty.user, SCREEN_TASK_SCHEMA, 300)
  assert.ok(budget >= 3000, `only ${budget} characters left for the screen`)
})
