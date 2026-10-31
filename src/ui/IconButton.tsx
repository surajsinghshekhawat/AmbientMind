import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Read out and shown as the tooltip; include the shortcut if there is one. */
  label: string
  children: ReactNode
  active?: boolean
  size?: 'sm' | 'md'
}

export function IconButton({ label, children, active, size = 'md', className, ...rest }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'focus-ring inline-grid shrink-0 place-items-center rounded-control text-ink-3 transition-colors duration-150',
        'hover:bg-fill hover:text-ink-1 active:bg-fill-2 disabled:pointer-events-none disabled:opacity-40',
        '[&_svg]:size-[15px] [&_svg]:stroke-[1.75]',
        size === 'md' ? 'size-7' : 'size-6',
        active && 'bg-fill-2 text-ink-1',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
