import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, Cpu, Lock, Mail, Undo2 } from 'lucide-react'
import type { PermissionState } from '@shared/permissions'
import type { ShortcutStatus } from '@shared/shortcuts'
import type { HealthReport } from '@shared/types'
import { Button } from '@/ui/Button'
import { cn } from '@/ui/cn'
import { Kbd } from '@/ui/Kbd'
import { Orb } from '@/ui/Orb'
import { Group, Pill, Row, Toggle } from '../settings/controls'
import { PERMISSION_NAMES, PERMISSION_USE, PermissionAction, permissionPill, type AccountStatus } from '../settings/pages'
import { clientOs } from '../settings/Shortcuts'

export const STEPS = ['welcome', 'privacy', 'sources', 'permissions', 'model', 'shortcuts'] as const
export type Step = (typeof STEPS)[number]

const IDLE_ORB = { motion: 'breathing', calm: true, arc: null, badge: null, attention: false, peek: '' } as const

function Hero({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-[24px] leading-[30px] font-semibold tracking-[-0.015em] text-ink-1">{title}</h1>
      {children && <p className="text-title leading-[1.5] text-ink-2">{children}</p>}
    </header>
  )
}

function Commitment({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-inner bg-fill-2 text-accent hairline [&_svg]:size-[17px] [&_svg]:stroke-[1.75]">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-body font-medium text-ink-1">{title}</span>
        <span className="mt-0.5 block text-body leading-[1.45] text-ink-3">{children}</span>
      </span>
    </li>
  )
}

interface Props {
  initialStep?: Step | undefined
  applyTheme?: boolean
}

