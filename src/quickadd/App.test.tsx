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
})
