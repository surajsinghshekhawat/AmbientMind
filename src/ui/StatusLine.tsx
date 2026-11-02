import { cn } from './cn'

/** One line of status. Shimmers while something is running; re-enters on change. */
export function StatusLine({ text, live, className }: { text: string; live?: boolean; className?: string }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn('min-w-0 truncate text-small text-ink-2', className)}
    >
      <span key={text} className={cn('inline-block max-w-full truncate align-top animate-rise', live && 'shimmer')}>
        {text}
      </span>
    </p>
  )
}
