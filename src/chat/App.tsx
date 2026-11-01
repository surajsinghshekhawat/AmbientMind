import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, Square, Trash2, X } from 'lucide-react'
import type { OrbLook } from '@shared/orb'
import type { ChatTurn } from '@shared/types'
import { cn } from '@/ui/cn'
import { THIS_DEVICE } from '@/ui/device'
import { IconButton } from '@/ui/IconButton'
import { Markdown } from '@/ui/Markdown'
import { Orb } from '@/ui/Orb'
import { StatusLine } from '@/ui/StatusLine'

interface Entry extends ChatTurn {
  /** What actually changed, so the card can show its work. */
  actions?: string[]
  stopped?: boolean
  failed?: string
}

const SUGGESTIONS = ["What's urgent today?", 'Move the report to tomorrow morning', 'Add: pay the tuition fees on Friday']

function look(busy: boolean): OrbLook {
  return { motion: busy ? 'composing' : 'breathing', calm: !busy, arc: null, badge: null, attention: false, peek: '' }
}

function Steps({ actions }: { actions: string[] }) {
  return (
    <ul className="flex flex-col gap-1.5 not-first:mt-3" aria-label="What changed">
      {actions.map((action) => (
        <li key={action} className="flex items-start gap-2 text-small text-ink-2">
          <span className="mt-[5px] size-[5px] shrink-0 rounded-full bg-success" />
          {action}
        </li>
      ))}
    </ul>
  )
}

interface Props {
  /** For the gallery: start with a conversation and a state. */
  initialEntries?: Entry[]
  initialBusy?: boolean
}

