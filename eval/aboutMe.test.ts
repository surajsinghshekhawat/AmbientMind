import { strict as assert } from 'node:assert'
import test from 'node:test'
import { buildAboutBlock, buildExtractionPrompt } from '../prompts/taskExtraction'
import { buildScreenTaskPrompt } from '../prompts/screenTask'

const MESSAGE = {
  fewShotExamples: '',
  sender: 'priya@example.com',
  recipients: 'suraj@example.com',
  sentAt: 'Tue, 10 Mar 2026 09:00:00 +0530',
  subject: 'Fees',
  body: 'Please pay the tuition fees this week.'
}

test('no profile means no extra prompt text at all', () => {
  assert.equal(buildAboutBlock('Suraj', ''), '')
  assert.equal(buildAboutBlock('Suraj', '   '), '')
  assert.equal(buildAboutBlock('Suraj', undefined), '')

  const { system } = buildExtractionPrompt({
    userName: 'Suraj',
    userEmail: 'suraj@example.com',
    ...MESSAGE
  })
  assert.ok(!system.includes('ABOUT'), 'empty profile must not add a heading')
  assert.ok(!system.includes('{aboutBlock}'), 'placeholder must always be replaced')
})

test('a profile is injected into the system prompt, not the message', () => {
  const aboutMe = 'College until 4pm. Tuition is non-negotiable.'
  const { system, user } = buildExtractionPrompt({
    userName: 'Suraj',
    userEmail: 'suraj@example.com',
    aboutMe,
    ...MESSAGE
  })

  assert.ok(system.includes(aboutMe), 'profile belongs in the system prompt')
  assert.ok(system.includes('ABOUT Suraj'))
  // Measured earlier: extra context inside the message block cost recall.
  assert.ok(!user.includes(aboutMe), 'profile must not enter the message block')
  assert.ok(user.includes(MESSAGE.body))
})

test('the profile is labelled as background so it cannot become a task', () => {
  const block = buildAboutBlock('Suraj', 'I pay the fees.')
  assert.match(block, /never turn this into a task/i)
})

test('the screen prompt uses the same block', () => {
  const { system } = buildScreenTaskPrompt({
    userName: 'Suraj',
    aboutMe: 'Tuition is non-negotiable.',
    instruction: 'none',
    currentTime: 'Tue 10 Mar 2026 09:00',
    windowTitle: 'Gmail',
    screenText: 'hello'
  })
  assert.ok(system.includes('Tuition is non-negotiable.'))
  assert.ok(!system.includes('{aboutBlock}'))
})
