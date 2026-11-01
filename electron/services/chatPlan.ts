import { z } from 'zod'
import { parseCapture, resolveWhen } from '@shared/capture'
import { describeRule, parseRecurrence } from '@shared/recurrence'
import { similarity } from '@shared/similarity'
import { sortByUrgency } from '@shared/urgency'
import { formatPromptTime } from '@shared/promptTime'
import type { ChatTurn, Task, TaskPriority } from '@shared/types'
import { CHAT_ACTIONS, CHAT_KINDS, CHAT_SCHEMA, buildChatSystem } from '../../prompts/chat'
import { buildAboutBlock } from '../../prompts/taskExtraction'
import { generate } from './ai'

/**
 * The model's side of chat, free of the database so the evaluation harness
 * can drive it: build the prompt, get one plan, and turn each action into a
 * concrete change against a known task with a resolved time.
 */

/** Enough for "add these three"; more is a model running away. */
const MAX_ACTIONS = 4
const MAX_OPEN = 25
const MAX_DONE = 10
const DONE_WINDOW_MS = 7 * 86_400_000
/**
 * Below this, "which task did you mean" has no defensible answer. "Call the
 * dentist" against "Call mum" scores 0.5, and moving the wrong task is worse
 * than asking.
 */
const MATCH_THRESHOLD = 0.6
/** "Mark it as not done": a model asked to undo often writes "done" again. */
const UNDOING = /\b(?:not|isn'?t|wasn'?t|undo|reopen|unfinish(?:ed)?|un-?done|back)\b/i
/** A second add of the same task this soon is a correction, not a new task. */
const REPEAT_WINDOW_MS = 15 * 60_000

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
/**
 * Asked as a question, with no command word in it. A small model once
 * answered "what tasks are done?" by marking two of them done; questions
 * never change the list, whatever the model planned.
 */
const QUESTION = /^\s*(?:wh\w*|how|is|are|was|were|do|does|did|any|show|list|tell)\b/i
const COMMAND = /\b(?:mark|add|remind|move|push|delete|remove|drop|cancel|snooze|hide|change|rename|set|reopen|complete|finish)\b/i
/** A reply saying something changed. */
const CLAIMS_CHANGE =
  /\b(?:added|removed|deleted|dropped|marked|moved|hidden|hid|snoozed|completed|updated|renamed|reopened|set up|rescheduled|cancelled|canceled)\b/i
const NOTHING_CHANGED = "I didn't change anything. Tell me which task and what to do, like \"delete the landlord deposit\"."
const UNPARSEABLE = 'I could not put that together. Try rephrasing?'

const RawAction = z.object({
  type: z.enum(CHAT_ACTIONS),
  task: z.union([z.string(), z.number()]).nullish(),
  title: z.string().nullish(),
  when: z.string().nullish(),
  priority: z.enum(PRIORITIES).nullish()
})
type RawAction = z.infer<typeof RawAction>

const RawPlan = z.object({
  kind: z.enum(CHAT_KINDS).nullish(),
  actions: z.array(z.unknown()).nullish(),
  reply: z.string().nullish()
})

export type ResolvedAction =
  | { kind: 'add'; title: string; deadline: string | null; priority: TaskPriority }
  | { kind: 'update'; task: Task; patch: { title?: string; deadline?: string | null; priority?: TaskPriority } }
  | { kind: 'done' | 'reopen' | 'delete'; task: Task }
  | { kind: 'snooze'; task: Task; until: string }
  | { kind: 'repeat'; title: string; weekdays: number[]; time: string; priority: TaskPriority }
  | { kind: 'failed'; reason: string }

export interface ChatContext {
  message: string
  history: ChatTurn[]
  userName: string
  aboutMe?: string
  tasks: Task[]
  rules: { title: string; weekdays: number[]; time: string; enabled: boolean }[]
  decisionDigest?: string
  now?: Date
  signal?: AbortSignal
}

export interface ChatPlan {
  actions: ResolvedAction[]
  /** The model's own words; used as-is only when nothing was changed. */
  reply: string
}

/** "today at 5:42 PM", "tomorrow at 10 AM", "Friday at 5 PM", "Mon 9 Nov at 9 AM". */
export function spokenTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(':00', '')
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(date) - startOf(now)) / 86_400_000)
  let day: string
  if (days === 0) day = 'today'
  else if (days === 1) day = 'tomorrow'
  else if (days === -1) day = 'yesterday'
  else if (days > 1 && days < 7) day = date.toLocaleDateString('en-US', { weekday: 'long' })
  else day = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  return `${day} at ${time}`
}

/** The tasks the model is shown, and so may name. */
export function listedTasks(tasks: Task[], now: Date = new Date()): { open: Task[]; done: Task[] } {
  const open = sortByUrgency(
    tasks.filter((task) => task.status === 'pending' || task.status === 'snoozed' || task.status === 'suggested'),
    now.getTime()
  ).slice(0, MAX_OPEN)
  const done = tasks
    .filter((task) => task.status === 'done' && task.completedAt && now.getTime() - Date.parse(task.completedAt) < DONE_WINDOW_MS)
    .sort((a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!))
    .slice(0, MAX_DONE)
  return { open, done }
}

