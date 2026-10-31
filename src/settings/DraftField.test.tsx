import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DraftInput } from './DraftField'

/** Mirrors Settings: the saved value comes back trimmed from the main process. */
function Harness({ onCommit }: { onCommit: (value: string) => void }) {
  const [saved, setSaved] = useState('')
  return (
    <DraftInput
      aria-label="Name"
      value={saved}
      onCommit={(value) => {
        onCommit(value)
        setSaved(value.trim())
      }}
    />
  )
}

function typeInto(input: HTMLElement, text: string) {
  let value = ''
  for (const char of text) {
    value += char
    fireEvent.change(input, { target: { value } })
  }
}

describe('DraftInput', () => {
  it('keeps spaces while typing and saves once on blur', () => {
    const onCommit = vi.fn()
    render(<Harness onCommit={onCommit} />)
    const input = screen.getByLabelText('Name') as HTMLInputElement

    typeInto(input, 'Suraj Singh')
    expect(input.value).toBe('Suraj Singh')
    expect(onCommit).not.toHaveBeenCalled()

    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('Suraj Singh')
  })

  it('saves on Enter and does not save an unchanged value', () => {
    const onCommit = vi.fn()
    render(<Harness onCommit={onCommit} />)
    const input = screen.getByLabelText('Name')

    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()

    typeInto(input, 'qwen3:4b')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('qwen3:4b')
  })

  it('shows the saved value when it changes from elsewhere', () => {
    const { rerender } = render(<DraftInput aria-label="Name" value="a" onCommit={() => {}} />)
    rerender(<DraftInput aria-label="Name" value="b" onCommit={() => {}} />)
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('b')
  })
})
