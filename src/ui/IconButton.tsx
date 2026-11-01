import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

/**
 * Exactly one of these applies: cn() does not merge classes, so a colour
 * passed in className would lose or win by stylesheet order, not intent.
 */
const TONE = {
  quiet: 'text-ink-3 hover:bg-fill hover:text-ink-1 active:bg-fill-2',
  pressed: 'bg-fill-2 text-ink-1 hover:bg-fill-3',
  accent: 'text-accent hover:bg-fill active:bg-fill-2',
  primary: 'bg-accent-fill text-on-accent hover:brightness-110 active:brightness-95'
}

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Read out and shown as the tooltip; include the shortcut if there is one. */
  label: string
  children: ReactNode
  active?: boolean
  size?: 'sm' | 'md'
  tone?: keyof typeof TONE | undefined
}

export function IconButton({ label, children, active, size = 'md', tone, className, ...rest }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'focus-ring inline-grid shrink-0 place-items-center rounded-control transition-[background-color,color,filter] duration-150',
        'disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[15px] [&_svg]:stroke-[1.75]',
        size === 'md' ? 'size-7' : 'size-6',
        TONE[tone ?? (active ? 'pressed' : 'quiet')],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
