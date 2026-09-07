import { useEffect, useRef, useState } from 'react'

export function App() {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // The window is hidden rather than destroyed between invocations, so the
  // renderer keeps its state and has to be reset each time it is shown.
  useEffect(
    () =>
      window.ambient.quickAdd.onOpened(() => {
        setValue('')
        inputRef.current?.focus()
      }),
    []
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      window.ambient.quickAdd.cancel()
    } else if (event.key === 'Enter' && value.trim()) {
      window.ambient.quickAdd.submit(value)
      setValue('')
    }
  }

  return (
    <div className="flex h-full items-center gap-3 rounded-2xl border border-white/15 bg-black/70 px-5 backdrop-blur-xl">
      <span className="text-[11px] font-medium tracking-[0.18em] text-white/35 uppercase">Add</span>
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="What needs doing?"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-[15px] text-white/95 placeholder:text-white/30 focus:outline-none"
      />
      <kbd className="shrink-0 rounded-md border border-white/15 px-2 py-1 text-[10px] text-white/40">
        {value.trim() ? 'Enter' : 'Esc'}
      </kbd>
    </div>
  )
}
