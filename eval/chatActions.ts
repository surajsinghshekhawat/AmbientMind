/**
 * Runs the chat planner against a real model, because the risk in chat is not
 * the wiring but the model's judgement: does it answer a question instead of
 * acting, pick the right task, and keep the user's time words? Each case
 * checks what would actually happen: which task, which resolved time.
 * Needs Ollama, or the helper for Apple; kept out of `npm test` for that.
 *
 *   ./dev npm run eval:chat                      (the default Ollama model)
 *   ./dev npm run eval:chat -- --model qwen2.5:3b
 *   ./dev npm run eval:chat -- --engine apple
 */
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import type { ChatTurn, Task } from '@shared/types'
import { HelperClient } from '../electron/native/helperClient'
import { configureAi } from '../electron/services/ai'
import { planChat, type ChatPlan, type ResolvedAction } from '../electron/services/chatPlan'

const { values } = parseArgs({
  options: {
    model: { type: 'string', default: 'qwen3:4b-instruct-2507-q4_K_M' },
    engine: { type: 'string', default: 'ollama' },
    helper: { type: 'string', default: '.local/build/mac-helper/release/ambientmind-helper' },
    verbose: { type: 'boolean', default: false }
  }
})

// Sunday 1 November 2026, 4:41 PM local.
const NOW = new Date(2026, 10, 1, 16, 41)
const at = (days: number, hours: number, minutes = 0) =>
  new Date(2026, 10, 1 + days, hours, minutes).toISOString()

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

const TASKS: Task[] = [
  task('mum', 'Call mum', { deadline: at(1, 9) }),
  task('landlord', 'Sort out the landlord deposit', { deadline: at(1, 17), priority: 'urgent' }),
  task('report', 'Send the Q3 budget report to Sarah', { deadline: at(0, 18), priority: 'high', people: ['Sarah'] }),
  task('review', "Review Daniel's pull request", { deadline: at(4, 17) }),
  task('groceries', 'Buy groceries', { status: 'done', completedAt: at(0, 11) })
]

const SHOWER = task('shower', 'Shower', { deadline: at(0, 17), createdAt: at(0, 16, 40) })

type Check = (plan: ChatPlan) => string | null

const none: Check = (plan) => (plan.actions.length === 0 ? null : `expected no actions, got ${kinds(plan)}`)
const says =
  (pattern: RegExp): Check =>
  (plan) =>
    none(plan) ?? (pattern.test(plan.reply) ? null : `reply should match ${pattern}`)

function only(kind: ResolvedAction['kind'], test: (action: ResolvedAction) => string | null): Check {
  return (plan) => {
    if (plan.actions.length !== 1 || plan.actions[0]!.kind !== kind) return `expected one ${kind}, got ${kinds(plan)}`
    return test(plan.actions[0]!)
  }
}

const onTask = (id: string) => (action: ResolvedAction) =>
  'task' in action && action.task.id === id ? null : `wrong task ${'task' in action ? action.task.title : ''}`

const near = (iso: string | null | undefined, expected: string, slackMinutes = 2) =>
  iso && Math.abs(Date.parse(iso) - Date.parse(expected)) <= slackMinutes * 60_000
    ? null
    : `time ${iso ? new Date(iso).toString().slice(0, 21) : 'none'}, expected ${new Date(expected).toString().slice(0, 21)}`

function kinds(plan: ChatPlan): string {
  return plan.actions.length ? plan.actions.map((a) => (a.kind === 'failed' ? `failed(${a.reason})` : a.kind)).join(', ') : 'none'
}

const IN_AN_HOUR = new Date(NOW.getTime() + 3_600_000).toISOString()

