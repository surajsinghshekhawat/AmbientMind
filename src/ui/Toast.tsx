import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from './cn'

export interface ToastInput {
  message: string
  /** Undo, or any one follow-up. ⌘Z runs it while the toast is up. */
  action?: { label: string; run: () => void }
  tone?: 'neutral' | 'danger'
}

interface Shown extends ToastInput {
  id: number
}

interface ToastApi {
  show: (toast: ToastInput) => void
  /** Runs the visible toast's action, if any. Returns whether one ran. */
  runAction: () => boolean
  dismiss: () => void
}

const ToastContext = createContext<ToastApi | null>(null)
const ShownContext = createContext<Shown | null>(null)

const VISIBLE_MS = 5000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null)
  const current = useRef<Shown | null>(null)
  const seq = useRef(0)

  const dismiss = useCallback(() => {
    current.current = null
    setShown(null)
  }, [])

  const show = useCallback((toast: ToastInput) => {
    seq.current += 1
    const next = { ...toast, id: seq.current }
    current.current = next
    setShown(next)
  }, [])

  const runAction = useCallback(() => {
    const action = current.current?.action
    if (!action) return false
    dismiss()
    action.run()
    return true
  }, [dismiss])

  useEffect(() => {
    if (!shown) return
    const timer = setTimeout(() => {
      if (current.current?.id === shown.id) dismiss()
    }, VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [shown, dismiss])

  const api = useMemo(() => ({ show, runAction, dismiss }), [show, runAction, dismiss])
  return (
    <ToastContext.Provider value={api}>
      <ShownContext.Provider value={shown}>{children}</ShownContext.Provider>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast outside ToastProvider')
  return api
}

/** Where the toast appears. Sits in the layout, so it never covers a row. */
export function ToastRegion({ className }: { className?: string }) {
  const shown = useContext(ShownContext)
  const { runAction, dismiss } = useToast()
  return (
    <div aria-live="polite" className={cn('empty:hidden', className)}>
      {shown && (
        <div
          key={shown.id}
          className="flex h-9 animate-rise items-center gap-3 rounded-inner bg-fill-2 pr-1.5 pl-3 hairline"
        >
          <p className={cn('min-w-0 flex-1 truncate text-small', shown.tone === 'danger' ? 'text-danger' : 'text-ink-1')}>
            {shown.message}
          </p>
          {shown.action ? (
            <button
              type="button"
              onClick={() => runAction()}
              className="focus-ring h-6 rounded-[6px] px-2 text-small font-medium text-accent hover:bg-fill-2"
            >
              {shown.action.label}
            </button>
          ) : (
            <button
              type="button"
              onClick={dismiss}
              className="focus-ring h-6 rounded-[6px] px-2 text-small text-ink-3 hover:bg-fill-2"
            >
              OK
            </button>
          )}
        </div>
      )}
    </div>
  )
}