function describeOpen(task: Task, now: Date): string {
  const parts: string[] = []
  if (task.status === 'snoozed' && task.snoozedUntil) parts.push(`hidden until ${spokenTime(task.snoozedUntil, now)}`)
  if (task.deadline) {
    parts.push(`${Date.parse(task.deadline) < now.getTime() ? 'overdue, was due' : 'due'} ${spokenTime(task.deadline, now)}`)
  } else {
    parts.push('no deadline')
  }
  if (task.priority !== 'medium') parts.push(task.priority)
  if (task.status === 'suggested') parts.push('suggested from email, not accepted yet')
  return parts.join(', ')
}

export function buildChatPrompt(context: ChatContext): { system: string; user: string; open: Task[]; done: Task[] } {
  const now = context.now ?? new Date()
  const { open, done } = listedTasks(context.tasks, now)
  const taskDigest = open.length ? open.map((task) => `- ${task.title} (${describeOpen(task, now)})`).join('\n') : '(none)'
  const doneDigest = done.length
    ? done.map((task) => `- ${task.title} (done ${spokenTime(task.completedAt!, now)})`).join('\n')
    : '(none)'
  const ruleDigest = context.rules.length
    ? context.rules.map((rule) => `- ${rule.title}: ${describeRule(rule)}${rule.enabled ? '' : ' (paused)'}`).join('\n')
    : '(none)'
  const system = buildChatSystem({
    userName: context.userName,
    aboutBlock: buildAboutBlock(context.userName, context.aboutMe),
    currentTime: formatPromptTime(now),
    taskDigest,
    doneDigest,
    ruleDigest,
    decisionDigest: context.decisionDigest ?? ''
  })
  const lines = context.history
    .slice(-6)
    .map((turn) => `${turn.role === 'user' ? context.userName : 'You'}: ${turn.content}`)
  lines.push(`${context.userName}: ${context.message}`)
  return { system, user: lines.join('\n'), open, done }
}

/** The task the model named: its copied title, or the closest one in the pool. */
function pickTask(named: string | number | null | undefined, pool: Task[]): Task | null {
  const query = String(named ?? '').trim().toLowerCase()
  if (!query) return null
  const exact = pool.find((task) => task.title.toLowerCase() === query)
  if (exact) return exact
  let best: { task: Task; score: number } | null = null
  for (const task of pool) {
    const score = similarity(query, task.title)
    if (!best || score > best.score) best = { task, score }
  }
  return best && best.score >= MATCH_THRESHOLD ? best.task : null
}

/** The model's time words, resolved by the parser; an ISO string as a last resort. */
function timeFrom(when: string | null | undefined, now: Date): string | null | 'unknown' {
  const words = when?.trim()
  if (!words || /^(?:null|none|no deadline)$/i.test(words)) return null
  const resolved = resolveWhen(words, now)
  if (resolved) return resolved
  const iso = Date.parse(words)
  return /\d{4}-\d{2}-\d{2}/.test(words) && !Number.isNaN(iso) ? new Date(iso).toISOString() : 'unknown'
}

