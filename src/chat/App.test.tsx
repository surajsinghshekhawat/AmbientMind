import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatReply } from '@shared/types'
import { installMockAmbient } from '../dev/mockAmbient'
import { Markdown } from '@/ui/Markdown'
import { App } from './App'

const flush = () => act(async () => {})

describe('Chat', () => {
  it('sends with Enter and shows the reply with what changed', async () => {
    const mock = installMockAmbient()
    mock.api.chat = vi.fn(async () => ({
      reply: 'Moved it.',
      actions: ['Moved “Report” to tomorrow 09:00'],
      changed: true
    }))
    render(<App />)
    await flush()
    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(input, { target: { value: 'Move the report' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await flush()
    expect(screen.getByText('Move the report')).toBeTruthy()
    expect(screen.getByText('Moved it.')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'What changed' }).textContent).toContain('Report')
  })

  it('Stop while thinking shows Stopped and keeps it out of history', async () => {
    const mock = installMockAmbient()
    let finish: (value: { reply: string; actions: string[]; changed: boolean; stopped: boolean }) => void = () => {}
    mock.api.chat = vi.fn(() => new Promise<ChatReply>((resolve) => (finish = resolve)))
    render(<App />)
    await flush()
    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(input, { target: { value: 'Long question' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Stop (Esc)' }))
    expect(mock.calls.some((c) => c.method === 'stopChat')).toBe(true)
    finish({ reply: '', actions: [], changed: false, stopped: true })
    await flush()
    expect(screen.getByText('Stopped')).toBeTruthy()
  })

  it('a failure says what to do and offers to try again', async () => {
    const mock = installMockAmbient()
    mock.api.chat = vi.fn(async () => {
      throw new Error('fetch failed')
    })
    render(<App />)
    await flush()
    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(input, { target: { value: 'Hello' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await flush()
    expect(screen.getByText(/fetch failed\. If the model is not running/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('Esc closes when idle', async () => {
    const mock = installMockAmbient()
    render(<App />)
    await flush()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Escape' })
    expect(mock.calls.some((c) => c.method === 'closeChat')).toBe(true)
  })
})

describe('Markdown', () => {
  it('renders lists, bold and code as elements, never raw HTML', () => {
    const { container } = render(<Markdown source={'Hi **there**\n\n- one `x`\n- two\n\n<img src=x onerror=alert(1)>'} />)
    expect(container.querySelector('strong')?.textContent).toBe('there')
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.querySelector('code')?.textContent).toBe('x')
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })
})
