import { useEffect, useRef, useState } from 'react'
import { AlarmClock, ArrowUpRight, Check as CheckIcon, Pencil, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import { confidenceLabel, openSourceLabel, SOURCE_LABEL } from '@shared/panel'
import { SNOOZE_CHOICES } from '@shared/snooze'
import type { Task, TaskPriority, Urgency } from '@shared/types'
import { formatDeadline, urgencyOf } from '@shared/urgency'
import { Button } from '@/ui/Button'
import { Check } from '@/ui/Check'
import { cn } from '@/ui/cn'
import { IconButton } from '@/ui/IconButton'

export type RowView = 'open' | 'done' | 'snoozed'

const DUE_TONE: Record<Urgency, string> = {
  neutral: 'text-ink-3',
  approaching: 'text-soon',
  urgent: 'text-warning',
  overdue: 'text-danger'
}

const CHECK_TONE = {
  neutral: 'neutral',
  approaching: 'soon',
  urgent: 'warning',
  overdue: 'danger'
} as const

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']

function when(iso: string | null, now: number): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const sameDay = new Date(now).toDateString() === date.toDateString()
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return time
  return `${date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`
}

/** `datetime-local` wants local wall-clock without a zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export interface RowActions {
  select: (id: string) => void
  toggleOpen: (id: string) => void
  complete: (task: Task) => void
  reopen: (task: Task) => void
  remove: (task: Task) => void
  snooze: (task: Task, until: string) => void
  toggleSnooze: (id: string) => void
  edit: (task: Task, patch: Partial<Pick<Task, 'title' | 'deadline' | 'priority'>>) => void
  startEdit: (id: string) => void
  stopEdit: () => void
  accept: (task: Task) => void
}

interface Props {
  task: Task
  now: number
  view: RowView
  selected: boolean
  open: boolean
  editing: boolean
  snoozing: boolean
  actions: RowActions
}

export function TaskRow({ task, now, view, selected, open, editing, snoozing, actions }: Props) {
  const urgency = urgencyOf(task, now)
  const suggested = task.status === 'suggested'
  const done = task.status === 'done'
  const [draft, setDraft] = useState(task.title)
  const inputRef = useRef<HTMLInputElement>(null)
  const rowRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(task.title)
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [editing, task.title])

  useEffect(() => {
    const row = rowRef.current
    // Only when driven from the keyboard; otherwise the host page would scroll.
    if (selected && row?.closest('[role=listbox]')?.contains(document.activeElement)) {
      row.scrollIntoView({ block: 'nearest' })
    }
  }, [selected, open])

  const commit = () => {
    const title = draft.trim()
    actions.stopEdit()
    if (title && title !== task.title) actions.edit(task, { title })
    if (suggested && title) actions.accept(task)
  }

  const meta: { text: string; className?: string }[] = []
  if (view === 'done') meta.push({ text: `Done ${when(task.completedAt, now)}` })
  else if (view === 'snoozed') meta.push({ text: `Back ${when(task.snoozedUntil, now)}` })
  else if (task.deadline) meta.push({ text: formatDeadline(task.deadline, now), className: DUE_TONE[urgency] })
  if (suggested) meta.push({ text: `${confidenceLabel(task.confidence)} confidence` })
  meta.push({ text: SOURCE_LABEL[task.source] })
  if (task.people[0]) meta.push({ text: task.people[0] })

  const openLabel = openSourceLabel(task.source)
  const quote = task.evidence ?? task.rawContext

  return (
    <li
      ref={rowRef}
      id={`row-${task.id}`}
      role="option"
      aria-selected={selected}
      aria-expanded={open}
      onMouseDown={() => actions.select(task.id)}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button, input, select, a')) return
        actions.toggleOpen(task.id)
      }}
      className={cn(
        'group rounded-inner px-2.5 py-2 transition-colors duration-150',
        // The selection is for keyboard use; it shows only while the panel has focus.
        selected ? 'hover:bg-fill group-focus-within/panel:bg-fill-2' : 'hover:bg-fill'
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-px">
          {suggested ? (
            <span className="grid size-[18px] place-items-center text-accent">
              <Sparkles aria-hidden className="size-3.5 stroke-2" />
            </span>
          ) : (
            <Check
              checked={done}
              tone={view === 'open' ? CHECK_TONE[urgency] : 'neutral'}
              label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
              onChange={() => (done ? actions.reopen(task) : actions.complete(task))}
            />
          )}
        </span>

        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              aria-label="Task title"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Enter') commit()
                if (event.key === 'Escape') actions.stopEdit()
              }}
              className="-my-px w-full rounded-[6px] bg-fill-2 px-1.5 py-px text-body text-ink-1 outline-none hairline"
            />
          ) : (
            <p
              onDoubleClick={() => actions.startEdit(task.id)}
              className={cn(
                'text-body text-ink-1 [overflow-wrap:anywhere]',
                open ? 'whitespace-pre-wrap' : 'line-clamp-2',
                done && 'text-ink-3 line-through decoration-ink-4'
              )}
            >
              {task.title}
            </p>
          )}
          <p className="tabular mt-0.5 truncate text-small text-ink-3">
            {meta.map((part, index) => (
              <span key={index} className={part.className}>
                {index > 0 && <span className="text-ink-4"> · </span>}
                {part.text}
              </span>
            ))}
          </p>
        </div>

        {suggested && (
          <div className="-my-0.5 flex shrink-0 items-center">
            <IconButton label="Add to tasks (Space)" tone="accent" onClick={() => actions.accept(task)}>
              <CheckIcon />
            </IconButton>
            <IconButton label="Dismiss (Delete)" onClick={() => actions.remove(task)}>
              <X />
            </IconButton>
          </div>
        )}
      </div>

      {snoozing && !editing && (
        <div className="mt-2 ml-7 flex flex-wrap gap-1" role="group" aria-label="Snooze until">
          {SNOOZE_CHOICES.map((choice, index) => (
            <Button
              key={choice.id}
              size="sm"
              variant="secondary"
              autoFocus={index === 0}
              onClick={() => actions.snooze(task, choice.resolve(new Date(now)).toISOString())}
            >
              {choice.label}
            </Button>
          ))}
        </div>
      )}

      {open && !editing && (
        <div className="mt-2 ml-7 flex animate-fade flex-col gap-2.5">
          {quote && (
            <blockquote className="border-l-2 border-hairline-2 pl-2.5 text-small whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">
              {quote.length > 280 ? `${quote.slice(0, 280)}…` : quote}
            </blockquote>
          )}
          {task.people.length > 1 && <p className="text-small text-ink-3">With {task.people.join(', ')}</p>}

          {view === 'open' && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-small text-ink-3">
              <label className="flex items-center gap-1.5">
                Due
                <input
                  type="datetime-local"
                  value={toLocalInput(task.deadline)}
                  onChange={(event) => {
                    const value = event.target.value
                    actions.edit(task, { deadline: value ? new Date(value).toISOString() : null })
                  }}
                  className="focus-ring h-6 rounded-[6px] bg-fill px-1.5 text-small text-ink-1 [color-scheme:dark] hairline"
                />
              </label>
              <label className="flex items-center gap-1.5">
                Priority
                <select
                  value={task.priority}
                  onChange={(event) => actions.edit(task, { priority: event.target.value as TaskPriority })}
                  className="focus-ring h-6 rounded-[6px] bg-fill px-1 text-small text-ink-1 capitalize hairline"
                >
                  {PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="-ml-2 flex flex-wrap items-center gap-0.5">
            {openLabel && task.sourceUrl && (
              <a
                href={task.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="focus-ring inline-flex h-6 items-center gap-1 rounded-control px-2 text-small font-medium text-accent hover:bg-fill"
              >
                {openLabel}
                <ArrowUpRight aria-hidden className="size-3.5" />
              </a>
            )}
            {view === 'open' && !suggested && (
              <Button size="sm" variant="ghost" onClick={() => actions.toggleSnooze(task.id)}>
                <AlarmClock aria-hidden />
                Snooze
              </Button>
            )}
            {view !== 'open' && (
              <Button size="sm" variant="ghost" onClick={() => actions.reopen(task)}>
                <RotateCcw aria-hidden />
                {view === 'snoozed' ? 'Bring back now' : 'Reopen'}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => actions.startEdit(task.id)}>
              <Pencil aria-hidden />
              Edit
            </Button>
            <Button size="sm" variant="danger" onClick={() => actions.remove(task)}>
              <Trash2 aria-hidden />
              Delete
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}
