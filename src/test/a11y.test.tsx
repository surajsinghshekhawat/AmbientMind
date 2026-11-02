import { act, fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { App as Chat } from '../chat/App'
import { inHours, makeTask } from '../dev/fixtures'
import { installMockAmbient } from '../dev/mockAmbient'
import { App as Onboarding, STEPS } from '../onboarding/App'
import { App as Overlay } from '../overlay/App'
import { Panel } from '../overlay/Panel'
import { App as QuickAdd } from '../quickadd/App'
import { App as Settings, type SectionId } from '../settings/App'
import { ToastProvider, ToastRegion, useToast } from '@/ui/Toast'

const SECTIONS: SectionId[] = ['general', 'sources', 'ai', 'capture', 'shortcuts', 'recurring', 'learned', 'privacy', 'data', 'permissions', 'about']

async function violations(container: HTMLElement): Promise<string[]> {
  await act(async () => {})
  const result = await axe.run(container, {
    // Contrast needs real layout and is checked against the tokens in eval/contrast.test.ts.
    rules: { 'color-contrast': { enabled: false }, 'label-content-name-mismatch': { enabled: true } }
  })
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)
}

describe('axe finds nothing in', () => {
  it.each(SECTIONS)('settings: %s', async (section) => {
    const { container } = render(<Settings initialSection={section} applyTheme={false} />)
    expect(await violations(container)).toEqual([])
  })

  it.each(STEPS)('onboarding: %s', async (step) => {
    const { container } = render(<Onboarding initialStep={step} applyTheme={false} />)
    expect(await violations(container)).toEqual([])
  })

  it('the task panel', async () => {
    const now = Date.now()
    const tasks = [
      makeTask({ title: 'Pay the electricity bill', deadline: inHours(-1, now) }),
      makeTask({ title: 'Reply to Priya', deadline: inHours(3, now), source: 'gmail' }),
      makeTask({ title: 'Book a dentist appointment' })
    ]
    installMockAmbient({ tasks })
    const { container } = render(
      <ToastProvider>
        <Panel
          tasks={tasks}
          now={now}
          activity="idle"
          health={null}
          recurrence={[]}
          lastRun={null}
          syncIntervalMinutes={15}
          maxVisible={7}
          shortcuts={[]}
          onTasks={() => {}}
          onRecurrence={() => {}}
          onCollapse={() => {}}
          onRecheckHealth={() => {}}
          onConnectGoogle={() => {}}
        />
      </ToastProvider>
    )
    expect(await violations(container)).toEqual([])
  })

  it('the orb, with tasks due', async () => {
    const now = Date.now()
    // An hour from now is tomorrow after 23:00; the end of today never is.
    const tonight = new Date(new Date(now).setHours(23, 59, 0, 0)).toISOString()
    installMockAmbient({ tasks: [makeTask({ title: 'Pay rent', deadline: inHours(-1, now) }), makeTask({ title: 'Call Sam', deadline: tonight })] })
    const { container } = render(<Overlay />)
    await act(async () => {})
    expect(screen.getByRole('button', { name: /^AmbientMind, 2 due today: / })).toBeTruthy()
    expect(await violations(container)).toEqual([])
  })

  it('quick capture', async () => {
    const { container } = render(<QuickAdd />)
    expect(await violations(container)).toEqual([])
  })

  it('chat', async () => {
    const { container } = render(<Chat />)
    expect(await violations(container)).toEqual([])
  })
})

describe('keyboard and screen reader behaviour', () => {
  it('moves focus to the new heading when onboarding goes to the next step', async () => {
    render(<Onboarding applyTheme={false} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
    await act(async () => {})
    expect(document.activeElement?.tagName).toBe('H1')
  })

  it('keeps a toast up while the pointer is on it', async () => {
    vi.useFakeTimers()
    function Show() {
      const toast = useToast()
      useEffect(() => toast.show({ message: 'Task deleted', action: { label: 'Undo', run: () => {} } }), [toast])
      return <ToastRegion />
    }
    try {
      render(
        <ToastProvider>
          <Show />
        </ToastProvider>
      )
      const region = screen.getByText('Task deleted').closest('[aria-live]')!
      fireEvent.pointerEnter(region)
      act(() => vi.advanceTimersByTime(8000))
      expect(screen.queryByText('Task deleted')).toBeTruthy()
      fireEvent.pointerLeave(region)
      act(() => vi.advanceTimersByTime(5000))
      expect(screen.queryByText('Task deleted')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
