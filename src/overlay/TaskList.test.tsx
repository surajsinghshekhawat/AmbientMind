import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { inHours, makeTask } from '../dev/fixtures'
import { TaskList } from './TaskList'

const NOW = Date.UTC(2026, 5, 1, 12)
const noop = () => {}

function renderList(tasks: ReturnType<typeof makeTask>[], maxVisible = 7) {
  return render(
    <TaskList
      tasks={tasks}
      now={NOW}
      maxVisible={maxVisible}
      onComplete={noop}
      onEdit={noop}
      onSnooze={noop}
      onDelete={noop}
    />
  )
}

describe('TaskList', () => {
  it('says so when nothing is pending', () => {
    renderList([makeTask({ status: 'done' })])
    expect(screen.getByText('Nothing pending. Enjoy it.')).toBeTruthy()
  })

  it('never hides the task you just added behind the visible limit', () => {
    const urgent = [1, 2, 3].map((h) => makeTask({ title: `Due in ${h}h`, deadline: inHours(h, NOW) }))
    const justAdded = makeTask({ title: 'Just added, no deadline' })
    renderList([...urgent, justAdded], 2)

    expect(screen.getByText('Due in 1h')).toBeTruthy()
    expect(screen.getByText('Just added, no deadline')).toBeTruthy()
    expect(screen.queryByText('Due in 2h')).toBeNull()
  })
})
