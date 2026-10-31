import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Check as CheckIcon, MessageCircle, Plus, Search, Settings, TriangleAlert, X } from 'lucide-react'
import { findClashes } from '@shared/clash'
import { ACTIVITY_LINE, orbLook, type Activity } from '@shared/orb'
import { allClearLine, panelSections } from '@shared/panel'
import { describeRule } from '@shared/recurrence'
import type { ShortcutStatus } from '@shared/shortcuts'
import type { HealthReport, RecurrenceSuggestion, Task } from '@shared/types'
import { Button } from '@/ui/Button'
import { cn } from '@/ui/cn'
import { IconButton } from '@/ui/IconButton'
import { Kbd } from '@/ui/Kbd'
import { Orb } from '@/ui/Orb'
import { StatusLine } from '@/ui/StatusLine'
import { ToastRegion, useToast } from '@/ui/Toast'
import { TaskRow, type RowActions, type RowView } from './TaskRow'

export interface PanelProps {
  tasks: Task[]
  now: number
  activity: Activity
  health: HealthReport | null
  recurrence: RecurrenceSuggestion[]
  lastRun: string | null
  syncIntervalMinutes: number
  maxVisible: number
  shortcuts: ShortcutStatus[]
  onTasks: (tasks: Task[]) => void
  onRecurrence: (next: RecurrenceSuggestion[]) => void
  onCollapse: () => void
  onRecheckHealth: () => void
  onConnectGoogle: () => void
  /** The overlay takes focus on open; the gallery shows many panels at once. */
  autoFocus?: boolean
}

const VIEW_LABEL: Record<RowView, string> = { open: 'Open', done: 'Done today', snoozed: 'Snoozed' }

function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return Boolean(el?.closest('input, textarea, select, [contenteditable="true"]'))
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="pt-2 first:pt-0">
      <div className="flex h-7 items-center justify-between px-2.5">
        <h3 className="text-small font-medium text-ink-3">{title}</h3>
        {aside}
      </div>
      <ul role="presentation" className="flex flex-col gap-px">
        {children}
      </ul>
    </section>
  )
}