const CASES: { message: string; history?: ChatTurn[]; tasks?: Task[]; check: Check }[] = [
  // Due today, or marked urgent: either is a fair answer.
  { message: "What's urgent today?", check: says(/budget|Q3|report|landlord/i) },
  { message: 'whats my name', check: says(/Suraj/) },
  { message: 'what are all the tasks', check: says(/mum[\s\S]*landlord|landlord[\s\S]*mum|report[\s\S]*mum|mum[\s\S]*report/i) },
  { message: 'wht tasks ARE DONE', check: says(/groceries/i) },
  { message: 'How many tasks do I have?', check: says(/\b(4|four)\b/i) },
  { message: 'When is the budget report due?', check: says(/6|six|today|this evening/i) },
  { message: 'hi', check: none },
  { message: 'what can you do?', check: none },
  {
    message: 'remind me to shower today in a hour',
    check: only('add', (a) => (a.kind === 'add' && /shower/i.test(a.title) ? near(a.deadline, IN_AN_HOUR) : 'wrong title'))
  },
  {
    message: 'i said in a hour',
    history: [
      { role: 'user', content: 'remind me to shower today' },
      { role: 'assistant', content: 'Added "Shower" for today at 5 PM.' }
    ],
    tasks: [...TASKS, SHOWER],
    check: only('update', (a) => onTask('shower')(a) ?? (a.kind === 'update' ? near(a.patch.deadline, IN_AN_HOUR) : null))
  },
  { message: 'Remind me to call the dentist tomorrow at 10am', check: only('add', (a) => (a.kind === 'add' ? near(a.deadline, at(1, 10)) : null)) },
  { message: 'I sent the budget report to Sarah', check: only('done', onTask('report')) },
  { message: 'mark groceries as not done', check: only('reopen', onTask('groceries')) },
  {
    // Hiding it or moving its deadline both honour "push"; next week starts on Monday.
    message: "Push Daniel's review to next week",
    check: (plan) => {
      const action = plan.actions[0]
      if (plan.actions.length !== 1 || !action) return `expected one snooze or update, got ${kinds(plan)}`
      if (action.kind === 'snooze') return onTask('review')(action) ?? near(action.until, at(1, 9))
      if (action.kind === 'update') return onTask('review')(action) ?? near(action.patch.deadline, at(1, 9))
      return `expected snooze or update, got ${kinds(plan)}`
    }
  },
  {
    message: 'move call mum to 7pm today',
    check: only('update', (a) => onTask('mum')(a) ?? (a.kind === 'update' ? near(a.patch.deadline, at(0, 19)) : null))
  },
  { message: 'Drop the landlord thing, already sorted it', check: (plan) => {
      const kind = plan.actions[0]?.kind
      return plan.actions.length === 1 && (kind === 'done' || kind === 'delete') ? onTask('landlord')(plan.actions[0]!) : `expected done or delete, got ${kinds(plan)}`
    } },
  {
    message: 'I have gym every Monday and Wednesday at 7am',
    check: only('repeat', (a) => (a.kind === 'repeat' && a.weekdays.join() === '1,3' && a.time === '07:00' ? null : 'wrong days or time'))
  },
  {
    message: 'add buy milk and call the plumber tomorrow',
    check: (plan) => (plan.actions.length === 2 && plan.actions.every((a) => a.kind === 'add') ? null : `expected two adds, got ${kinds(plan)}`)
  }
]

async function main() {
  let helper: HelperClient | null = null
  let label = values.model!
  if (values.engine === 'apple') {
    helper = new HelperClient({ command: resolve(values.helper!), requestTimeoutMs: 120_000 })
    helper.start()
    const client = helper
    configureAi({
      preference: 'apple',
      apple: {
        status: () => client.request('llm.status', {}),
        generate: (params, timeoutMs) => client.request('llm.generate', params, { timeoutMs })
      }
    })
    label = 'apple-on-device'
  } else {
    configureAi({ preference: 'ollama', ollamaModel: values.model! })
  }

  let passed = 0
  const times: number[] = []
  for (const testCase of CASES) {
    const started = Date.now()
    let problem: string | null
    let plan: ChatPlan = { actions: [], reply: '' }
    try {
      plan = await planChat({
        message: testCase.message,
        history: testCase.history ?? [],
        userName: 'Suraj',
        tasks: testCase.tasks ?? TASKS,
        rules: [{ title: 'Tuition', weekdays: [2, 4, 6], time: '17:00', enabled: true }],
        now: NOW
      })
      problem = testCase.check(plan)
    } catch (err) {
      problem = `threw ${(err as Error).message}`
    }
    times.push(Date.now() - started)
    if (!problem) passed++
    console.log(`${problem ? 'FAIL' : 'pass'}  ${testCase.message}${problem ? `\n      ${problem}` : ''}`)
    if (problem || values.verbose) console.log(`      reply: ${JSON.stringify(plan.reply)}`)
  }
  times.sort((a, b) => a - b)
  console.log(`\n${label}: ${passed}/${CASES.length} passed, median ${(times[Math.floor(times.length / 2)]! / 1000).toFixed(1)}s`)
  await helper?.stop()
}

void main()
