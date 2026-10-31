import type { ReactNode } from 'react'
import type { Task } from '@shared/types'
import {
  googleDisconnectedReport,
  inHours,
  makeTask,
  manyProblemsReport,
  ollamaDownReport,
  sampleSuggestion,
  sampleTasks
} from '../dev/fixtures'
import { HealthBanner } from '../overlay/HealthBanner'
import { Orb } from '../overlay/Orb'
import { SuggestionCard } from '../overlay/SuggestionCard'
import { TaskItem } from '../overlay/TaskItem'
import { TaskList } from '../overlay/TaskList'

const NOW = Date.now()
const noop = () => {}
const tasks = sampleTasks(NOW)

// Overlay components float over arbitrary wallpaper, so every state is shown
// on a dark and a light backdrop.
const BACKDROPS = [
  { name: 'Dark wallpaper', style: { background: 'linear-gradient(135deg, #1d2b3a, #3a2340)' } },
  { name: 'Light wallpaper', style: { background: 'linear-gradient(135deg, #f3efe6, #cfe3f5)' } }
]

function State({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] text-neutral-400">{name}</p>
      <div className="grid grid-cols-2 gap-3">
        {BACKDROPS.map((backdrop) => (
          <div
            key={backdrop.name}
            title={backdrop.name}
            className="flex min-h-24 items-center justify-center rounded-xl p-4"
            style={backdrop.style}
          >
            <div className="w-[360px]">{children}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[15px] font-semibold text-neutral-100">{title}</h2>
      {children}
    </section>
  )
}

function orbStates(): [string, Task[], boolean][] {
  return [
    ['No tasks', [], false],
    ['Nothing urgent', [makeTask({ deadline: inHours(24 * 5, NOW) })], false],
    ['Due within 3 days', [makeTask({ deadline: inHours(40, NOW) })], false],
    ['Due today', [makeTask({ deadline: inHours(3, NOW) })], false],
    ['Overdue', [makeTask({ deadline: inHours(-2, NOW) })], false],
    ['Expanded', tasks, true]
  ]
}

function taskItemStates(): [string, Task][] {
  return [
    ['Overdue, from Gmail, with a person', tasks[0]!],
    ['Due in under 2 hours', tasks[1]!],
    ['Due in 2 days', tasks[2]!],
    ['No deadline', tasks[4]!],
    ['Done', tasks[5]!],
    [
      'Very long title',
      makeTask({
        title:
          'Draft the response to legal about the indemnity clause in the renewed enterprise agreement before the call',
        deadline: inHours(20, NOW),
        source: 'gmail',
        people: ['Legal', 'Arjun']
      })
    ]
  ]
}

export function Gallery() {
  return (
    <div className="h-full overflow-auto bg-neutral-950 text-neutral-200" style={{ userSelect: 'text' }}>
      <div className="mx-auto flex max-w-[860px] flex-col gap-10 p-8">
        <header>
          <h1 className="text-[20px] font-semibold text-neutral-50">AmbientMind gallery</h1>
          <p className="mt-1 text-[13px] text-neutral-400">
            Every component in every state, against the mock bridge. Dev only.
          </p>
        </header>

        <Section title="Orb">
          {orbStates().map(([name, orbTasks, expanded]) => (
            <State key={name} name={name}>
              <div className="flex justify-center">
                <Orb tasks={orbTasks} now={NOW} expanded={expanded} onToggle={noop} />
              </div>
            </State>
          ))}
        </Section>

        <Section title="Task row">
          {taskItemStates().map(([name, task]) => (
            <State key={name} name={name}>
              <TaskItem
                task={task}
                now={NOW}
                onComplete={noop}
                onEdit={noop}
                onSnooze={noop}
                onDelete={noop}
              />
            </State>
          ))}
        </Section>

        <Section title="Task list">
          <State name="Empty">
            <TaskList tasks={[]} now={NOW} maxVisible={7} onComplete={noop} onEdit={noop} onSnooze={noop} onDelete={noop} />
          </State>
          <State name="Sample day">
            <TaskList tasks={tasks} now={NOW} maxVisible={7} onComplete={noop} onEdit={noop} onSnooze={noop} onDelete={noop} />
          </State>
          <State name="More than the visible limit (3)">
            <TaskList tasks={tasks} now={NOW} maxVisible={3} onComplete={noop} onEdit={noop} onSnooze={noop} onDelete={noop} />
          </State>
        </Section>

        <Section title="Recurrence suggestion">
          <State name="Pending">
            <SuggestionCard suggestion={sampleSuggestion()} onAccept={noop} onDismiss={noop} />
          </State>
        </Section>

        <Section title="Health banner">
          <State name="Ollama not running">
            <HealthBanner health={ollamaDownReport()} connecting={false} onConnectGoogle={noop} onRecheck={noop} />
          </State>
          <State name="Google can be connected">
            <HealthBanner health={googleDisconnectedReport()} connecting={false} onConnectGoogle={noop} onRecheck={noop} />
          </State>
          <State name="Connecting">
            <HealthBanner health={googleDisconnectedReport()} connecting onConnectGoogle={noop} onRecheck={noop} />
          </State>
          <State name="Several problems">
            <HealthBanner health={manyProblemsReport()} connecting={false} onConnectGoogle={noop} onRecheck={noop} />
          </State>
        </Section>
      </div>
    </div>
  )
}