export function Panel(props: PanelProps) {
  const { tasks, now, activity, health, recurrence, onTasks, onRecurrence, onCollapse } = props
  const toast = useToast()
  const [view, setView] = useState<RowView>('open')
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [snoozingId, setSnoozingId] = useState<string | null>(null)
  const [showAllLater, setShowAllLater] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const sections = useMemo(() => panelSections(tasks, now, query), [tasks, now, query])
  const clash = useMemo(() => findClashes(tasks, { now })[0] ?? null, [tasks, now])
  const attention = Boolean(health && !health.ok)
  const look = orbLook({ tasks, now, activity, attention })

  const later = showAllLater ? sections.later : sections.later.slice(0, props.maxVisible)
  const hiddenLater = sections.later.length - later.length
  const rows: Task[] =
    view === 'open'
      ? [...sections.now, ...sections.suggested, ...sections.upcoming, ...later]
      : view === 'done'
        ? sections.doneToday
        : sections.snoozed
  const openCount = sections.now.length + sections.upcoming.length + sections.later.length
  const hasOtherViews = sections.doneToday.length > 0 || sections.snoozed.length > 0 || view !== 'open'

  // Keep a valid selection as rows come and go.
  useEffect(() => {
    if (selectedId && rows.some((task) => task.id === selectedId)) return
    setSelectedId(rows[0]?.id ?? null)
  }, [rows, selectedId])

  useEffect(() => {
    if (props.autoFocus !== false) rootRef.current?.focus({ preventScroll: true })
  }, [props.autoFocus])

  // The window is exactly as tall as the content; main caps it at the screen.
  useLayoutEffect(() => {
    const measure = () => {
      const root = rootRef.current
      const body = bodyRef.current
      const content = body?.firstElementChild as HTMLElement | null
      if (!root || !body || !content) return
      // Summed from parts that never shrink, so the answer does not depend on
      // how tall the window happens to be right now.
      const style = getComputedStyle(body)
      let natural = content.offsetHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      for (const child of Array.from(root.children) as HTMLElement[]) {
        if (child === body) continue
        const margins = getComputedStyle(child)
        natural += child.offsetHeight + parseFloat(margins.marginTop) + parseFloat(margins.marginBottom)
      }
      window.ambient.setPanelHeight(Math.ceil(natural) + 2)
    }
    measure()
    const observer = new ResizeObserver(measure)
    const watched = [bodyRef.current?.firstElementChild, ...Array.from(rootRef.current?.children ?? [])]
    for (const el of watched) if (el) observer.observe(el)
    // The search row comes and goes; children are re-observed on every change.
    const mutations = new MutationObserver(() => {
      for (const el of Array.from(rootRef.current?.children ?? [])) observer.observe(el)
      measure()
    })
    if (rootRef.current) mutations.observe(rootRef.current, { childList: true })
    return () => {
      observer.disconnect()
      mutations.disconnect()
    }
  }, [])

  const neighbour = useCallback(
    (id: string) => {
      const index = rows.findIndex((task) => task.id === id)
      return rows[index + 1]?.id ?? rows[index - 1]?.id ?? null
    },
    [rows]
  )

  const reopen = useCallback((task: Task) => void window.ambient.reopenTask(task.id).then(onTasks), [onTasks])

  const actions: RowActions = {
    select: setSelectedId,
    toggleOpen: (id) => {
      setSnoozingId(null)
      setOpenId((current) => (current === id ? null : id))
    },
    complete: (task) => {
      setSelectedId(neighbour(task.id))
      void window.ambient.completeTask(task.id).then(onTasks)
      toast.show({ message: `Completed “${task.title}”`, action: { label: 'Undo', run: () => reopen(task) } })
    },
    reopen: (task) => reopen(task),
    remove: (task) => {
      setSelectedId(neighbour(task.id))
      setOpenId(null)
      void window.ambient.deleteTask(task.id).then(onTasks)
      const dismissed = task.status === 'suggested'
      toast.show({
        message: dismissed ? `Dismissed “${task.title}”` : `Deleted “${task.title}”`,
        // A dismissed suggestion comes back as a real task; there is no way back to "suggested".
        action: { label: dismissed ? 'Add instead' : 'Undo', run: () => reopen(task) }
      })
    },
    snooze: (task, until) => {
      setSnoozingId(null)
      setOpenId(null)
      setSelectedId(neighbour(task.id))
      void window.ambient.snoozeTask(task.id, until).then(onTasks)
      toast.show({ message: `Snoozed until ${shortTime(until)}`, action: { label: 'Undo', run: () => reopen(task) } })
    },
    toggleSnooze: (id) => setSnoozingId((current) => (current === id ? null : id)),
    edit: (task, patch) => void window.ambient.updateTask(task.id, patch).then(onTasks),
    startEdit: (id) => {
      setSelectedId(id)
      setEditingId(id)
    },
    stopEdit: () => {
      setEditingId(null)
      rootRef.current?.focus()
    },
    accept: (task) => void window.ambient.acceptTask(task.id).then(onTasks)
  }

  const acceptAll = () => {
    const ids = sections.suggested.map((task) => task.id)
    void Promise.all(ids.map((id) => window.ambient.acceptTask(id))).then((lists) => {
      const last = lists.at(-1)
      if (last) onTasks(last)
    })
    toast.show({ message: `Added ${ids.length} suggestions` })
  }

  const closeSearch = () => {
    setQuery('')
    setSearching(false)
    rootRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const meta = event.metaKey || event.ctrlKey
    if (meta && event.key.toLowerCase() === 'z') {
      if (toast.runAction()) event.preventDefault()
      return
    }
    if (meta && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      setSearching(true)
      requestAnimationFrame(() => searchRef.current?.focus())
      return
    }
    if (isTyping(event.target)) return

    const selected = rows.find((task) => task.id === selectedId) ?? null
    const index = selected ? rows.indexOf(selected) : -1
    const move = (delta: number) => {
      const next = rows[Math.min(rows.length - 1, Math.max(0, index + delta))]
      if (next) setSelectedId(next.id)
    }

    switch (event.key) {
      case 'ArrowDown':
      case 'j':
        move(1)
        break
      case 'ArrowUp':
      case 'k':
        move(-1)
        break
      case 'Enter':
        if (selected) actions.toggleOpen(selected.id)
        break
      case ' ':
      case 'x':
        if (!selected) return
        if (selected.status === 'suggested') actions.accept(selected)
        else if (view === 'open') actions.complete(selected)
        else actions.reopen(selected)
        break
      case 'e':
        if (selected) actions.startEdit(selected.id)
        break
      case 's':
        if (selected && view === 'open' && selected.status !== 'suggested') actions.toggleSnooze(selected.id)
        break
      case 'Delete':
      case 'Backspace':
        if (selected) actions.remove(selected)
        break
      case '/':
        setSearching(true)
        requestAnimationFrame(() => searchRef.current?.focus())
        break
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (!hasOtherViews) return
        const order: RowView[] = ['open', 'done', 'snoozed']
        setView(order[(order.indexOf(view) + (event.key === 'ArrowRight' ? 1 : 2)) % 3] ?? 'open')
        break
      }
      case 'Escape':
        if (snoozingId) setSnoozingId(null)
        else if (openId) setOpenId(null)
        else if (query || searching) closeSearch()
        else onCollapse()
        break
      default:
        return
    }
    event.preventDefault()
  }

  const shortcut = (action: ShortcutStatus['action']) => props.shortcuts.find((s) => s.action === action)?.label
  const withKey = (label: string, action: ShortcutStatus['action']) => {
    const key = shortcut(action)
    return key ? `${label} (${key})` : label
  }

  let status: string
  if (activity !== 'idle') status = ACTIVITY_LINE[activity]
  else if (sections.now.length > 0) status = `${sections.now.length} due today`
  else if (openCount > 0) status = 'Nothing due today'
  else if (attention) status = 'Needs your attention'
  else status = allClearLine(props.lastRun, props.syncIntervalMinutes, now)

  const rowProps = (task: Task) => ({
    task,
    now,
    view,
    selected: task.id === selectedId,
    open: task.id === openId,
    editing: task.id === editingId,
    snoozing: task.id === snoozingId,
    actions
  })

  const nothingOpen =
    view === 'open' && rows.length === 0 && recurrence.length === 0 && !attention && !clash

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      role="listbox"
      aria-label="Tasks"
      aria-activedescendant={selectedId ? `row-${selectedId}` : undefined}
      className="glass group/panel flex max-h-[calc(100vh-2px)] origin-top animate-pop flex-col overflow-hidden outline-none"
    >
      <div className="flex h-12 shrink-0 items-center gap-1.5 pr-2 pl-1.5">
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse (Esc)"
          title="Collapse (Esc)"
          className="focus-ring grid size-10 shrink-0 place-items-center rounded-full"
        >
          <Orb look={look} size={40} bare />
        </button>
        <StatusLine text={status} live={activity !== 'idle'} className="flex-1" />
        <IconButton label="Search (/)" active={searching} onClick={() => (searching ? closeSearch() : setSearching(true))}>
          <Search />
        </IconButton>
        <IconButton label={withKey('Capture', 'quickAdd')} onClick={() => window.ambient.quickAdd.open()}>
          <Plus />
        </IconButton>
        <IconButton label={withKey('Ask', 'chat')} onClick={() => window.ambient.openChat()}>
          <MessageCircle />
        </IconButton>
        <IconButton label={withKey('Settings', 'settings')} onClick={() => window.ambient.openSettings()}>
          <Settings />
        </IconButton>
      </div>

      {searching && (
        <div className="mx-2 mb-1 flex h-8 shrink-0 animate-fade items-center gap-2 rounded-inner bg-fill px-2.5 hairline">
          <Search aria-hidden className="size-3.5 text-ink-3" />
          <input
            ref={searchRef}
            autoFocus
            value={query}
            placeholder="Search tasks"
            aria-label="Search tasks"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                closeSearch()
              }
              if (event.key === 'ArrowDown' || event.key === 'Enter') {
                event.preventDefault()
                rootRef.current?.focus()
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-body text-ink-1 outline-none placeholder:text-ink-4"
          />
          {query && (
            <IconButton size="sm" label="Clear search" onClick={() => setQuery('')}>
              <X />
            </IconButton>
          )}
        </div>
      )}

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-1.5 [scrollbar-width:none]">
        <div className="flex flex-col gap-1">
          {view === 'open' && attention && health && (
            <div className="mx-1 flex items-start gap-2.5 rounded-inner bg-fill px-2.5 py-2 hairline">
              <span className="mt-[5px] size-2 shrink-0 rounded-full bg-warning" />
              <p className="min-w-0 flex-1 text-small text-ink-2">
                {health.problems[0]}
                {health.problems.length > 1 && <span className="text-ink-3"> · {health.problems.length - 1} more in Settings</span>}
              </p>
              {!health.google.connected && health.google.credentialsConfigured ? (
                <Button size="sm" variant="primary" onClick={props.onConnectGoogle}>
                  Connect
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={props.onRecheckHealth}>
                  Check again
                </Button>
              )}
            </div>
          )}

          {view === 'open' && clash && (
            <p className="mx-1 flex items-start gap-2 px-2.5 py-1 text-small text-ink-2">
              <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-warning" />
              {clash.explanation}
            </p>
          )}

          {view === 'open' && (
            <>
              {sections.now.length > 0 && (
                <Section title="Now">
                  {sections.now.map((task) => (
                    <TaskRow key={task.id} {...rowProps(task)} />
                  ))}
                </Section>
              )}
              {(sections.suggested.length > 0 || recurrence.length > 0) && (
                <Section
                  title="Suggested"
                  aside={
                    sections.suggested.length > 1 && (
                      <Button size="sm" variant="ghost" onClick={acceptAll}>
                        Add all
                      </Button>
                    )
                  }
                >
                  {sections.suggested.map((task) => (
                    <TaskRow key={task.id} {...rowProps(task)} />
                  ))}
                  {recurrence.slice(0, 1).map((suggestion) => (
                    <li key={suggestion.id} className="flex items-start gap-2.5 rounded-inner px-2.5 py-2">
                      <span className="mt-[5px] size-2 shrink-0 rounded-full bg-accent" />
                      <div className="min-w-0 flex-1">
                        <p className="text-body text-ink-1">Make “{suggestion.title}” recurring?</p>
                        <p className="mt-0.5 text-small text-ink-3">
                          Seen {suggestion.occurrences} times · {describeRule(suggestion)}
                        </p>
                      </div>
                      <div className="-my-0.5 flex shrink-0">
                        <IconButton
                          label="Make it recurring"
                          tone="accent"
                          onClick={() =>
                            void window.ambient.rules.acceptSuggestion(suggestion.id).then((result) => {
                              onRecurrence(result.suggestions)
                              void window.ambient.getTasks().then(onTasks)
                            })
                          }
                        >
                          <CheckIcon />
                        </IconButton>
                        <IconButton
                          label="Not a pattern"
                          onClick={() => void window.ambient.rules.dismissSuggestion(suggestion.id).then(onRecurrence)}
                        >
                          <X />
                        </IconButton>
                      </div>
                    </li>
                  ))}
                </Section>
              )}
              {sections.upcoming.length > 0 && (
                <Section title="Upcoming">
                  {sections.upcoming.map((task) => (
                    <TaskRow key={task.id} {...rowProps(task)} />
                  ))}
                </Section>
              )}
              {later.length > 0 && (
                <Section title={sections.now.length + sections.upcoming.length > 0 ? 'Later' : 'Open'}>
                  {later.map((task) => (
                    <TaskRow key={task.id} {...rowProps(task)} />
                  ))}
                  {hiddenLater > 0 && (
                    <li>
                      <button
                        type="button"
                        onClick={() => setShowAllLater(true)}
                        className="focus-ring ml-9 h-7 rounded-control px-1 text-small text-ink-3 hover:text-ink-1"
                      >
                        Show {hiddenLater} more
                      </button>
                    </li>
                  )}
                </Section>
              )}
            </>
          )}

          {view !== 'open' && rows.length > 0 && (
            <Section title={VIEW_LABEL[view]}>
              {rows.map((task) => (
                <TaskRow key={task.id} {...rowProps(task)} />
              ))}
            </Section>
          )}

          {nothingOpen && (
            <div className="flex flex-col items-start gap-1 px-2.5 py-3">
              <p className="text-body text-ink-2">{query ? `Nothing matches “${query}”.` : status}</p>
              {!query && shortcut('quickAdd') && (
                <p className="flex items-center gap-1.5 text-small text-ink-3">
                  Press <Kbd>{shortcut('quickAdd') ?? ''}</Kbd> to capture anything.
                </p>
              )}
            </div>
          )}
          {view !== 'open' && rows.length === 0 && (
            <p className="px-2.5 py-3 text-body text-ink-3">
              {view === 'done' ? 'Nothing finished yet today.' : 'Nothing snoozed.'}
            </p>
          )}
        </div>
      </div>

      <div className="shrink-0 empty:hidden">
        <ToastRegion className="px-2 pb-2" />
        {hasOtherViews && (
          <nav aria-label="Views" className="flex h-9 items-center gap-1 border-t-[0.5px] border-hairline px-2">
            {(['open', 'done', 'snoozed'] as RowView[]).map((option) => {
              const count =
                option === 'open' ? openCount + sections.suggested.length : option === 'done' ? sections.doneToday.length : sections.snoozed.length
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={view === option}
                  onClick={() => {
                    setView(option)
                    rootRef.current?.focus()
                  }}
                  className={cn(
                    'focus-ring tabular flex h-6 items-center gap-1.5 rounded-control px-2 text-small transition-colors',
                    view === option ? 'bg-fill-2 text-ink-1' : 'text-ink-3 hover:text-ink-1'
                  )}
                >
                  {VIEW_LABEL[option]}
                  <span className="text-ink-4">{count}</span>
                </button>
              )
            })}
          </nav>
        )}
      </div>
    </div>
  )
}
