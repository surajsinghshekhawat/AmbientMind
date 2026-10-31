import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { describeRule, parseRecurrence, weekdayLabel, type RecurrenceRule } from '@shared/recurrence'
import type { RecurrenceSuggestion } from '@shared/types'
import { Button } from '@/ui/Button'
import { cn } from '@/ui/cn'
import { IconButton } from '@/ui/IconButton'
import { fieldClass, Group, Page, Row, Toggle } from './controls'

interface Props {
  rules: RecurrenceRule[]
  suggestions: RecurrenceSuggestion[]
  onChange: (rules: RecurrenceRule[]) => void
  onSuggestionsChange: (suggestions: RecurrenceSuggestion[]) => void
}

/** Monday first, as people read a week. */
const DAYS = [1, 2, 3, 4, 5, 6, 0]

export function Recurring({ rules, suggestions, onChange, onSuggestionsChange }: Props) {
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
    setWeekdays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort()))
  }

  const save = async () => {
    if (!title.trim()) return setError('Give it a name.')
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
    <Page title="Recurring" description="Commitments that repeat every week. They appear as tasks two weeks ahead.">
      {suggestions.length > 0 && (
        <Group title="Noticed a pattern">
          {suggestions.map((suggestion) => (
            <Row
              key={suggestion.id}
              label={suggestion.title}
              description={`Seen ${suggestion.occurrences} times · ${describeRule(suggestion)}`}
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => onSuggestionsChange(await window.ambient.rules.dismissSuggestion(suggestion.id))}
              >
                Not weekly
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  const result = await window.ambient.rules.acceptSuggestion(suggestion.id)
                  onSuggestionsChange(result.suggestions)
                  onChange(result.rules)
                }}
              >
                Make recurring
              </Button>
            </Row>
          ))}
        </Group>
      )}

      {rules.length > 0 && (
        <Group title="Your rules">
          {rules.map((rule) => (
            <Row
              key={rule.id}
              label={<span className={cn(!rule.enabled && 'text-ink-3')}>{rule.title}</span>}
              description={rule.enabled ? describeRule(rule) : `Paused · ${describeRule(rule)}`}
            >
              <Toggle
                label={`${rule.title} on`}
                checked={rule.enabled}
                onChange={async (enabled) => onChange(await window.ambient.rules.update(rule.id, { enabled }))}
              />
              <IconButton label={`Delete ${rule.title}`} size="sm" onClick={async () => onChange(await window.ambient.rules.remove(rule.id))}>
                <Trash2 />
              </IconButton>
            </Row>
          ))}
        </Group>
      )}

      <Group
        title="Add a rule"
        footer={
          <div className="flex items-center gap-3">
            <span className={cn('flex-1', error && 'text-danger')}>{error ?? 'Write it the way you would say it.'}</span>
            <Button variant="primary" onClick={() => void save()}>
              Add rule
            </Button>
          </div>
        }
      >
        <Row label="Describe it" htmlFor="rule-phrase" stacked>
          <input
            id="rule-phrase"
            value={phrase}
            onChange={(e) => applyPhrase(e.target.value)}
            placeholder="Tuition every Tue, Thu and Sat at 5pm"
            className={cn(fieldClass, 'w-full')}
          />
        </Row>
        <Row label="Name" htmlFor="rule-title">
          <input id="rule-title" value={title} onChange={(e) => setTitle(e.target.value)} className={cn(fieldClass, 'w-56')} />
        </Row>
        <Row label="Days">
          <div className="flex gap-1" role="group" aria-label="Days">
            {DAYS.map((day) => (
              <button
                key={day}
                type="button"
                aria-pressed={weekdays.includes(day)}
                onClick={() => toggleDay(day)}
                className={cn(
                  'focus-ring size-7 rounded-full text-small font-medium transition-colors duration-150',
                  weekdays.includes(day) ? 'bg-accent text-on-accent' : 'bg-fill-2 text-ink-2 hover:bg-fill-3'
                )}
              >
                {weekdayLabel(day).slice(0, 2)}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Time" htmlFor="rule-time">
          <input id="rule-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className={cn(fieldClass, 'tabular')} />
        </Row>
      </Group>
    </Page>
  )
}