export function resolveActions(rawActions: unknown[], context: ChatContext, open: Task[], done: Task[]): ResolvedAction[] {
  const now = context.now ?? new Date()
  const resolved: ResolvedAction[] = []
  const added = new Set<string>()
  const parsed = rawActions
    .map((entry) => RawAction.safeParse(entry))
    .filter((result) => result.success)
    .map((result) => result.data)
    .slice(0, MAX_ACTIONS)
  const singleAdd = parsed.filter((action) => action.type === 'add').length === 1

  for (const raw of parsed) {
    switch (raw.type) {
      case 'add': {
        // Title and time together, so a time the model left in the title still counts.
        const capture = parseCapture(`${raw.title ?? ''} ${raw.when ?? ''}`.trim(), now)
        const title = capture.title.trim()
        if (!title) {
          resolved.push({ kind: 'failed', reason: 'I needed a name for that task.' })
          break
        }
        let deadline = capture.deadline
        // The model dropped the time it was given: take it from what was said.
        if (!deadline && singleAdd) deadline = parseCapture(context.message, now).deadline
        const key = title.toLowerCase()
        if (added.has(key)) break
        added.add(key)
        const recent = open.find(
          (task) =>
            task.title.toLowerCase() === key && now.getTime() - Date.parse(task.createdAt) < REPEAT_WINDOW_MS
        )
        if (recent) {
          resolved.push(
            deadline
              ? { kind: 'update', task: recent, patch: { deadline } }
              : { kind: 'failed', reason: `"${recent.title}" is already on your list.` }
          )
          break
        }
        resolved.push({ kind: 'add', title, deadline, priority: raw.priority ?? capture.priority ?? 'medium' })
        break
      }
      case 'update': {
        const task = pickTask(raw.task ?? raw.title, open)
        if (!task) {
          // Moving a task that isn't there: the model meant a new one.
          const title = parseCapture(String(raw.task ?? raw.title ?? ''), now).title.trim()
          if (title && raw.when) {
            const deadline = timeFrom(raw.when, now)
            resolved.push({ kind: 'add', title, deadline: deadline === 'unknown' ? null : deadline, priority: raw.priority ?? 'medium' })
          } else {
            resolved.push({ kind: 'failed', reason: "I couldn't tell which task you meant." })
          }
          break
        }
        const patch: { title?: string; deadline?: string | null; priority?: TaskPriority } = {}
        const when = timeFrom(raw.when, now)
        if (when === 'unknown') {
          resolved.push({ kind: 'failed', reason: `I couldn't work out when "${raw.when}" is.` })
          break
        }
        if (when) patch.deadline = when
        // Models often repeat the title they were naming; only a different one is a rename.
        if (raw.task && raw.title?.trim() && similarity(raw.title, task.title) < 0.8) patch.title = raw.title.trim()
        if (raw.priority && raw.priority !== task.priority) patch.priority = raw.priority
        if (Object.keys(patch).length === 0) {
          resolved.push({ kind: 'failed', reason: `I wasn't sure what to change about "${task.title}".` })
          break
        }
        resolved.push({ kind: 'update', task, patch })
        break
      }
      case 'done':
      case 'delete': {
        const task = pickTask(raw.task ?? raw.title, open)
        const finished = task ? null : pickTask(raw.task ?? raw.title, done)
        if (finished && raw.type === 'done') {
          resolved.push(
            UNDOING.test(context.message)
              ? { kind: 'reopen', task: finished }
              : { kind: 'failed', reason: `"${finished.title}" is already done.` }
          )
          break
        }
        if (!task) {
          resolved.push({ kind: 'failed', reason: "I couldn't find an open task like that." })
          break
        }
        resolved.push({ kind: raw.type, task })
        break
      }
      case 'reopen': {
        const task = pickTask(raw.task ?? raw.title, done)
        if (!task) {
          resolved.push({ kind: 'failed', reason: "I couldn't find a finished task like that." })
          break
        }
        resolved.push({ kind: 'reopen', task })
        break
      }
      case 'snooze': {
        const task = pickTask(raw.task ?? raw.title, open)
        const until = timeFrom(raw.when, now)
        if (!task) {
          resolved.push({ kind: 'failed', reason: "I couldn't tell which task you meant." })
        } else if (!until || until === 'unknown' || Date.parse(until) <= now.getTime()) {
          resolved.push({ kind: 'failed', reason: `I need a time in the future to hide "${task.title}" until.` })
        } else {
          resolved.push({ kind: 'snooze', task, until })
        }
        break
      }
      case 'repeat': {
        const rule =
          parseRecurrence(`${raw.title ?? ''} ${raw.when ?? ''}`) ??
          (raw.title ? null : parseRecurrence(context.message))
        if (!rule || !rule.title.trim()) {
          resolved.push({ kind: 'failed', reason: 'A repeating task needs a name, the days and a time.' })
          break
        }
        resolved.push({ kind: 'repeat', title: rule.title, weekdays: rule.weekdays, time: rule.time, priority: raw.priority ?? 'medium' })
        break
      }
    }
  }
  return resolved
}

async function askForPlan(system: string, user: string, signal?: AbortSignal): Promise<z.infer<typeof RawPlan> | null> {
  const { content } = await generate({
    purpose: 'chat',
    system,
    user,
    schema: CHAT_SCHEMA,
    maxTokens: 500,
    ...(signal ? { signal } : {})
  })
  try {
    const plan = RawPlan.safeParse(JSON.parse(content))
    return plan.success ? plan.data : null
  } catch (err) {
    console.warn('[chat] malformed plan JSON:', (err as Error).message)
    return null
  }
}

export async function planChat(context: ChatContext): Promise<ChatPlan> {
  const { system, user, open, done } = buildChatPrompt(context)
  const asking = QUESTION.test(context.message) && !COMMAND.test(context.message)
  const resolve = (plan: z.infer<typeof RawPlan>) =>
    // Only a change acts; whatever else a model put in the array is ignored.
    plan.kind === 'change' && !asking ? resolveActions(plan.actions ?? [], context, open, done) : []

  const first = await askForPlan(system, user, context.signal)
  if (!first) return { actions: [], reply: UNPARSEABLE }
  const actions = resolve(first)
  const reply = first.reply?.trim() ?? ''
  if (actions.length > 0 || asking || !CLAIMS_CHANGE.test(reply)) return { actions, reply }

  // It says it changed something but listed nothing: ask once more, then be honest.
  const nudge = `${user}\n(Your last answer said "${reply}" but changed nothing. If that was a request for a change, answer with kind "change" and the actions.)`
  const second = await askForPlan(system, nudge, context.signal)
  const retried = second ? resolve(second) : []
  if (retried.length > 0) return { actions: retried, reply: second?.reply?.trim() ?? '' }
  return { actions: [], reply: NOTHING_CHANGED }
}
