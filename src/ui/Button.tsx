import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-110 active:brightness-95',
  secondary: 'bg-fill-2 text-ink-1 hairline hover:bg-fill-3',
  ghost: 'text-ink-2 hover:bg-fill hover:text-ink-1',
  danger: 'text-danger hover:bg-fill'
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
}

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={cn(
        'focus-ring inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control font-medium whitespace-nowrap transition-[background-color,color,filter] duration-150',
        'disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5 [&_svg]:stroke-2',
        size === 'md' ? 'h-7 px-3 text-body' : 'h-6 px-2 text-small',
        VARIANT[variant],
        className
      )}
      {...rest}
    />
  )
}
