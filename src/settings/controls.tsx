import { Children, useId, type ReactNode, type SelectHTMLAttributes } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { cn } from '@/ui/cn'

export function Page({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[560px] animate-fade flex-col gap-6 px-8 pt-5 pb-16">
      <header>
        <h1 className="text-display font-semibold tracking-[-0.01em] text-ink-1">{title}</h1>
        {description && <p className="mt-1 text-body text-ink-3">{description}</p>}
      </header>
      {children}
    </div>
  )
}

/** A titled block of rows, as in System Settings. */
export function Group({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  const rows = Children.toArray(children).filter(Boolean)
  return (
    <section className="flex flex-col gap-2">
      {title && <h2 className="px-1 text-small font-medium text-ink-2">{title}</h2>}
      {rows.length > 0 && (
        <div className="flex flex-col rounded-inner bg-fill hairline [&>*+*]:shadow-[inset_0_0.5px_0_var(--hairline)]">{rows}</div>
      )}
      {footer && <div className="px-1 text-small leading-[1.45] text-ink-3">{footer}</div>}
    </section>
  )
}

interface RowProps {
  label: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Puts the control under the label, for text areas and wide pickers. */
  stacked?: boolean
  htmlFor?: string
}

export function Row({ label, description, children, stacked, htmlFor }: RowProps) {
  const Label = htmlFor ? 'label' : 'div'
  return (
    <div className={cn('flex min-h-11 gap-x-4 gap-y-2 px-3.5 py-2.5', stacked ? 'flex-col' : 'items-center')}>
      <Label htmlFor={htmlFor} className="min-w-0 flex-1">
        <span className="block text-body text-ink-1">{label}</span>
        {description && <span className="mt-0.5 block text-small leading-[1.4] text-ink-3">{description}</span>}
      </Label>
      {children && <div className={cn('flex shrink-0 items-center gap-2', stacked && 'w-full')}>{children}</div>}
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'focus-ring relative h-[18px] w-8 shrink-0 rounded-full transition-colors duration-200',
        checked ? 'bg-accent' : 'bg-fill-3'
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] left-[2px] size-[14px] rounded-full bg-white shadow-[0_1px_2px_oklch(0_0_0/0.3)] transition-transform duration-200 ease-[var(--ease-spring)]',
          checked && 'translate-x-[14px]'
        )}
      />
    </button>
  )
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cn('relative inline-flex', className)}>
      <select
        {...rest}
        className="focus-ring h-7 w-full cursor-default appearance-none rounded-control bg-fill-2 pr-7 pl-2.5 text-body text-ink-1 hairline"
      >
        {children}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2 text-ink-3" />
    </span>
  )
}

interface SegmentedProps<T extends string> {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}

export function Segmented<T extends string>({ value, options, onChange, label }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-7 rounded-control bg-fill-2 p-[2px] hairline">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'focus-ring rounded-[6px] px-2.5 text-small font-medium transition-colors duration-150',
            value === option.value
              ? 'bg-[var(--window)] text-ink-1 shadow-[0_0.5px_2px_oklch(0_0_0/0.25),inset_0_0_0_0.5px_var(--hairline-2)]'
              : 'text-ink-2 hover:text-ink-1'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export const fieldClass =
  'focus-ring h-7 rounded-control bg-fill-2 px-2.5 text-body text-ink-1 hairline placeholder:text-ink-4'

export const areaClass =
  'focus-ring w-full resize-none rounded-control bg-fill-2 px-2.5 py-2 text-body leading-[1.5] text-ink-1 hairline placeholder:text-ink-4'

/** Small coloured state: Allowed, Connected, Missing. */
export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'quiet' | 'soon'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-micro font-medium whitespace-nowrap',
        tone === 'ok' && 'bg-[color-mix(in_oklch,var(--success)_16%,transparent)] text-success',
        tone === 'warn' && 'bg-[color-mix(in_oklch,var(--warning)_16%,transparent)] text-warning',
        tone === 'bad' && 'bg-[color-mix(in_oklch,var(--danger)_16%,transparent)] text-danger',
        tone === 'quiet' && 'bg-fill-2 text-ink-2',
        tone === 'soon' && 'bg-fill-2 text-ink-2'
      )}
    >
      {children}
    </span>
  )
}

export function useFieldId(): string {
  return useId()
}
