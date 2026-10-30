import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatTurn } from '@shared/types'

interface Entry extends ChatTurn {
  /** What actually changed, so the panel can show its work. */
  actions?: string[]
}

const SUGGESTIONS = [
  "What's urgent today?",
  'Push the report to tomorrow morning',
  'Add: pay the tuition fees on Friday'
]

export function App() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [ready, setReady] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.ambient.getChatHistory().then((turns) => {
      setEntries(turns)
      setReady(true)
    })
  }, [])

  useEffect(() => {
    if (!ready) return
    void window.ambient.saveChatHistory(entries.map(({ role, content }) => ({ role, content })))
  }, [entries, ready])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries, busy])

  const send = async (text: string) => {
    const message = text.trim()
    if (!message || busy) return

    // History excludes the message being sent; the main process appends it.
    const history: ChatTurn[] = entries.map(({ role, content }) => ({ role, content }))
    setEntries((current) => [...current, { role: 'user', content: message }])
    setDraft('')
    setBusy(true)
    setError(null)

    try {
      const result = await window.ambient.chat(message, history)
      setEntries((current) => [
        ...current,
        { role: 'assistant', content: result.reply, actions: result.actions }
      ])
    } catch (err) {
      setError(
        `${(err as Error).message}. If Ollama is not running, start it and try again.`
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-[#141414] text-white">
      <header className="border-b border-white/10 px-4 py-3">
        <h1 className="text-sm font-medium">Ask about your tasks</h1>
        <p className="mt-0.5 text-[11px] text-white/40">
          It can also change them. Everything stays on this machine.
        </p>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {ready && entries.length === 0 && (
          <div className="space-y-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void send(suggestion)}
                className="block w-full rounded-lg border border-white/10 px-3 py-2 text-left text-[12px] text-white/60 hover:bg-white/5"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {entries.map((entry, index) => (
          <div
            key={index}
            className={entry.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                entry.role === 'user'
                  ? 'bg-white/15 text-white'
                  : 'border border-white/10 bg-white/5 text-white/90'
              }`}
            >
              {entry.content}
              {entry.actions && entry.actions.length > 0 && (
                <ul className="mt-1.5 border-t border-white/10 pt-1.5 text-[11px] text-white/45">
                  {entry.actions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}

        {busy && <p className="text-[12px] text-white/40">Thinking…</p>}
        {error && <p className="text-[12px] text-urgency-overdue">{error}</p>}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void send(draft)
        }}
        className="flex gap-2 border-t border-white/10 px-4 py-3"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask or tell it what to change…"
          autoFocus
          className="flex-1 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="rounded-lg bg-white/15 px-3 py-2 text-sm text-white hover:bg-white/25 disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  )
}
