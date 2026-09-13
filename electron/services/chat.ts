import { formatPromptTime } from '@shared/promptTime'
import { describeRule } from '@shared/recurrence'
import { similarity } from '@shared/similarity'
import { formatDeadline, sortByUrgency } from '@shared/urgency'
import type { ChatReply, ChatTurn, Task } from '@shared/types'
import { buildAboutBlock } from '../../prompts/taskExtraction'
import { CHAT_SCHEMA, buildChatSystem } from '../../prompts/chat'
import { chat } from './ollama'
import { addRule } from './ruleStore'
import { addTask, deleteTask, listActive, setStatus, snoozeTask } from './taskStore'
import { describeDecisions } from '@shared/decisions'
import { recallDecisions, recordDecision } from './decisionStore'

/**
 * How many actions one message may trigger before the assistant must answer.
 * Small models will happily loop; the cap makes a runaway impossible rather
 * than unlikely.
 */
const MAX_ACTIONS = 4

/** Below this, "which task did you mean" has no defensible answer. */
const MATCH_THRESHOLD = 0.45

interface Action {
  action: string
  query?: string
  title?: string
  deadline?: string | null
  priority?: Task['priority']
  until?: string
  weekdays?: number[]
  time?: string
  reply?: string
}

function digestTasks(tasks: Task[]): string {
  const pending = sortByUrgency(tasks.filter((task) => task.status === 'pending'))
  if (pending.length === 0) return '(nothing pending)'
  return pending
    .map(
      (task, index) =>
        `${index + 1}. ${task.title} — ${formatDeadline(task.deadline)}, ${task.priority}${
          task.people.length ? `, with ${task.people.join(', ')}` : ''
        }`
    )
    .join('\n')
}

/**
 * What the user already settled about whatever they just asked about.
 *
 * Keyed off the message rather than dumping the whole log: a 3B model given
 * every past decision would start treating them as a to-do list. Empty when
 * nothing matches, so the prompt does not grow for ordinary questions.
 */
function digestDecisions(message: string): string {
  const lines = describeDecisions(recallDecisions(message, 4))
  if (lines.length === 0) return ''
  return `\nAlready decided about this:\n${lines.join('\n')}\n`
}

/** Resolves the model's loose wording onto a real row, or refuses. */
function findTask(tasks: Task[], query: string): Task | null {
  const pending = tasks.filter((task) => task.status === 'pending')
  if (!query.trim() || pending.length === 0) return null

  let best: { task: Task; score: number } | null = null
  for (const task of pending) {
    const score = similarity(query, task.title)
    if (!best || score > best.score) best = { task, score }
  }
  return best && best.score >= MATCH_THRESHOLD ? best.task : null
}

/**
 * Runs one action. Returns the line shown back to the model, and whether the
 * task list changed, so the caller knows when to tell the overlay.
 */
