import { useEffect, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'

/**
 * Holds what the user is typing and saves on blur (and Enter, for inputs).
 * Saving per keystroke round-tripped every character through the main
 * process, which trims on save, so the space after a word vanished and a
 * cleared field snapped back to its default mid-edit.
 */
function useDraft(value: string, onCommit: Commit) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)

  // Once editing ends this shows what was actually stored, which may differ
  // from the draft (trimmed, clamped, or a default for an empty field).
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const commit = () => {
    const saving = draft !== value ? onCommit(draft) : undefined
    // Leaving edit mode before the save lands would flash the old value.
    if (saving instanceof Promise) void saving.finally(() => setEditing(false))
    else setEditing(false)
  }

  return {
    value: draft,
    onChange: (event: { target: { value: string } }) => {
      setEditing(true)
      setDraft(event.target.value)
    },
    onBlur: commit,
    commit
  }
}

type Commit = (value: string) => void | Promise<unknown>

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string | number
  onCommit: Commit
}

export function DraftInput({ value, onCommit, onBlur, onKeyDown, ...rest }: InputProps) {
  const draft = useDraft(String(value), onCommit)
  return (
    <input
      {...rest}
      value={draft.value}
      onChange={draft.onChange}
      onBlur={(event) => {
        draft.onBlur()
        onBlur?.(event)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') draft.commit()
        onKeyDown?.(event)
      }}
    />
  )
}

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string
  onCommit: Commit
}

export function DraftTextarea({ value, onCommit, onBlur, ...rest }: TextareaProps) {
  const draft = useDraft(value, onCommit)
  return (
    <textarea
      {...rest}
      value={draft.value}
      onChange={draft.onChange}
      onBlur={(event) => {
        draft.onBlur()
        onBlur?.(event)
      }}
    />
  )
}
