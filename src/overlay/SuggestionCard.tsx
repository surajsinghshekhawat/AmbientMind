import { describeRule } from '@shared/recurrence'
import type { RecurrenceSuggestion } from '@shared/types'

interface Props {
  suggestion: RecurrenceSuggestion
  onAccept: (id: string) => void
  onDismiss: (id: string) => void
}

/**
 * One at a time, and only ever a question. Silently creating a repeating task
 * from a guess is the failure mode this whole feature is designed to avoid.
 */
export function SuggestionCard({ suggestion, onAccept, onDismiss }: Props) {
  return (
    <div className="mx-2 rounded-lg border border-white/15 bg-black/50 px-3 py-2.5">
      <p className="text-[12px] leading-relaxed text-white/85">
        <span className="text-white">{suggestion.title}</span> has come up{' '}
        {suggestion.occurrences} times, {describeRule(suggestion).toLowerCase()}. Make it
        recurring?
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => onAccept(suggestion.id)}
          className="rounded-md bg-white/15 px-2.5 py-1 text-[11px] text-white hover:bg-white/25"
        >
          Yes, repeat it
        </button>
        <button
          type="button"
          onClick={() => onDismiss(suggestion.id)}
          className="rounded-md border border-white/15 px-2.5 py-1 text-[11px] text-white/75 hover:bg-white/10"
        >
          Not weekly
        </button>
      </div>
    </div>
  )
}
