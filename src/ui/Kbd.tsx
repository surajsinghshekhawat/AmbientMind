import { cn } from './cn'

/** A keycap. Pass the glyph label from shared/shortcuts, e.g. "⌃⌥Space". */
export function Kbd({ children, className }: { children: string; className?: string }) {
  return (
    <kbd
      className={cn(
        'tabular inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-fill-2 px-1.5 font-sans text-micro text-ink-2 hairline',
        className
      )}
    >
      {children}
    </kbd>
  )
}
