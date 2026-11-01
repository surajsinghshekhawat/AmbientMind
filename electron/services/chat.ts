import { describeRule } from '@shared/recurrence'
import { describeDecisions } from '@shared/decisions'
import type { ChatReply, ChatTurn } from '@shared/types'
import { planChat, spokenTime, type ResolvedAction } from './chatPlan'
import { recallDecisions, recordDecision } from './decisionStore'
import { addRule } from './ruleStore'
import { addTask, deleteTask, listActive, setStatus, snoozeTask, updateTask } from './taskStore'

/**
 * What the user already settled about whatever they just asked about.
 *
 * Keyed off the message rather than dumping the whole log: a small model given
 * every past decision would start treating them as a to-do list. Empty when
 * nothing matches, so the prompt does not grow for ordinary questions.
 */
function digestDecisions(message: string): string {
  const lines = describeDecisions(recallDecisions(message, 4))
  if (lines.length === 0) return ''
  return `\nAlready decided about this:\n${lines.join('\n')}\n`
}

function due(deadline: string | null | undefined): string {
  return deadline ? ` for ${spokenTime(deadline)}` : ''
}

/** Carries out one change and says what happened, in words for the user. */
export function perform(action: ResolvedAction): { said: string; changed: boolean } {
  switch (action.kind) {
    case 'add': {
      const task = addTask({ title: action.title, deadline: action.deadline, priority: action.priority, source: 'manual' })
      return { said: `Added "${task.title}"${due(task.deadline)}.`, changed: true }
    }
    case 'update': {
      updateTask(action.task.id, action.patch)
      const title = action.patch.title ?? action.task.title
      if (action.patch.deadline) return { said: `Moved "${title}" to ${spokenTime(action.patch.deadline)}.`, changed: true }
      if (action.patch.priority) return { said: `"${title}" is now ${action.patch.priority}.`, changed: true }
      return { said: `Renamed it to "${title}".`, changed: true }
    }
    case 'done':
      setStatus(action.task.id, 'done')
      // Acting through chat is still the user deciding, so it is remembered
      // the same way as clicking the overlay.
      recordDecision({ kind: 'completed', title: action.task.title, source: action.task.source })
      return { said: `Marked "${action.task.title}" done.`, changed: true }
    case 'reopen':
      setStatus(action.task.id, 'pending')
      return { said: `"${action.task.title}" is back on your list.`, changed: true }
    case 'delete':
      deleteTask(action.task.id)
      recordDecision({ kind: 'deleted', title: action.task.title, source: action.task.source })
      return { said: `Deleted "${action.task.title}".`, changed: true }
    case 'snooze':
      snoozeTask(action.task.id, action.until)
      recordDecision({
        kind: 'snoozed',
        title: action.task.title,
        source: action.task.source,
        detail: action.until.slice(0, 16).replace('T', ' ')
      })
      return { said: `Hid "${action.task.title}" until ${spokenTime(action.until)}.`, changed: true }
    case 'repeat': {
      const rule = addRule({
        title: action.title,
        weekdays: action.weekdays,
        time: action.time,
        priority: action.priority,
        leadMinutes: 0,
        enabled: true,
        source: 'explicit'
      })
      return { said: `"${rule.title}" now repeats ${describeRule(rule)}.`, changed: true }
    }
    case 'failed':
      return { said: action.reason, changed: false }
  }
}

export interface ChatOptions {
  userName?: string
  aboutMe?: string
  rules?: { title: string; weekdays: number[]; time: string; enabled: boolean }[]
  signal?: AbortSignal
}

export async function runChat(message: string, history: ChatTurn[], options: ChatOptions = {}): Promise<ChatReply> {
  const plan = await planChat({
    message,
    history,
    userName: options.userName ?? 'the user',
    ...(options.aboutMe ? { aboutMe: options.aboutMe } : {}),
    tasks: listActive(),
    rules: options.rules ?? [],
    decisionDigest: digestDecisions(message),
    ...(options.signal ? { signal: options.signal } : {})
  })

  if (plan.actions.length === 0) {
    return { reply: plan.reply || "Sorry, I didn't catch that. Could you say it another way?", actions: [], changed: false }
  }

  // Said from what really happened, not from what the model hoped would. The
  // window lists the changes; the reply carries only what went wrong.
  const problems: string[] = []
  const performed: string[] = []
  for (const action of plan.actions) {
    const result = perform(action)
    if (result.changed) performed.push(result.said)
    else problems.push(result.said)
  }
  return { reply: problems.join(' '), actions: performed, changed: performed.length > 0 }
}
