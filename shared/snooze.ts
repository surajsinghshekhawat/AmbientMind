export interface SnoozeChoice {
  id: string
  label: string
  /** Resolved against `now` so the menu is honest about what it will do. */
  resolve: (now: Date) => Date
}

function atHour(now: Date, dayOffset: number, hour: number): Date {
  const next = new Date(now)
  next.setDate(next.getDate() + dayOffset)
  next.setHours(hour, 0, 0, 0)
  return next
}

export const SNOOZE_CHOICES: SnoozeChoice[] = [
  { id: '1h', label: '1 hour', resolve: (now) => new Date(now.getTime() + 3_600_000) },
  { id: '3h', label: '3 hours', resolve: (now) => new Date(now.getTime() + 3 * 3_600_000) },
  {
    id: 'tonight',
    label: 'This evening',
    // Already past 18:00 means "this evening" has gone; roll to tomorrow rather
    // than silently un-snoozing the task a second later.
    resolve: (now) => (now.getHours() < 18 ? atHour(now, 0, 18) : atHour(now, 1, 18))
  },
  { id: 'tomorrow', label: 'Tomorrow 9am', resolve: (now) => atHour(now, 1, 9) },
  { id: 'nextweek', label: 'Next week', resolve: (now) => atHour(now, 7, 9) }
]
