import type { Task } from '@shared/types'

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()

/**
 * Phase 1 fixture. Covers every urgency bucket so the visual language can be
 * checked without any of the AI or integration layers existing yet.
 * Replaced by the SQLite store in Phase 2.
 */
export const seedTasks: Task[] = [
  {
    id: '1',
    title: 'Reply to Priya about the vendor contract',
    deadline: hoursFromNow(-5),
    priority: 'urgent',
    source: 'gmail',
    sourceId: 'seed-1',
    people: ['Priya'],
    rawContext: null,
    confidence: 0.94,
    status: 'pending',
    createdAt: hoursFromNow(-30),
    completedAt: null
  },
  {
    id: '2',
    title: 'Prepare slides for the design review',
    deadline: hoursFromNow(1.5),
    priority: 'urgent',
    source: 'gcalendar',
    sourceId: 'seed-2',
    people: [],
    rawContext: null,
    confidence: 0.88,
    status: 'pending',
    createdAt: hoursFromNow(-20),
    completedAt: null
  },
  {
    id: '3',
    title: 'Send the Q3 budget report to Sarah',
    deadline: hoursFromNow(19),
    priority: 'high',
    source: 'gmail',
    sourceId: 'seed-3',
    people: ['Sarah'],
    rawContext: null,
    confidence: 0.91,
    status: 'pending',
    createdAt: hoursFromNow(-12),
    completedAt: null
  },
  {
    id: '4',
    title: 'Review the pull request from Daniel',
    deadline: hoursFromNow(40),
    priority: 'medium',
    source: 'gmail',
    sourceId: 'seed-4',
    people: ['Daniel'],
    rawContext: null,
    confidence: 0.79,
    status: 'pending',
    createdAt: hoursFromNow(-8),
    completedAt: null
  },
  {
    id: '5',
    title: 'Book the flights for the Bangalore trip',
    deadline: hoursFromNow(96),
    priority: 'medium',
    source: 'manual',
    sourceId: null,
    people: [],
    rawContext: null,
    confidence: 1,
    status: 'pending',
    createdAt: hoursFromNow(-4),
    completedAt: null
  },
  {
    id: '6',
    title: 'Renew the domain registration',
    deadline: null,
    priority: 'low',
    source: 'manual',
    sourceId: null,
    people: [],
    rawContext: null,
    confidence: 1,
    status: 'pending',
    createdAt: hoursFromNow(-2),
    completedAt: null
  }
]