function perform(action: Action): { observation: string; changed: boolean } {
  const tasks = listActive()

  switch (action.action) {
    case 'add_task': {
      const title = action.title?.trim()
      if (!title) return { observation: 'FAILED: no title given.', changed: false }
      const task = addTask({
        title,
        deadline: action.deadline ?? null,
        priority: action.priority ?? 'medium',
        source: 'manual'
      })
      return { observation: `OK: added "${task.title}".`, changed: true }
    }

    case 'complete_task': {
      const task = findTask(tasks, action.query ?? action.title ?? '')
      if (!task) return { observation: 'FAILED: no pending task matches that.', changed: false }
      setStatus(task.id, 'done')
      // Acting through chat is still the user deciding, so it is remembered
      // the same way as clicking the overlay.
      recordDecision({ kind: 'completed', title: task.title, source: task.source })
      return { observation: `OK: completed "${task.title}".`, changed: true }
    }

    case 'snooze_task': {
      const task = findTask(tasks, action.query ?? action.title ?? '')
      if (!task) return { observation: 'FAILED: no pending task matches that.', changed: false }
      const until = action.until ? Date.parse(action.until) : NaN
      if (Number.isNaN(until) || until <= Date.now()) {
        return { observation: 'FAILED: needs a future time to snooze until.', changed: false }
      }
      snoozeTask(task.id, new Date(until).toISOString())
      recordDecision({
        kind: 'snoozed',
        title: task.title,
        source: task.source,
        detail: new Date(until).toISOString().slice(0, 16).replace('T', ' ')
      })
      return { observation: `OK: snoozed "${task.title}".`, changed: true }
    }

    case 'delete_task': {
      const task = findTask(tasks, action.query ?? action.title ?? '')
      if (!task) return { observation: 'FAILED: no pending task matches that.', changed: false }
      deleteTask(task.id)
      recordDecision({ kind: 'deleted', title: task.title, source: task.source })
      return { observation: `OK: deleted "${task.title}".`, changed: true }
    }

    case 'add_rule': {
      const title = action.title?.trim()
      const weekdays = (action.weekdays ?? []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      const time = action.time?.trim() ?? ''
      if (!title || weekdays.length === 0 || !/^\d{1,2}:\d{2}$/.test(time)) {
        return { observation: 'FAILED: a rule needs a title, weekdays and HH:MM.', changed: false }
      }
      const rule = addRule({
        title,
        weekdays,
        time,
        priority: action.priority ?? 'medium',
        leadMinutes: 0,
        enabled: true,
        source: 'explicit'
      })
      return { observation: `OK: recurring "${rule.title}", ${describeRule(rule)}.`, changed: true }
    }

    default:
      return { observation: `FAILED: unknown action "${action.action}".`, changed: false }
  }
}

export interface ChatOptions {
  model?: string
  userName?: string
  aboutMe?: string
  rules?: { title: string; weekdays: number[]; time: string; enabled: boolean }[]
  signal?: AbortSignal
}

function renderHistory(history: ChatTurn[], message: string): string {
  const lines = history
    .slice(-6)
    .map((turn) => `${turn.role === 'user' ? 'User' : 'You'}: ${turn.content}`)
  lines.push(`User: ${message}`)
  return lines.join('\n')
}

export async function runChat(
  message: string,
  history: ChatTurn[],
  options: ChatOptions = {}
): Promise<ChatReply> {
  const observations: string[] = []
  const performed: string[] = []
  let changed = false

  for (let step = 0; step < MAX_ACTIONS; step++) {
    const rules = options.rules ?? []
    const system = buildChatSystem({
      userName: options.userName ?? 'the user',
      aboutBlock: buildAboutBlock(options.userName ?? 'the user', options.aboutMe),
      currentTime: formatPromptTime(),
      taskDigest: digestTasks(listActive()),
      ruleDigest:
        rules.length === 0
          ? '(none)'
          : rules
              .map((rule) => `- ${rule.title}: ${describeRule(rule)}${rule.enabled ? '' : ' (paused)'}`)
              .join('\n'),
      decisionDigest: digestDecisions(message),
      observations: observations.length
        ? `\nWhat has happened while answering this message:\n${observations.join('\n')}`
        : ''
    })

    const raw = await chat({
      system,
      user: renderHistory(history, message),
      ...(options.model ? { model: options.model } : {}),
      format: CHAT_SCHEMA,
      numPredict: 400,
      ...(options.signal ? { signal: options.signal } : {})
    })

    let action: Action
    try {
      action = JSON.parse(raw) as Action
    } catch {
      // Unreachable while `format` holds, but a schema rejection upstream must
      // not surface to the user as a crash.
      return { reply: 'I could not put that together. Try rephrasing?', actions: performed, changed }
    }

    if (action.action === 'answer') {
      return {
        reply: action.reply?.trim() || 'Done.',
        actions: performed,
        changed
      }
    }

    const result = perform(action)
    changed = changed || result.changed
    if (result.changed) performed.push(result.observation.replace(/^OK: /, ''))
    observations.push(`${action.action}: ${result.observation}`)
  }

  // Out of steps: report what actually happened rather than inventing a reply.
  return {
    reply: performed.length
      ? `Done: ${performed.join(' ')}`
      : 'I could not finish that one. Could you say it more directly?',
    actions: performed,
    changed
  }
}
