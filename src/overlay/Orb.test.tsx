import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { inHours, makeTask } from '../dev/fixtures'
import { Orb } from './Orb'

const NOW = Date.UTC(2026, 5, 1, 12)

describe('Orb', () => {
  it('counts only pending tasks', () => {
    const tasks = [
      makeTask({ title: 'a' }),
      makeTask({ title: 'b', deadline: inHours(-1, NOW) }),
      makeTask({ title: 'c', status: 'done' }),
      makeTask({ title: 'd', status: 'snoozed' })
    ]
    render(<Orb tasks={tasks} now={NOW} expanded={false} onToggle={() => {}} />)

    expect(screen.getByRole('button', { name: 'Show 2 tasks' }).textContent).toBe('2')
  })

  it('pulses only when something is overdue', () => {
    const { rerender } = render(
      <Orb tasks={[makeTask({ deadline: inHours(5, NOW) })]} now={NOW} expanded={false} onToggle={() => {}} />
    )
    expect(screen.getByRole('button').className).not.toContain('animate-overdue-pulse')

    rerender(
      <Orb tasks={[makeTask({ deadline: inHours(-5, NOW) })]} now={NOW} expanded={false} onToggle={() => {}} />
    )
    expect(screen.getByRole('button').className).toContain('animate-overdue-pulse')
  })

  it('toggles on click', () => {
    const onToggle = vi.fn()
    render(<Orb tasks={[]} now={NOW} expanded onToggle={onToggle} />)

    fireEvent.click(screen.getByRole('button', { name: 'Minimize AmbientMind' }))
    expect(onToggle).toHaveBeenCalledOnce()
  })
})
