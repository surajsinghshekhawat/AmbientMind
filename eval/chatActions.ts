/**
 * Exercises the chat prompt against the real model, because the risk here is
 * not the wiring but whether a 3B model picks the right action. Needs Ollama
 * running; kept out of `npm test` for that reason.
 *
 *   npx tsx eval/chatActions.ts
 */
import { buildChatSystem, CHAT_SCHEMA } from '../prompts/chat'
import { chat } from '../electron/services/ollama'

const TASKS = `1. Send the Q3 budget report to Sarah — in 19h, high, with Sarah
2. Review the pull request from Daniel — in 40h, medium, with Daniel
3. Renew the domain registration — no deadline, low`

const RULES = '- Tuition: Tue, Thu, Sat at 17:00'

const CASES: { message: string; expect: string[] }[] = [
  { message: "What's most urgent?", expect: ['answer'] },
  { message: 'How many things do I have?', expect: ['answer'] },
  { message: 'When is the budget report due?', expect: ['answer'] },
  { message: 'I sent the budget report to Sarah', expect: ['complete_task'] },
  { message: 'Mark the domain renewal done', expect: ['complete_task'] },
  { message: 'Add: book flights to Bangalore next Friday', expect: ['add_task'] },
  { message: 'Remind me to call the dentist tomorrow at 10am', expect: ['add_task'] },
  { message: 'Push the Daniel review to next week', expect: ['snooze_task', 'add_task'] },
  { message: 'Drop the domain renewal, I do not need it', expect: ['delete_task'] },
  { message: 'I have gym every Monday and Wednesday at 7am', expect: ['add_rule'] }
]

async function main() {
  const system = buildChatSystem({
    userName: 'Suraj',
    aboutBlock: '',
    currentTime: 'Tuesday, 10 March 2026, 09:00',
    taskDigest: TASKS,
    ruleDigest: RULES,
    observations: ''
  })

  let passed = 0
  for (const testCase of CASES) {
    const raw = await chat({
      system,
      user: `User: ${testCase.message}`,
      format: CHAT_SCHEMA,
      numPredict: 400
    })

    let action = '(unparseable)'
    let reply = ''
    try {
      const parsed = JSON.parse(raw) as { action?: string; reply?: string }
      action = parsed.action ?? '(missing)'
      reply = parsed.reply ?? ''
    } catch {
      // Leave the placeholder; the line below reports it as a failure.
    }

    const ok = testCase.expect.includes(action)
    if (ok) passed++
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${testCase.message}\n      got ${action}, expected ${testCase.expect.join(' or ')}\n      "${reply}"`
    )
  }

  console.log(`\n${passed}/${CASES.length} chose the expected action`)
}

void main()
