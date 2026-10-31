import { useState, type ReactNode } from 'react'
import { MessageCircle, Plus, Search, Settings } from 'lucide-react'
import { orbLook, type Activity } from '@shared/orb'
import type { ShortcutStatus } from '@shared/shortcuts'
import type { HealthReport, RecurrenceSuggestion, Task } from '@shared/types'
import {
  googleDisconnectedReport,
  inHours,
  makeTask,
  ollamaDownReport,
  sampleSuggestedTasks,
  sampleSuggestion,
  sampleTasks
} from '../dev/fixtures'
import { Panel, type PanelProps } from '../overlay/Panel'
import { Button } from '../ui/Button'
import { Check } from '../ui/Check'
import { IconButton } from '../ui/IconButton'
import { Kbd } from '../ui/Kbd'
import { Orb } from '../ui/Orb'
import { StatusLine } from '../ui/StatusLine'
import { ToastProvider, ToastRegion, useToast } from '../ui/Toast'

const NOW = Date.now()
const noop = () => {}
const tasks = sampleTasks(NOW)
const suggested = sampleSuggestedTasks(NOW)

const SHORTCUTS: ShortcutStatus[] = [
  { action: 'quickAdd', name: 'Quick add', accelerator: 'Control+Alt+Space', label: '⌃⌥Space', problem: null },
  { action: 'chat', name: 'Ask', accelerator: 'Control+Alt+C', label: '⌃⌥C', problem: null },
  { action: 'settings', name: 'Settings', accelerator: 'Control+Alt+,', label: '⌃⌥,', problem: null }
]

// The overlay floats over arbitrary wallpaper, so every state is shown on a
// dark, a light and a busy backdrop.
const BACKDROPS = [
  { name: 'Dark wallpaper', style: { background: 'linear-gradient(135deg, #1b2735 0%, #2b1f3a 100%)' } },
  { name: 'Light wallpaper', style: { background: 'linear-gradient(135deg, #f4efe4 0%, #d7e6f4 100%)' } },
  {
    name: 'Busy wallpaper',
    style: {
      background:
        'radial-gradient(circle at 20% 25%, #ffcf5c 0 18%, transparent 19%), radial-gradient(circle at 75% 30%, #ff6b6b 0 14%, transparent 15%), radial-gradient(circle at 55% 80%, #4dd0e1 0 22%, transparent 23%), repeating-linear-gradient(45deg, #ffffff 0 12px, #1f2937 12px 24px)'
    }
  }
]

function Backdrops({ children, width = 380, only }: { children: ReactNode; width?: number; only?: number[] }) {
  const shown = only ? BACKDROPS.filter((_, i) => only.includes(i)) : BACKDROPS
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
      {shown.map((backdrop) => (
        <div
          key={backdrop.name}
          title={backdrop.name}
          className="flex min-h-24 items-start justify-center overflow-hidden rounded-xl p-5"
          style={backdrop.style}
        >
          <div style={{ width }}>{children}</div>
        </div>
      ))}
    </div>
  )
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function State({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div id={slug(name)} className="flex flex-col gap-2">
      <p className="text-small text-ink-3">{name}</p>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section id={slug(title)} className="flex flex-col gap-5">
      <h2 className="text-title font-semibold text-ink-1">{title}</h2>
      {children}
    </section>
  )
}

function Swatch({ name, color }: { name: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-6 rounded-md hairline" style={{ background: `var(--${color})` }} />
      <span className="text-small text-ink-2">{name}</span>
    </div>
  )
}

function ToastDemo() {
  const toast = useToast()
  return (
    <div className="glass flex w-[380px] flex-col gap-2 p-2">
      <div className="flex gap-1">
        <Button size="sm" onClick={() => toast.show({ message: 'Completed “Renew passport”', action: { label: 'Undo', run: noop } })}>
          Show undo toast
        </Button>
        <Button size="sm" variant="ghost" onClick={() => toast.show({ message: 'Could not reach Gmail. Will retry in 5 min.', tone: 'danger' })}>
          Show error
        </Button>
      </div>
      <ToastRegion />
    </div>
  )
}

const ORB_STATES: [string, Task[], Activity, boolean][] = [
  ['Idle, nothing due', [], 'idle', false],
  ['Due within 3 days', [makeTask({ deadline: inHours(40, NOW) })], 'idle', false],
  ['Due today (badge)', [makeTask({ deadline: inHours(3, NOW) })], 'idle', false],
  ['Overdue (pulsing arc)', [makeTask({ deadline: inHours(-2, NOW) }), makeTask({ deadline: inHours(2, NOW) })], 'idle', false],
  ['Syncing', [], 'syncing', false],
  ['Reading the screen', [], 'reading', false],
  ['Listening', [], 'listening', false],
  ['Composing an answer', [], 'composing', false],
  ['Needs attention', [], 'idle', true]
]

function panelProps(overrides: Partial<PanelProps>): PanelProps {
  return {
    tasks,
    now: NOW,
    activity: 'idle',
    health: null,
    recurrence: [],
    lastRun: new Date(NOW - 3 * 60_000).toISOString(),
    syncIntervalMinutes: 15,
    maxVisible: 7,
    shortcuts: SHORTCUTS,
    onTasks: noop,
    onRecurrence: noop,
    onCollapse: noop,
    onRecheckHealth: noop,
    onConnectGoogle: noop,
    autoFocus: false,
    ...overrides
  }
}

function PanelState(overrides: Partial<PanelProps>) {
  return (
    <ToastProvider>
      <Panel {...panelProps(overrides)} />
    </ToastProvider>
  )
}