export function App({ initialStep = 'welcome', applyTheme = true }: Props) {
  const [step, setStep] = useState<Step>(initialStep)
  const [account, setAccount] = useState<AccountStatus | null>(null)
  const [permissions, setPermissions] = useState<PermissionState[]>([])
  const [health, setHealth] = useState<HealthReport | null>(null)
  const [shortcuts, setShortcuts] = useState<ShortcutStatus[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [screenReading, setScreenReading] = useState(false)

  const checkPermissions = useCallback(() => void window.ambient.getPermissions().then(setPermissions), [])
  const checkHealth = useCallback(async () => setHealth(await window.ambient.getHealth()), [])

  useEffect(() => {
    void window.ambient.getConfig().then((config) => {
      if (applyTheme) document.documentElement.dataset.theme = config.theme
      setScreenReading(config.screenReading)
    })
    void window.ambient.accounts.status().then(setAccount)
    void window.ambient.getShortcuts().then(setShortcuts)
    void checkHealth()
    checkPermissions()
    // Coming back from System Settings should show the new state.
    window.addEventListener('focus', checkPermissions)
    return () => window.removeEventListener('focus', checkPermissions)
  }, [applyTheme, checkHealth, checkPermissions])

  const index = STEPS.indexOf(step)
  const last = index === STEPS.length - 1
  const next = () => (last ? window.ambient.finishOnboarding() : setStep(STEPS[index + 1]!))
  const back = () => setStep(STEPS[Math.max(0, index - 1)]!)

  // Enter is the default button, as in a Mac sheet, unless a control has focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.key !== 'Enter' || target.closest('button, input, textarea, select, a')) return
      event.preventDefault()
      next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const attempt = async (task: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  const askMicrophone = () =>
    attempt(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((track) => track.stop())
      } catch {
        // Refused or unavailable: the status row explains what to do.
      }
      checkPermissions()
    })

  const microphone = permissions.find((p) => p.kind === 'microphone')
  const screen = permissions.find((p) => p.kind === 'screen')
  const accessibility = permissions.find((p) => p.kind === 'accessibility')

  const body = (() => {
    switch (step) {
      case 'welcome':
        return (
          <>
            <span data-theme="dark" className="contents">
              <Orb look={IDLE_ORB} size={88} />
            </span>
            <Hero title="Meet AmbientMind">
              It reads your mail for the things you need to do, and keeps them in a small orb in the corner of your screen. Nothing to
              file, nothing to forget.
            </Hero>
          </>
        )
      case 'privacy':
        return (
          <>
            <Hero title="It stays on this Mac" />
            <ul className="flex flex-col gap-5">
              <Commitment icon={<Cpu />} title="The model runs here">
                Reading mail and answering questions happen on this Mac. No prompt is sent to a server.
              </Commitment>
              <Commitment icon={<Mail />} title="Mail goes straight from Google to you">
                There is no AmbientMind account and no server in between.
              </Commitment>
              <Commitment icon={<Undo2 />} title="You stay in charge">
                Every change can be undone, suggestions wait for your OK, and you can pause the AI at any time.
              </Commitment>
              <Commitment icon={<Lock />} title="Backups are yours">
                Export an encrypted backup whenever you like. Only your passphrase opens it.
              </Commitment>
            </ul>
          </>
        )
      case 'sources':
        return (
          <>
            <Hero title="Where should it look?">Connect what you use now. You can add more later in Settings.</Hero>
            <Group
              footer={
                account && !account.credentialsConfigured
                  ? 'Google needs an OAuth client file in the app data folder first (see docs/google-setup.md). You can do this later.'
                  : undefined
              }
            >
              <Row label="Gmail" description={account?.google ? `Connected as ${account.googleEmail ?? 'your account'}` : 'New mail is read for things to do.'}>
                {account?.google ? (
                  <Pill tone="ok">Connected</Pill>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy || !account?.credentialsConfigured}
                    onClick={() =>
                      void attempt(async () => {
                        await window.ambient.accounts.connect()
                        setAccount(await window.ambient.accounts.status())
                      })
                    }
                  >
                    {busy ? 'Waiting for Google…' : 'Connect'}
                  </Button>
                )}
              </Row>
              <Row label="Apple Calendar" description="Timed events, so you can see the day coming.">
                <Pill tone="soon">Coming soon</Pill>
              </Row>
              <Row label="Reminders" description="Complete a task here and it’s done there too.">
                <Pill tone="soon">Coming soon</Pill>
              </Row>
            </Group>
          </>
        )
      case 'permissions':
        return (
          <>
            <Hero title="Optional permissions">Only for the features that need them. Skip any of them and the rest still works.</Hero>
            <Group>
              {microphone && (
                <Row label="Microphone" description={microphone.help ?? 'To add tasks by talking. Audio is turned into text here and never kept.'}>
                  {permissionPill(microphone)}
                  {microphone.status === 'not-determined' && (
                    <Button size="sm" disabled={busy} onClick={() => void askMicrophone()}>
                      Allow
                    </Button>
                  )}
                  {microphone.canOpenSettings && (microphone.status === 'denied' || microphone.status === 'restricted') && (
                    <Button size="sm" onClick={() => void window.ambient.openPermissionSettings('microphone')}>
                      Open System Settings
                    </Button>
                  )}
                </Row>
              )}
              {screen && (
                <Row label="Read the screen" description="Make a task from what’s in front of you, when you ask. Off unless you turn it on.">
                  <Toggle
                    label="Read the screen"
                    checked={screenReading}
                    onChange={(on) => {
                      setScreenReading(on)
                      void window.ambient.setConfig({ screenReading: on })
                    }}
                  />
                </Row>
              )}
              {screen && screenReading && (
                <Row
                  label="Screen Recording"
                  description={screen.help ?? 'Only when you ask it to read your screen. Nothing is recorded or kept. macOS asks again every month.'}
                >
                  {permissionPill(screen)}
                  {screen.canOpenSettings && screen.status !== 'granted' && (
                    <Button size="sm" onClick={() => void window.ambient.openPermissionSettings('screen')}>
                      Open System Settings
                    </Button>
                  )}
                </Row>
              )}
              {accessibility && screenReading && (
                <Row label={PERMISSION_NAMES.accessibility} description={accessibility.help ?? PERMISSION_USE.accessibility}>
                  {permissionPill(accessibility)}
                  <PermissionAction permission={accessibility} onChange={checkPermissions} />
                </Row>
              )}
            </Group>
          </>
        )
      case 'model':
        return (
          <>
            <Hero title="The model on this Mac">
              {health?.ok ? 'Everything it needs is here and running.' : 'AmbientMind uses a small local model through Ollama.'}
            </Hero>
            <Group
              footer={
                health && health.problems.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-warning">
                    {health.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                ) : undefined
              }
            >
              <Row label="Ollama" description={health?.ollama.url ?? 'Checking…'}>
                {health && <Pill tone={health.ollama.running ? 'ok' : 'bad'}>{health.ollama.running ? 'Running' : 'Not reachable'}</Pill>}
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void attempt(checkHealth)}>
                  Check again
                </Button>
              </Row>
              {health?.models.map((model) => (
                <Row
                  key={model.name}
                  label={model.role === 'extraction' ? 'Task model' : 'Memory model'}
                  description={<span className="font-mono text-micro">{model.name}</span>}
                >
                  <Pill tone={model.present ? 'ok' : 'warn'}>{model.present ? 'Ready' : 'Not downloaded'}</Pill>
                </Row>
              ))}
            </Group>
          </>
        )
      case 'shortcuts':
        return (
          <>
            <Hero title="You’re set">These work from any app. Change them any time in Settings.</Hero>
            <ul className="flex flex-col gap-3">
              {shortcuts
                .filter((s) => s.action !== 'settings')
                .map((s) => (
                  <li key={s.action} className="flex items-center justify-between gap-4">
                    <span className="text-title text-ink-1">{s.name}</span>
                    <Kbd size="lg">{s.label}</Kbd>
                  </li>
                ))}
              <li className="flex items-center justify-between gap-4">
                <span className="text-title text-ink-1">See your tasks</span>
                <span className="text-body text-ink-3">Click the orb in the corner</span>
              </li>
            </ul>
          </>
        )
    }
  })()

  return (
    <div className="flex h-full flex-col bg-[var(--window)] text-ink-1">
      <div className={cn('shrink-0 [-webkit-app-region:drag]', clientOs === 'mac' ? 'h-12' : 'h-4')} />
      <main key={step} className="mx-auto flex min-h-0 w-full max-w-[460px] flex-1 animate-rise flex-col justify-center gap-7 overflow-y-auto px-2 pb-4">
        {body}
        {error && <p className="text-small text-danger">{error}</p>}
      </main>
      <footer className="flex h-16 shrink-0 items-center gap-3 px-6 shadow-[inset_0_0.5px_0_var(--hairline)]">
        <ol className="flex flex-1 gap-1.5" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <li key={s} className={cn('h-1.5 rounded-full transition-all duration-300', i === index ? 'w-4 bg-accent' : i < index ? 'w-1.5 bg-ink-3' : 'w-1.5 bg-fill-3')} />
          ))}
        </ol>
        {index > 0 && (
          <Button variant="ghost" onClick={back}>
            <ArrowLeft />
            Back
          </Button>
        )}
        <Button variant="primary" onClick={next}>
          {index === 0 ? 'Get started' : last ? 'Start using AmbientMind' : step === 'sources' && !account?.google ? 'Skip for now' : 'Continue'}
        </Button>
      </footer>
    </div>
  )
}
