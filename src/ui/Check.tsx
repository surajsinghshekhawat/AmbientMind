import { Check as CheckIcon } from 'lucide-react'
import { cn } from './cn'

interface Props {
  checked: boolean
  onChange: () => void
  label: string
  tone?: 'neutral' | 'soon' | 'warning' | 'danger'
}

const RING: Record<NonNullable<Props['tone']>, string> = {
  neutral: 'shadow-[inset_0_0_0_1.25px_var(--ink-4)]',
  soon: 'shadow-[inset_0_0_0_1.25px_var(--soon)]',
  warning: 'shadow-[inset_0_0_0_1.25px_var(--warning)]',
  danger: 'shadow-[inset_0_0_0_1.25px_var(--danger)]'
}

/** The round task checkbox. The ring carries urgency; checking fills it green. */
export function Check({ checked, onChange, label, tone = 'neutral' }: Props) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation()
        onChange()
      }}
      className={cn(
        'group/check grid size-[18px] shrink-0 place-items-center rounded-full transition-[background-color,box-shadow,transform] duration-200 ease-out active:scale-90',
        checked ? 'bg-success shadow-none' : cn(RING[tone], 'hover:bg-fill-2')
      )}
    >
      <CheckIcon
        aria-hidden
        className={cn(
          'size-3 stroke-[3] transition-opacity duration-150',
          checked ? 'text-black/80 opacity-100' : 'text-ink-3 opacity-0 group-hover/check:opacity-100'
        )}
      />
    </button>
  )
}