export function App({ initialEntries, initialBusy = false }: Props = {}) {
  const [entries, setEntries] = useState<Entry[]>(initialEntries ?? [])
  const [ready, setReady] = useState(Boolean(initialEntries))
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(initialBusy)
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (initialEntries) return
    void window.ambient.getChatHistory().then((turns) => {
      setEntries(turns)
      setReady(true)
    })
  }, [initialEntries])

  useEffect(() => {
    if (!ready || initialEntries) return
    const turns = entries.filter((e) => !e.stopped && !e.failed).map(({ role, content }) => ({ role, content }))
    void window.ambient.saveChatHistory(turns)
  }, [entries, ready, initialEntries])

  // Following the newest turn has to be immediate; a smooth scroll restarts on every update.
  useLayoutEffect(() => {
    const thread = threadRef.current
    if (thread) thread.scrollTop = thread.scrollHeight
  }, [entries, busy])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`
  }, [draft])

  const send = async (text: string) => {
    const message = text.trim()
    if (!message || busy) return
    // History excludes the message being sent; the main process appends it.
    // What was changed goes too, so "I said in an hour" can find the task it means.
    const history = entries
      .filter((e) => !e.stopped && !e.failed)
      .map(({ role, content, actions }) => ({ role, content: [content, ...(actions ?? [])].filter(Boolean).join(' ') }))
    setEntries((current) => [...current, { role: 'user', content: message }])
    setDraft('')
    setBusy(true)
    try {
      const result = await window.ambient.chat(message, history)
      setEntries((current) => [
        ...current,
        result.stopped
          ? { role: 'assistant', content: '', stopped: true }
          : { role: 'assistant', content: result.reply, actions: result.actions }
      ])
    } catch (err) {
      setEntries((current) => [
        ...current,
        {
          role: 'assistant',
          content: '',
          failed: `${(err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}. If the model is not running, start it and try again.`
        }
      ])
    } finally {
      setBusy(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  const clear = () => {
    setEntries([])
    inputRef.current?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (busy) window.ambient.stopChat()
      else window.ambient.closeChat()
    }
  }

  const lastUser = [...entries].reverse().find((e) => e.role === 'user')

  return (
    <div className="h-full p-px" onKeyDown={onKeyDown}>
      <div className="glass flex h-full flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-1.5 pr-2 pl-2 [-webkit-app-region:drag]">
          <span className="grid size-9 place-items-center">
            <Orb look={look(busy)} size={34} bare />
          </span>
          <h1 className="flex-1 truncate text-body font-medium text-ink-1">Ask AmbientMind</h1>
          <div className="flex [-webkit-app-region:no-drag]">
            <IconButton label="Clear conversation" onClick={clear} disabled={busy || entries.length === 0}>
              <Trash2 />
            </IconButton>
            <IconButton label="Close (Esc)" onClick={() => window.ambient.closeChat()}>
              <X />
            </IconButton>
          </div>
        </header>

        <div
          ref={threadRef}
          role="log"
          aria-label="Conversation"
          className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 [mask-image:linear-gradient(to_bottom,transparent_0,#000_14px,#000_100%)] [scrollbar-width:none]"
        >
          {ready && entries.length === 0 && !busy && (
            <div className="flex animate-rise flex-col gap-1 pt-3">
              <p className="px-1 pb-2 text-small text-ink-3">
                Ask about your tasks, or tell it what to change. It runs on {THIS_DEVICE}.
              </p>
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void send(suggestion)}
                  className="focus-ring rounded-inner px-3 py-2 text-left text-body text-ink-2 transition-colors hover:bg-fill hover:text-ink-1"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {entries.map((entry, index) =>
            entry.role === 'user' ? (
              <div
                key={index}
                className={cn('flex animate-rise justify-end', index > 0 && 'mt-5 border-t-[0.5px] border-hairline pt-5')}
              >
                <p className="max-w-[82%] rounded-[16px_16px_5px_16px] bg-fill-2 px-3.5 py-2 text-body whitespace-pre-wrap text-ink-1 hairline [overflow-wrap:anywhere]">
                  {entry.content}
                </p>
              </div>
            ) : (
              <div key={index} className="mt-3 animate-rise">
                {entry.stopped ? (
                  <p className="flex items-center gap-2 text-small text-ink-3">
                    <i className="size-[7px] rounded-[2px] bg-danger" />
                    Stopped
                  </p>
                ) : entry.failed ? (
                  <div className="flex items-start gap-2 text-small text-danger">
                    <span className="min-w-0 flex-1">{entry.failed}</span>
                    {lastUser && index === entries.length - 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setEntries((current) => current.slice(0, -2))
                          void send(lastUser.content)
                        }}
                        className="focus-ring shrink-0 rounded-control px-1.5 text-small font-medium text-ink-1 hover:bg-fill"
                      >
                        Try again
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="text-title leading-[1.55] text-ink-1">
                    {entry.content && <Markdown source={entry.content} />}
                    {entry.actions && entry.actions.length > 0 && <Steps actions={entry.actions} />}
                  </div>
                )}
              </div>
            )
          )}

          {busy && (
            <div className="mt-3">
              <StatusLine text="Thinking…" live />
            </div>
          )}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void send(draft)
          }}
          className="m-2 mt-0 flex shrink-0 items-end gap-1 rounded-[14px] bg-fill py-1 pr-1 pl-3 hairline"
        >
          <textarea
            ref={inputRef}
            value={draft}
            rows={1}
            autoFocus
            aria-label="Message"
            placeholder="Ask, or tell it what to change…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void send(draft)
              }
              if (event.key === 'ArrowUp' && !draft && lastUser) {
                event.preventDefault()
                setDraft(lastUser.content)
              }
            }}
            className="max-h-[120px] min-h-7 flex-1 resize-none bg-transparent py-[5px] text-body text-ink-1 outline-none placeholder:text-ink-4"
          />
          {busy ? (
            <IconButton label="Stop (Esc)" onClick={() => window.ambient.stopChat()} tone="pressed">
              <Square />
            </IconButton>
          ) : (
            <IconButton
              label="Send (Enter)"
              type="submit"
              disabled={!draft.trim()}
              tone="primary"
            >
              <ArrowUp />
            </IconButton>
          )}
        </form>
      </div>
    </div>
  )
}
