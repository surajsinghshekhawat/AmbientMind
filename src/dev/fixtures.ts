import type { RecurrenceRule } from '@shared/recurrence'
import type { HealthReport, RecurrenceSuggestion, Task } from '@shared/types'

const HOUR = 3_600_000
const EPOCH = Date.UTC(2026, 0, 1)

let sequence = 0

/** Later calls get a later createdAt, so "newest task" logic is predictable. */
export function makeTask(partial: Partial<Task> = {}): Task {
  sequence += 1
  return {
    id: `mock-${sequence}`,
    title: 'Untitled task',
    deadline: null,
    priority: 'medium',
    source: 'manual',
    sourceId: null,
    people: [],
    rawContext: null,
    confidence: 1,
    status: 'pending',
    createdAt: new Date(EPOCH + sequence * 60_000).toISOString(),
    completedAt: null,
    snoozedUntil: null,
    ...partial
  }
}

export const inHours = (hours: number, now: number) => new Date(now + hours * HOUR).toISOString()

/** One pending task per urgency bucket, plus a done and a snoozed one. */
export function sampleTasks(now: number): Task[] {
  return [
    makeTask({
      title: 'Reply to Priya about the vendor contract',
      deadline: inHours(-5, now),
      priority: 'urgent',
      source: 'gmail',
      people: ['Priya'],
      confidence: 0.94
    }),
    makeTask({
      title: 'Prepare slides for the design review',
      deadline: inHours(1.5, now),
      priority: 'high',
      source: 'gcalendar',
      confidence: 0.88
    }),
    makeTask({
      title: 'Send the Q3 budget report to Sarah',
      deadline: inHours(40, now),
      source: 'gmail',
      people: ['Sarah']
    }),
    makeTask({ title: 'Renew passport', deadline: inHours(24 * 10, now), priority: 'low' }),
    makeTask({ title: 'Read the onboarding doc', source: 'voice' }),
    makeTask({
      title: 'Book flights for the offsite',
      status: 'done',
      completedAt: inHours(-1, now)
    }),
    makeTask({
      title: 'Follow up with the landlord',
      status: 'snoozed',
      snoozedUntil: inHours(3, now)
    })
  ]
}

export function healthyReport(): HealthReport {
  return {
    checkedAt: new Date(EPOCH).toISOString(),
    ollama: { running: true, url: 'http://127.0.0.1:11435' },
    models: [
      { name: 'qwen2.5:3b', role: 'extraction', present: true },
      { name: 'nomic-embed-text', role: 'embedding', present: true }
    ],
    google: { connected: true, credentialsConfigured: true },
    problems: [],
    ok: true
  }
}

export function ollamaDownReport(): HealthReport {
  return {
    ...healthyReport(),
    ollama: { running: false, url: 'http://127.0.0.1:11435' },
    problems: ['Ollama is not reachable at http://127.0.0.1:11435. Start it, then re-check.'],
    ok: false
  }
}

export function googleDisconnectedReport(): HealthReport {
  return {
    ...healthyReport(),
    google: { connected: false, credentialsConfigured: true },
    problems: ['Google is not connected, so mail and calendar are not being read.'],
    ok: false
  }
}

export function manyProblemsReport(): HealthReport {
  return {
    ...ollamaDownReport(),
    google: { connected: false, credentialsConfigured: false },
    problems: [
      ...ollamaDownReport().problems,
      'The model qwen2.5:3b is not installed.',
      'Google sign-in is not set up yet.'
    ]
  }
}

export function sampleSuggestion(): RecurrenceSuggestion {
  return {
    id: 'suggestion-1',
    signature: 'standup',
    title: 'Team standup notes',
    weekdays: [1, 3, 5],
    time: '09:30',
    occurrences: 4,
    status: 'pending',
    createdAt: new Date(EPOCH).toISOString()
  }
}

export function sampleRule(): RecurrenceRule {
  return {
    id: 'rule-1',
    title: 'Water the plants',
    weekdays: [0, 3],
    time: '08:00',
    priority: 'low',
    leadMinutes: 60,
    enabled: true,
    createdAt: new Date(EPOCH).toISOString(),
    source: 'explicit'
  }
}
