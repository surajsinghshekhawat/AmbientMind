import { useState } from 'react'
import {
  describeRule,
  parseRecurrence,
  weekdayLabel,
  type RecurrenceRule
} from '@shared/recurrence'

interface Props {
  rules: RecurrenceRule[]
  onChange: (rules: RecurrenceRule[]) => void
}

const DAYS = [0, 1, 2, 3, 4, 5, 6]

export function Recurring({ rules, onChange }: Props) {
  const [phrase, setPhrase] = useState('')
  const [title, setTitle] = useState('')
  const [weekdays, setWeekdays] = useState<number[]>([])
  const [time, setTime] = useState('17:00')
  const [error, setError] = useState<string | null>(null)

  // Typing the sentence fills the form, so what the app understood is visible
  // before anything is saved. This is the same parser voice input uses.
  const applyPhrase = (value: string) => {
    setPhrase(value)
    const parsed = parseRecurrence(value)
    if (!parsed) return
    setTitle(parsed.title)
    setWeekdays(parsed.weekdays)
    setTime(parsed.time)
    setError(null)
  }

  const toggleDay = (day: number) => {
    setWeekdays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort()
    )
  }

  const save = async () => {
    if (!title.trim()) return setError('Give the commitment a name.')
    if (weekdays.length === 0) return setError('Pick at least one day.')
    setError(null)

    const { rules: next } = await window.ambient.rules.add({
      title: title.trim(),
      weekdays,
      time,
      priority: 'medium',
      leadMinutes: 0,
      enabled: true,
      source: 'explicit'
    })
    onChange(next)
    setPhrase('')
    setTitle('')
    setWeekdays([])
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[11px] font-medium tracking-[0.16em] text-white/40 uppercase">
        Recurring
      </h2>

      {rules.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${rule.enabled ? '' : 'text-white/40 line-through'}`}>
                  {rule.title}
                </p>
                <p className="text-[12px] text-white/45">{describeRule(rule)}</p>
              </div>
              <button
                type="button"
                className={btnGhost}
                onClick={async () =>
                  onChange(await window.ambient.rules.update(rule.id, { enabled: !rule.enabled }))
                }
              >
                {rule.enabled ? 'Pause' : 'Resume'}
              </button>
              <button
                type="button"
                className={btnGhost}
                onClick={async () => onChange(await window.ambient.rules.remove(rule.id))}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
        <label className="flex flex-col gap-1 text-sm">
          Describe it
          <input
            value={phrase}
            onChange={(e) => applyPhrase(e.target.value)}
            placeholder="tuition Tue, Thu, Sat at 5pm"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Name
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </label>

        <div className="flex flex-col gap-1 text-sm">
          Days
          <div className="flex flex-wrap gap-1">
            {DAYS.map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`rounded-lg border px-2.5 py-1 text-[12px] ${
                  weekdays.includes(day)
                    ? 'border-white/50 bg-white/20 text-white'
                    : 'border-white/15 text-white/55 hover:bg-white/10'
                }`}
              >
                {weekdayLabel(day).slice(0, 3)}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          Time
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className={inputClass}
          />
        </label>

        {error && <p className="text-[12px] text-urgency-overdue">{error}</p>}

        <div className="flex items-center gap-3">
          <button type="button" className={btnClass} onClick={() => void save()}>
            Add rule
          </button>
          <p className="text-[12px] text-white/40">
            Occurrences appear as tasks two weeks ahead and refill as days pass.
          </p>
        </div>
      </div>
    </section>
  )
}

const btnClass =
  'rounded-lg bg-white/15 px-3 py-1.5 text-sm text-white hover:bg-white/25 disabled:opacity-40'
const btnGhost =
  'rounded-lg border border-white/15 px-2.5 py-1 text-[12px] text-white/80 hover:bg-white/10'
const inputClass =
  'rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white focus:outline-none'
