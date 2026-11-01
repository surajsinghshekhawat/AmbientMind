import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Task } from '../shared/types'
import { configureAi } from '../electron/services/ai'
import { planChat, type ChatContext } from '../electron/services/chatPlan'

// Sunday 1 November 2026, 4:41 PM local.
const NOW = new Date(2026, 10, 1, 16, 41)
const at = (days: number, hours: number, minutes = 0) => new Date(2026, 10, 1 + days, hours, minutes).toISOString()

function task(id: string, title: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    title,
    deadline: null,
    priority: 'medium',
    source: 'manual',
    sourceId: null,
    people: [],
    rawContext: null,
    confidence: 1,
    status: 'pending',
    createdAt: at(-2, 9),
    completedAt: null,
    snoozedUntil: null,
    sourceUrl: null,
    evidence: null,
    ...patch
  }
}

const TASKS = [
  task('mum', 'Call mum', { deadline: at(1, 9) }),
  task('groceries', 'Buy groceries', { status: 'done', completedAt: at(0, 11) })
]

/** A model that answers with these plans, in turn. */
function modelSays(...plans: object[]): { prompts: string[] } {
  const seen = { prompts: [] as string[] }
  configureAi({
    preference: 'apple',
    apple: {
      status: async () => ({ available: true, reason: null, contextTokens: 4096 }),
      generate: async (params) => {
        seen.prompts.push(params.prompt)
        return { content: JSON.stringify(plans[Math.min(seen.prompts.length - 1, plans.length - 1)]), ms: 1 }
      }
    }
  })
  return seen
}

const action = (type: string, fields: object = {}) => ({ type, task: null, title: null, when: null, priority: null, ...fields })
const plan = (message: string, tasks: Task[] = TASKS): Promise<Awaited<ReturnType<typeof planChat>>> =>
  planChat({ message, history: [], userName: 'Suraj', tasks, rules: [], now: NOW } satisfies ChatContext)

test('one message adds a task once, with the time worked out by code', async () => {
  modelSays({
    kind: 'change',
    actions: [action('add', { title: 'Shower', when: 'in an hour' }), action('add', { title: 'shower', when: 'in an hour' })],
    reply: 'Added.'
  })
  const { actions } = await plan('remind me to shower today in a hour')
  assert.equal(actions.length, 1)
  const [added] = actions
  assert.equal(added?.kind, 'add')
  assert.equal(added?.kind === 'add' && added.deadline, new Date(2026, 10, 1, 17, 41).toISOString())
})

test('a time the model dropped is taken from what was said', async () => {
  modelSays({ kind: 'change', actions: [action('add', { title: 'Call the dentist' })], reply: 'Added.' })
  const [added] = (await plan('remind me to call the dentist tomorrow at 10am')).actions
  assert.equal(added?.kind === 'add' && added.deadline, at(1, 10))
})

test('adding the same task again minutes later moves it instead', async () => {
  const shower = task('shower', 'Shower', { deadline: at(0, 17), createdAt: at(0, 16, 40) })
  modelSays({ kind: 'change', actions: [action('add', { title: 'Shower', when: 'in an hour' })], reply: 'Added.' })
  const [moved] = (await plan('i said in a hour', [...TASKS, shower])).actions
  assert.equal(moved?.kind, 'update')
  assert.equal(moved?.kind === 'update' && moved.task.id, 'shower')
})

test('moving a task that is not on the list adds it rather than moving a lookalike', async () => {
  modelSays({ kind: 'change', actions: [action('update', { task: 'Call the dentist', when: 'tomorrow at 10am' })], reply: 'Moved.' })
  const [added] = (await plan('Remind me to call the dentist tomorrow at 10am')).actions
  assert.equal(added?.kind, 'add')
  assert.equal(added?.kind === 'add' && added.title, 'Call the dentist')
})

test('"not done" reopens a finished task even when the model says done', async () => {
  modelSays({ kind: 'change', actions: [action('done', { task: 'Buy groceries' })], reply: 'Marked as done.' })
  const [reopened] = (await plan('mark groceries as not done')).actions
  assert.equal(reopened?.kind, 'reopen')

  modelSays({ kind: 'change', actions: [action('done', { task: 'Buy groceries' })], reply: 'Done.' })
  const [again] = (await plan('I bought the groceries')).actions
  assert.equal(again?.kind, 'failed')
})

test('a question never changes the list, whatever the model planned', async () => {
  modelSays({ kind: 'change', actions: [action('done', { task: 'Call mum' })], reply: 'Both done.' })
  const result = await plan('wht tasks ARE DONE')
  assert.deepEqual(result.actions, [])
})

test('actions on a message that is not a change are ignored', async () => {
  modelSays({ kind: 'other', actions: [action('add', { title: 'Say hi' })], reply: 'Hi Suraj!' })
  const result = await plan('hi')
  assert.deepEqual(result.actions, [])
  assert.equal(result.reply, 'Hi Suraj!')
})

test('a reply claiming a change it did not list is asked again, then corrected', async () => {
  const seen = modelSays(
    { kind: 'other', actions: [], reply: 'Removed the call to mum.' },
    { kind: 'change', actions: [action('delete', { task: 'Call mum' })], reply: 'Removed.' }
  )
  const [removed] = (await plan('drop the mum thing')).actions
  assert.equal(seen.prompts.length, 2)
  assert.equal(removed?.kind, 'delete')

  modelSays({ kind: 'other', actions: [], reply: 'Removed it.' })
  const honest = await plan('drop the mum thing')
  assert.deepEqual(honest.actions, [])
  assert.match(honest.reply, /didn't change anything/)
})

test('a weekly commitment is read from the words the model copied', async () => {
  modelSays({ kind: 'change', actions: [action('repeat', { title: 'Gym', when: 'every Monday and Wednesday at 7am' })], reply: 'Set.' })
  const [rule] = (await plan('I have gym every Monday and Wednesday at 7am')).actions
  assert.equal(rule?.kind, 'repeat')
  assert.deepEqual(rule?.kind === 'repeat' && [rule.title, rule.weekdays, rule.time], ['Gym', [1, 3], '07:00'])
})
