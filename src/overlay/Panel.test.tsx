import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Task } from '@shared/types'
import { inHours, makeTask } from '../dev/fixtures'
import { installMockAmbient } from '../dev/mockAmbient'
import { ToastProvider } from '@/ui/Toast'
import { App } from './App'
import { Panel, type PanelProps } from './Panel'

const NOW = new Date(2026, 10, 2, 12, 0, 0).getTime()

function Harness({ initial, ...overrides }: { initial: Task[] } & Partial<PanelProps>) {
  const [tasks, setTasks] = useState(initial)
  return (
    <ToastProvider>
      <Panel
        tasks={tasks}
        now={NOW}
        activity="idle"
        health={null}
        recurrence={[]}
        lastRun={null}
        syncIntervalMinutes={15}
        maxVisible={7}
        shortcuts={[]}
        onTasks={setTasks}
        onRecurrence={() => {}}
        onCollapse={() => {}}
        onRecheckHealth={() => {}}
        onConnectGoogle={() => {}}
        {...overrides}
      />
    </ToastProvider>
  )
}

function setup(tasks: Task[], overrides: Partial<PanelProps> = {}) {
  const mock = installMockAmbient({ tasks })
  render(<Harness initial={tasks} {...overrides} />)
  const panel = screen.getByRole('region', { name: 'Tasks' })
  return { mock, panel }
}

const flush = () => act(async () => {})

describe('Panel', () => {
  it('groups tasks into Now and Later and says how many are due', () => {
    setup([
      makeTask({ title: 'Overdue thing', deadline: inHours(-2, NOW) }),
      makeTask({ title: 'Someday thing' })
    ])
    expect(screen.getByRole('heading', { name: 'Now' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Later' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('1 due today')
  })

  it('completes the selected task from the keyboard and undoes with ⌘Z', async () => {
    const first = makeTask({ title: 'First', deadline: inHours(1, NOW) })
    const second = makeTask({ title: 'Second', deadline: inHours(30, NOW) })
    const { mock, panel } = setup([first, second])

    fireEvent.keyDown(panel, { key: ' ' })
    await flush()
    expect(mock.state.tasks.find((t) => t.id === first.id)?.status).toBe('done')
    expect(screen.getByText('Completed “First”')).toBeTruthy()
    // Selection moves on, so a second Space acts on the next task.
    expect(document.getElementById(`row-${second.id}`)?.getAttribute('aria-current')).toBe('true')

    fireEvent.keyDown(panel, { key: 'z', metaKey: true })
    await flush()
    expect(mock.state.tasks.find((t) => t.id === first.id)?.status).toBe('pending')
  })

  it('moves with j and k, and deletes with undo', async () => {
    const a = makeTask({ title: 'A', deadline: inHours(1, NOW) })
    const b = makeTask({ title: 'B', deadline: inHours(2, NOW) })
    const { mock, panel } = setup([a, b])

    fireEvent.keyDown(panel, { key: 'j' })
    expect(document.getElementById(`row-${b.id}`)?.getAttribute('aria-current')).toBe('true')
    fireEvent.keyDown(panel, { key: 'k' })
    expect(document.getElementById(`row-${a.id}`)?.getAttribute('aria-current')).toBe('true')

    fireEvent.keyDown(panel, { key: 'Delete' })
    await flush()
    expect(mock.state.tasks.find((t) => t.id === a.id)?.status).toBe('deleted')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await flush()
    expect(mock.state.tasks.find((t) => t.id === a.id)?.status).toBe('pending')
  })

  it('opens details with Enter, showing the quote and a link to the source', () => {
    const task = makeTask({
      title: 'Reply to Priya',
      source: 'gmail',
      deadline: inHours(2, NOW),
      sourceUrl: 'https://mail.google.com/mail/u/0/#all/1',
      evidence: 'Can you reply by noon?'
    })
    const { panel } = setup([task])
    fireEvent.keyDown(panel, { key: 'Enter' })
    expect(screen.getByText('Can you reply by noon?')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Open in Gmail/ }).getAttribute('href')).toBe(task.sourceUrl)
  })

  it('snoozes from the keyboard with s, then a choice', async () => {
    const task = makeTask({ title: 'Snooze me', deadline: inHours(2, NOW) })
    const { mock, panel } = setup([task])
    fireEvent.keyDown(panel, { key: 's' })
    const group = screen.getByRole('group', { name: 'Snooze until' })
    fireEvent.click(within(group).getByRole('button', { name: '1 hour' }))
    await flush()
    expect(mock.state.tasks[0]?.status).toBe('snoozed')
    expect(screen.getByText(/Snoozed until/)).toBeTruthy()
  })

  it('accepts a suggestion with Space', async () => {
    const task = makeTask({ title: 'Send the W-9', status: 'suggested', confidence: 0.9 })
    const { mock, panel } = setup([task])
    expect(screen.getByText(/High confidence/)).toBeTruthy()
    fireEvent.keyDown(panel, { key: ' ' })
    await flush()
    expect(mock.state.tasks[0]?.status).toBe('pending')
  })

  it('Esc closes details first, then collapses', () => {
    const onCollapse = vi.fn()
    const { panel } = setup([makeTask({ title: 'T', deadline: inHours(1, NOW) })], { onCollapse })
    fireEvent.keyDown(panel, { key: 'Enter' })
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(onCollapse).not.toHaveBeenCalled()
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(onCollapse).toHaveBeenCalledOnce()
  })

  it('filters with search and says when nothing matches', () => {
    const { panel } = setup([makeTask({ title: 'Invoice Acme' }), makeTask({ title: 'Call mum' })])
    fireEvent.keyDown(panel, { key: '/' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tasks' }), { target: { value: 'acme' } })
    expect(screen.queryByText('Call mum')).toBeNull()
    expect(screen.getByText('Invoice Acme')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tasks' }), { target: { value: 'zzz' } })
    expect(screen.getByText('Nothing matches “zzz”.')).toBeTruthy()
  })

  it('says all clear when nothing is open', () => {
    setup([])
    expect(screen.getByRole('status').textContent).toBe('All clear.')
  })
})

describe('Overlay app', () => {
  it('shows the orb with a peek of the next task, and expands on click', async () => {
    const mock = installMockAmbient({ tasks: [makeTask({ title: 'Reply to Priya', deadline: inHours(2, Date.now()) })] })
    render(<App />)
    await flush()
    const orb = screen.getByRole('button', { name: /AmbientMind: Reply to Priya · in 2h/ })
    fireEvent.click(orb)
    await flush()
    expect(mock.calls.some((c) => c.method === 'setOverlayExpanded' && c.args[0] === true)).toBe(true)
    expect(screen.getByRole('region', { name: 'Tasks' })).toBeTruthy()
  })
})