/** Interactive: complete, snooze, delete and undo all work against the mock. */
function LivePanel() {
  const [live, setLive] = useState<Task[]>([...tasks, ...suggested])
  const [recurrence, setRecurrence] = useState<RecurrenceSuggestion[]>([sampleSuggestion()])
  return (
    <ToastProvider>
      <Panel {...panelProps({ tasks: live, onTasks: setLive, recurrence, onRecurrence: setRecurrence })} />
    </ToastProvider>
  )
}

const longTasks: Task[] = [
  makeTask({
    title: 'Draft the response to legal about the indemnity clause in the renewed enterprise agreement before the call',
    deadline: inHours(5, NOW),
    source: 'gmail',
    people: ['Legal', 'Arjun']
  }),
  ...Array.from({ length: 12 }, (_, i) =>
    makeTask({ title: `Backlog item ${i + 1}`, deadline: i % 3 === 0 ? inHours(30 + i * 10, NOW) : null })
  )
]

const unhealthy: HealthReport = ollamaDownReport()

export function Gallery() {
  return (
    <div data-theme="dark" className="h-full overflow-auto bg-[oklch(0.15_0.004_286)] text-ink-1" style={{ userSelect: 'text' }}>
      <div className="mx-auto flex max-w-[1240px] flex-col gap-12 p-8">
        <header>
          <h1 className="text-display font-semibold">AmbientMind gallery</h1>
          <p className="mt-1 text-body text-ink-3">Every component in every state, against the mock bridge. Dev only.</p>
        </header>

        <Section title="Tokens">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {['ink-1', 'ink-2', 'ink-3', 'ink-4', 'accent', 'success', 'soon', 'warning', 'danger', 'fill-2', 'hairline-2'].map((c) => (
              <Swatch key={c} name={c} color={c} />
            ))}
          </div>
          <div className="flex items-baseline gap-6">
            <span className="text-display font-semibold">Display 20</span>
            <span className="text-title font-medium">Title 15</span>
            <span className="text-body">Body 13</span>
            <span className="text-small text-ink-2">Small 12</span>
            <span className="text-micro text-ink-3">Micro 11</span>
          </div>
        </Section>

        <Section title="Primitives">
          <Backdrops width={380}>
            <div className="glass flex flex-col gap-3 p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Button variant="primary">Add</Button>
                <Button>Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger">Delete</Button>
                <Button disabled>Disabled</Button>
              </div>
              <div className="flex items-center gap-1">
                <IconButton label="Search">
                  <Search />
                </IconButton>
                <IconButton label="Capture">
                  <Plus />
                </IconButton>
                <IconButton label="Ask" active>
                  <MessageCircle />
                </IconButton>
                <IconButton label="Settings">
                  <Settings />
                </IconButton>
                <span className="ml-auto flex gap-1">
                  <Kbd>⌃⌥Space</Kbd>
                  <Kbd>⌘Z</Kbd>
                  <Kbd>Esc</Kbd>
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Check checked={false} onChange={noop} label="Neutral" />
                <Check checked={false} onChange={noop} label="Soon" tone="soon" />
                <Check checked={false} onChange={noop} label="Today" tone="warning" />
                <Check checked={false} onChange={noop} label="Overdue" tone="danger" />
                <Check checked onChange={noop} label="Done" />
              </div>
              <StatusLine text="Checking mail and calendar…" live />
              <StatusLine text="2 due today" />
            </div>
          </Backdrops>
          <State name="Toast">
            <ToastProvider>
              <ToastDemo />
            </ToastProvider>
          </State>
        </Section>

        <Section title="Orb">
          <Backdrops width={760}>
            <div className="flex flex-wrap justify-between gap-y-4">
              {ORB_STATES.map(([name, orbTasks, activity, attention]) => (
                <div key={name} className="flex w-20 flex-col items-center gap-1.5">
                  <Orb look={orbLook({ tasks: orbTasks, now: NOW, activity, attention })} />
                  <span className="text-center text-micro text-ink-1 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">{name}</span>
                </div>
              ))}
            </div>
          </Backdrops>
        </Section>

        <Section title="Panel">
          <State name="Live (interactive: Space completes, s snoozes, ⌘Z undoes, Enter opens details)">
            <Backdrops only={[0]}>
              <LivePanel />
            </Backdrops>
          </State>
          <State name="A sample day">
            <Backdrops>
              <PanelState />
            </Backdrops>
          </State>
          <State name="Syncing, with a suggestion and a pattern">
            <Backdrops only={[0, 1]}>
              <PanelState tasks={[...tasks.slice(0, 2), ...suggested]} activity="syncing" recurrence={[sampleSuggestion()]} />
            </Backdrops>
          </State>
          <State name="All clear">
            <Backdrops>
              <PanelState tasks={[]} />
            </Backdrops>
          </State>
          <State name="Something needs fixing">
            <Backdrops only={[0, 1]}>
              <PanelState tasks={tasks.slice(2, 4)} health={unhealthy} />
            </Backdrops>
          </State>
          <State name="Google can be connected">
            <Backdrops only={[0]}>
              <PanelState tasks={[]} health={googleDisconnectedReport()} />
            </Backdrops>
          </State>
          <State name="Long titles and more than the visible limit">
            <Backdrops only={[0]}>
              <PanelState tasks={longTasks} maxVisible={5} />
            </Backdrops>
          </State>
        </Section>
      </div>
    </div>
  )
}
