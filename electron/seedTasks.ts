import { addTasksIgnoringDuplicates, listActive, type NewTask } from './services/taskStore'

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()

/**
 * Development fixture covering every urgency bucket, so the visual language can
 * be checked without the AI or integration layers existing yet. Only applied to
 * an empty store, and never in a packaged build.
 */
function fixtures(): NewTask[] {
  return [
    {
      title: 'Reply to Priya about the vendor contract',
      deadline: hoursFromNow(-5),
      priority: 'urgent',
      source: 'gmail',
      sourceId: 'seed-1',
      people: ['Priya'],
      confidence: 0.94
    },
    {
      title: 'Prepare slides for the design review',
      deadline: hoursFromNow(1.5),
      priority: 'urgent',
      source: 'gcalendar',
      sourceId: 'seed-2',
      confidence: 0.88
    },
    {
      title: 'Send the Q3 budget report to Sarah',
      deadline: hoursFromNow(19),
      priority: 'high',
      source: 'gmail',
      sourceId: 'seed-3',
      people: ['Sarah'],
      confidence: 0.91
    },
    {
      title: 'Review the pull request from Daniel',
      deadline: hoursFromNow(40),
      priority: 'medium',
      source: 'gmail',
      sourceId: 'seed-4',
      people: ['Daniel'],
      confidence: 0.79
    },
    {
      title: 'Book the flights for the Bangalore trip',
      deadline: hoursFromNow(96),
      priority: 'medium',
      source: 'manual'
    },
    {
      title: 'Renew the domain registration',
      deadline: null,
      priority: 'low',
      source: 'manual'
    }
  ]
}

export function seedIfEmpty() {
  if (listActive().length > 0) return
  addTasksIgnoringDuplicates(fixtures())
}
