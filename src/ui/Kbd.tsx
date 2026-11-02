import { cn } from './cn'

const SIZE = {
  sm: 'h-[18px] min-w-[18px] rounded-[5px] px-1.5 text-micro',
  md: 'h-[22px] min-w-[22px] rounded-[6px] px-2 text-small',
  lg: 'h-7 min-w-7 rounded-[7px] px-2.5 text-body'
}

/** A keycap. Pass the glyph label from shared/shortcuts, e.g. "⌃⌥Space". */
export function Kbd({ children, size = 'sm', className }: { children: string; size?: keyof typeof SIZE; className?: string }) {
  return (
    <kbd className={cn('tabular inline-flex items-center justify-center bg-fill-2 font-sans text-ink-2 hairline', SIZE[size], className)}>
      {children}
    </kbd>
  )
}
