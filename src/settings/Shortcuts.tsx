import { useEffect, useState } from 'react'
import {
  acceleratorFromKey,
  defaultShortcuts,
  sameShortcut,
  type Os,
  type ShortcutAction,
  type ShortcutSet,
  type ShortcutStatus
} from '@shared/shortcuts'
import { cn } from '@/ui/cn'
import { Kbd } from '@/ui/Kbd'
import { Group, Page, Row } from './controls'

export const clientOs: Os = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent) ? 'mac' : 'win'

interface Props {
  shortcuts: ShortcutStatus[]
  overrides: Partial<ShortcutSet>
  onSave: (overrides: Partial<ShortcutSet>) => Promise<void>
}

function Recorder({
  status,
  onRecord,
  onReset
}: {
  status: ShortcutStatus
  onRecord: (accelerator: string) => void
  onReset: () => void
}) {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!recording) return
    window.ambient.suspendShortcuts(true)
    return () => window.ambient.suspendShortcuts(false)
  }, [recording])

  const stop = () => {
    setRecording(false)
    setError(null)
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        aria-label={recording ? `Recording a shortcut for ${status.name}` : `Change shortcut for ${status.name}, now ${status.label}`}
        onClick={() => setRecording((on) => !on)}
        onBlur={stop}
        onKeyDown={(event) => {
          if (!recording) return
          event.preventDefault()
          event.stopPropagation()
          const bare = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
          if (event.key === 'Escape' && bare) return stop()
          if ((event.key === 'Backspace' || event.key === 'Delete') && bare) {
            stop()
            return onReset()
          }
          const result = acceleratorFromKey(event.nativeEvent, clientOs)
          if (!result) return
          if ('error' in result) return setError(result.error)
          stop()
          onRecord(result.accelerator)
        }}
        className={cn(
          'focus-ring flex h-7 min-w-[92px] items-center justify-center rounded-control px-2 transition-[background-color,box-shadow] duration-150',
          recording ? 'bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] shadow-[inset_0_0_0_1px_var(--accent)]' : 'hover:bg-fill-2'
        )}
      >
        {recording ? <span className="text-small text-accent">Type keys…</span> : <Kbd className="h-[22px] px-2 text-small">{status.label}</Kbd>}
      </button>
      {recording && (
        <span className={cn('text-micro', error ? 'text-warning' : 'text-ink-3')}>{error ?? 'Esc cancels · Delete resets'}</span>
      )}
    </span>
  )
}

export function Shortcuts({ shortcuts, overrides, onSave }: Props) {
  const defaults = defaultShortcuts(clientOs)

  const save = (action: ShortcutAction, accelerator: string | null) => {
    const next = { ...overrides }
    if (!accelerator || sameShortcut(accelerator, defaults[action], clientOs)) delete next[action]
    else next[action] = accelerator
    void onSave(next)
  }

  return (
    <Page title="Shortcuts" description="Work from any app. Click a shortcut, then press the new keys.">
      <Group
        footer={
          clientOs === 'mac'
            ? 'The defaults use ⌃⌥ because apps rarely do; ⌘⇧ shortcuts usually belong to the app in front.'
            : 'The defaults use Ctrl+Shift.'
        }
      >
        {shortcuts.map((status) => (
          <Row
            key={status.action}
            label={status.name}
            description={
              status.problem ? (
                <span className="text-warning">{status.problem}</span>
              ) : overrides[status.action] ? (
                <button type="button" onClick={() => save(status.action, null)} className="focus-ring rounded text-accent hover:underline">
                  Use the default
                </button>
              ) : undefined
            }
          >
            <Recorder status={status} onRecord={(accelerator) => save(status.action, accelerator)} onReset={() => save(status.action, null)} />
          </Row>
        ))}
      </Group>
    </Page>
  )
}
