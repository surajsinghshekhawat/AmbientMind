import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installMockAmbient } from '../dev/mockAmbient'
import { App } from './App'

afterEach(() => {
  vi.useRealTimers()
})

describe('Quick Capture', () => {
  it('can be typed into straight away; the mic stays off', () => {
    const getUserMedia = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
    installMockAmbient()
    render(<App />)
    const input = screen.getByRole('textbox', { name: 'What needs doing?' })
    expect(document.activeElement).toBe(input)
    expect((input as HTMLInputElement).readOnly).toBe(false)
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('shows what it understood as chips while you type', () => {
    installMockAmbient()
    render(<App />)
    const input = screen.getByRole('textbox', { name: 'What needs doing?' })
    fireEvent.change(input, { target: { value: 'Call @Priya tomorrow at 5pm asap' } })
    expect(screen.getByText(/^Tomorrow, /)).toBeTruthy()
    expect(screen.getByText('Urgent')).toBeTruthy()
    expect(screen.getByText('Priya')).toBeTruthy()
  })

  it('shows recurrence only with an explicit cue', () => {
    installMockAmbient()
    render(<App />)
    const input = screen.getByRole('textbox', { name: 'What needs doing?' })
    fireEvent.change(input, { target: { value: 'gym monday at 7am' } })
    expect(screen.queryByText(/Mon at 07:00/)).toBeNull()
    fireEvent.change(input, { target: { value: 'gym every monday at 7am' } })
    expect(screen.getByText('Mon at 07:00')).toBeTruthy()
  })

  it('Enter shows the check, then saves; ⌘Enter saves and stays open', () => {
    vi.useFakeTimers()
    const mock = installMockAmbient()
    render(<App />)
    const input = screen.getByRole('textbox', { name: 'What needs doing?' })
    fireEvent.change(input, { target: { value: 'Buy milk' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('Added')).toBeTruthy()
    act(() => vi.advanceTimersByTime(500))
    expect(mock.calls).toContainEqual({ method: 'quickAdd.submit', args: ['Buy milk', { keepOpen: false }] })

    act(() => mock.emit.quickAddOpened())
    const again = screen.getByRole('textbox', { name: 'What needs doing?' })
    fireEvent.change(again, { target: { value: 'Second' } })
    fireEvent.keyDown(again, { key: 'Enter', metaKey: true })
    act(() => vi.advanceTimersByTime(500))
    expect(mock.calls).toContainEqual({ method: 'quickAdd.submit', args: ['Second', { keepOpen: true }] })
    expect((screen.getByRole('textbox', { name: 'What needs doing?' }) as HTMLInputElement).value).toBe('')
  })

  it('Esc cancels', () => {
    const mock = installMockAmbient()
    render(<App />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'What needs doing?' }), { key: 'Escape' })
    expect(mock.calls.some((c) => c.method === 'quickAdd.cancel')).toBe(true)
  })

  it('holding the shortcut shows live words and lands them on release', async () => {
    const mock = installMockAmbient({
      speech: { engine: 'apple', apple: { available: true, installed: true, downloading: false, locale: 'en-US' }, installing: null },
      liveTranscript: 'Call Priya about the venue by Friday'
    })
    render(<App />)
    await flush()
    act(() => mock.emit.quickAddHold('start'))
    await flush()
    expect(mock.calls.some((c) => c.method === 'speech.start')).toBe(true)
    expect(screen.getByText('Listening… let go to stop')).toBeTruthy()

    act(() => mock.emit.speechPartial({ text: 'Call Priya about', final: false }))
    const input = screen.getByRole('textbox', { name: 'What needs doing?' }) as HTMLInputElement
    expect(input.value).toBe('Call Priya about')
    expect(input.readOnly).toBe(true)

    // Held: a pause is not the end.
    for (let t = 0; t < 40; t++) act(() => mock.emit.speechLevel(0))
    expect(mock.calls.some((c) => c.method === 'speech.stop')).toBe(false)

    act(() => mock.emit.quickAddHold('end'))
    await flush()
    expect(mock.calls.some((c) => c.method === 'speech.stop')).toBe(true)
    expect(input.value).toBe('Call Priya about the venue by Friday')
    expect(input.readOnly).toBe(false)
  })

  it('Esc while listening live cancels the session', async () => {
    const mock = installMockAmbient({
      speech: { engine: 'apple', apple: { available: true, installed: true, downloading: false, locale: 'en-US' }, installing: null }
    })
    render(<App />)
    await flush()
    act(() => mock.emit.quickAddShortcut())
    await flush()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'What needs doing?' }), { key: 'Escape' })
    expect(mock.calls.some((c) => c.method === 'speech.cancel')).toBe(true)
  })
})

const flush = () => act(async () => {})
