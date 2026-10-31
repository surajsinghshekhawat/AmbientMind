import { useEffect, useState } from 'react'
import { describePause, isAiPaused, pauseAiForHours } from '@shared/pauseAi'
import type { PermissionKind, PermissionState } from '@shared/permissions'
import {
  ABOUT_ME_MAX_CHARS,
  WHISPER_MODELS,
  type AppleSourcesStatus,
  type Config,
  type HealthReport,
  type OverlayCorner,
  type SpeechEngineInfo,
  type SyncSummary,
  type ThemeChoice
} from '@shared/types'
import { Button } from '@/ui/Button'
import { cn } from '@/ui/cn'
import { Orb } from '@/ui/Orb'
import { DraftInput, DraftTextarea } from './DraftField'
import { areaClass, fieldClass, Group, Page, Pill, Row, Segmented, Select, Toggle } from './controls'

export interface AccountStatus {
  google: boolean
  googleEmail: string | null
  credentialsConfigured: boolean
}

export interface SettingsData {
  config: Config
  account: AccountStatus
  ragCount: number
  health: HealthReport | null
  sync: SyncSummary | null
  learned: { title: string; deletes: number }[]
  permissions: PermissionState[]
  appInfo: { version: string; userData: string } | null
  speech: SpeechEngineInfo
  apple: AppleSourcesStatus
}

export interface SettingsActions {
  patch: (partial: Partial<Config>) => Promise<void>
  refresh: () => Promise<void>
  /** Runs a slow action with the buttons disabled; a returned string is shown as a toast. */
  run: (label: string, task: () => Promise<string | void>) => Promise<void>
  busy: string | null
  setLearned: (learned: SettingsData['learned']) => void
  setApple: (apple: AppleSourcesStatus) => void
}

interface PageProps {
  data: SettingsData
  actions: SettingsActions
}

export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return 'Never'
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms)) return 'Never'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

const CORNERS: { value: OverlayCorner; label: string }[] = [
  { value: 'top-right', label: 'Top right' },
  { value: 'top-left', label: 'Top left' },
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'bottom-left', label: 'Bottom left' }
]

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

const VISIBLE = [3, 5, 7, 10, 12, 15, 20]
const INTERVALS: Config['syncIntervalMinutes'][] = [5, 15, 30, 60]

export function General({ data: { config }, actions: { patch } }: PageProps) {
  const visible = VISIBLE.includes(config.maxTasksVisible) ? VISIBLE : [...VISIBLE, config.maxTasksVisible].sort((a, b) => a - b)
  return (
    <Page title="General">
      <Group>
        <Row label="Appearance" description="For Settings. The orb and its panel stay dark.">
          <Segmented label="Appearance" value={config.theme} options={THEMES} onChange={(theme) => void patch({ theme })} />
        </Row>
        <Row label="Orb position">
          <Select aria-label="Orb position" value={config.overlayCorner} onChange={(e) => void patch({ overlayCorner: e.target.value as OverlayCorner })}>
            {CORNERS.map((corner) => (
              <option key={corner.value} value={corner.value}>
                {corner.label}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Tasks before “Show more”">
          <Select aria-label="Tasks before Show more" value={config.maxTasksVisible} onChange={(e) => void patch({ maxTasksVisible: Number(e.target.value) })}>
            {visible.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Open at login" description="Adds AmbientMind to your login items. Off until you turn it on.">
          <Toggle label="Open at login" checked={config.launchAtLogin} onChange={(launchAtLogin) => void patch({ launchAtLogin })} />
        </Row>
      </Group>

      <Group
        title="About you"
        footer={`Background for the model when it reads your mail and screen. Never turned into a task, never leaves this Mac. ${config.aboutMe.length}/${ABOUT_ME_MAX_CHARS}`}
      >
        <Row label="Your name" description="How your mail addresses you." htmlFor="display-name">
          <DraftInput
            id="display-name"
            value={config.displayName}
            placeholder="Suraj"
            onCommit={(displayName) => patch({ displayName })}
            className={cn(fieldClass, 'w-48')}
          />
        </Row>
        <Row label="Context" htmlFor="about-me" stacked>
          <DraftTextarea
            id="about-me"
            rows={4}
            value={config.aboutMe}
            maxLength={ABOUT_ME_MAX_CHARS}
            placeholder={'College until 4pm on weekdays.\nTuition is non-negotiable.\nI handle the fees, not my brother.'}
            onCommit={(aboutMe) => patch({ aboutMe })}
            className={areaClass}
          />
        </Row>
      </Group>
    </Page>
  )
}

const ipcMessage = (err: unknown) => ((err as Error)?.message ?? '').replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

/** One Apple source: a switch that asks macOS first, and what it last did. */
function AppleSourceRow({
  source,
  apple,
  label,
  idle,
  active,
  onChange
}: {
  source: 'calendar' | 'reminders'
  apple: AppleSourcesStatus
  label: string
  idle: string
  active: string
  onChange: (next: AppleSourcesStatus) => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state = apple[source]
  const problem = error ?? (state.enabled ? state.lastError : null)
  const description = !apple.available
    ? 'Needs the AmbientMind helper, which isn’t running.'
    : problem
      ? <span className="text-danger">{problem}</span>
      : state.enabled
        ? `${active} · checked ${relativeTime(state.lastRun).toLowerCase()}`
        : idle
  return (
    <Row label={label} description={description}>
      <Toggle
        label={label}
        checked={state.enabled}
        onChange={async (on) => {
          if (pending || !apple.available) return
          setPending(true)
          setError(null)
          try {
            onChange(await window.ambient.appleSources.set(source, on))
          } catch (err) {
            setError(ipcMessage(err))
          } finally {
            setPending(false)
          }
        }}
      />
    </Row>
  )
}

export function Sources({ data: { config, account, sync, apple, permissions }, actions: { patch, run, busy, refresh, setApple } }: PageProps) {
  // Accessibility is a Mac-only permission, so its row says which platform this is.
  const onMac = permissions.some((p) => p.kind === 'accessibility')
  return (
    <Page title="Sources" description="Where tasks come from. Mail is read from this Mac; nothing passes through a server of ours.">
      <Group
        title="Google"
        footer={
          !account.credentialsConfigured ? (
            <span>
              Google needs an OAuth client file first. Put <code className="font-mono text-ink-2">google-credentials.json</code> in the
              app data folder (see docs/google-setup.md), then connect.{' '}
              <button type="button" className="focus-ring rounded text-accent hover:underline" onClick={() => void window.ambient.openUserData()}>
                Open the folder
              </button>
            </span>
          ) : sync?.lastError ? (
            <span className="text-danger">{sync.lastError}</span>
          ) : undefined
        }
      >
        <Row label="Gmail" description={account.google ? `Connected as ${account.googleEmail ?? 'your account'}` : 'Reads new mail for things you need to do.'}>
          {account.google ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={!!busy}
                onClick={() =>
                  void run('Disconnecting…', async () => {
                    await window.ambient.accounts.disconnect()
                    await refresh()
                    return 'Google disconnected'
                  })
                }
              >
                Disconnect
              </Button>
              <Button
                size="sm"
                disabled={!!busy}
                onClick={() =>
                  void run('Checking mail…', async () => {
                    const report = await window.ambient.syncNow()
                    await refresh()
                    return report.errors?.length ? report.errors[0] : `Checked ${report.scanned} messages, added ${report.added}`
                  })
                }
              >
                Check now
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              size="sm"
              disabled={!!busy || !account.credentialsConfigured}
              onClick={() =>
                void run('Waiting for Google…', async () => {
                  await window.ambient.accounts.connect()
                  await refresh()
                  return 'Google connected. The first check can take a minute.'
                })
              }
            >
              Connect
            </Button>
          )}
        </Row>
        {account.google && (
          <Row
            label="Check every"
            description={`Last checked ${relativeTime(sync?.lastRun ?? null).toLowerCase()}${
              sync?.lastReport ? ` · ${sync.lastReport.scanned} read, ${sync.lastReport.added} added` : ''
            }`}
          >
            <Select
              aria-label="Check every"
              value={config.syncIntervalMinutes}
              onChange={(e) => void patch({ syncIntervalMinutes: Number(e.target.value) as Config['syncIntervalMinutes'] })}
            >
              {INTERVALS.map((n) => (
                <option key={n} value={n}>
                  {n === 60 ? '1 hour' : `${n} minutes`}
                </option>
              ))}
            </Select>
          </Row>
        )}
        <Row
          label="Recurring rules on Google Calendar"
          description="Writes only to a separate “AmbientMind” calendar it creates, never yours. You may be asked to reconnect once."
        >
          <Toggle label="Recurring rules on Google Calendar" checked={config.calendarWriteBack} onChange={(calendarWriteBack) => void patch({ calendarWriteBack })} />
        </Row>
      </Group>

      {onMac && (
        <Group
          title="On this Mac"
          footer="Read through macOS with your permission; nothing leaves this Mac. Reminders only ever touches its own “AmbientMind” list."
        >
          <AppleSourceRow
            source="calendar"
            apple={apple}
            label="Apple Calendar"
            idle="Meetings with other people in the next two days become prep tasks. Covers every account in Internet Accounts."
            active={`${plural(apple.calendar.upcoming, 'meeting')} to prepare for`}
            onChange={setApple}
          />
          <AppleSourceRow
            source="reminders"
            apple={apple}
            label="Reminders"
            idle="Two-way with an “AmbientMind” list: finish a task on your iPhone and it clears here."
            active={`${plural(apple.reminders.linked, 'task')} in ${apple.reminders.list ?? 'the AmbientMind list'}`}
            onChange={setApple}
          />
        </Group>
      )}
    </Page>
  )
}

export function AiModels({ data: { config, health, ragCount, account }, actions: { patch, run, busy, refresh } }: PageProps) {
  return (
    <Page title="AI & Models" description="Everything runs on this Mac. No prompt or email is sent anywhere.">
      <Group
        title="Status"
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
          <Button variant="ghost" size="sm" onClick={() => void run('Checking…', refresh)}>
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
        <Row label="Apple Intelligence" description="Used first when this Mac has it, with Ollama as the fallback.">
          <Pill tone="soon">Coming soon</Pill>
        </Row>
      </Group>

      <Group title="Model" footer="Any model you have pulled into the project’s Ollama. Smaller is faster; qwen2.5:3b is the tested default.">
        <Row label="Ollama model" htmlFor="ollama-model">
          <DraftInput
            id="ollama-model"
            value={config.ollamaModel}
            onCommit={(ollamaModel) => patch({ ollamaModel })}
            className={cn(fieldClass, 'w-48 font-mono text-small')}
          />
        </Row>
      </Group>

      <Group title="Learning">
        <Row label="Examples remembered" description="Similar past mail is shown to the model, so it learns how you work.">
          <span className="tabular text-body text-ink-2">{ragCount}</span>
        </Row>
        <Row label="Measure accuracy on your mail" description="Exports recent mail with today’s answers filled in, for you to correct. Stays on this Mac.">
          <Button
            size="sm"
            disabled={!!busy || !account.google}
            onClick={() =>
              void run('Reading your mail… this takes a few minutes.', async () => {
                const result = await window.ambient.exportCorpus()
                return `Wrote ${result.messages} messages to ${result.path}`
              })
            }
          >
            Export
          </Button>
        </Row>
      </Group>
    </Page>
  )
}

export const PERMISSION_NAMES: Record<PermissionKind, string> = {
  microphone: 'Microphone',
  screen: 'Screen Recording',
  accessibility: 'Accessibility'
}

export const PERMISSION_USE: Record<PermissionKind, string> = {
  microphone: 'To talk to Quick Capture. Audio is transcribed on this Mac and never saved.',
  screen: 'Only when you ask it to read your screen. Nothing is recorded or kept.',
  accessibility: 'Reads the text of the window in front when you capture it, with no screenshot. Password managers are never read.'
}

export function permissionPill(permission: PermissionState) {
  switch (permission.status) {
    case 'granted':
      return <Pill tone="ok">Allowed</Pill>
    case 'denied':
      return <Pill tone="warn">Off</Pill>
    case 'restricted':
      return <Pill tone="bad">Blocked</Pill>
    case 'not-determined':
      // macOS never asks for Accessibility on its own; it is simply off until allowed.
      return <Pill tone="quiet">{permission.kind === 'accessibility' ? 'Off' : 'Asks on first use'}</Pill>
    default:
      return <Pill tone="quiet">Not needed</Pill>
  }
}

/**
 * Allow where macOS still shows a prompt; System Settings once it has been
 * refused, since macOS never asks twice.
 */
export function PermissionAction({ permission, onChange }: { permission: PermissionState; onChange: () => void }) {
  if (permission.status === 'granted' || !permission.canOpenSettings) return null
  if (permission.status === 'not-determined' && permission.kind !== 'screen') {
    return (
      <Button
        size="sm"
        onClick={async () => {
          await window.ambient.requestPermission(permission.kind)
          onChange()
        }}
      >
        Allow
      </Button>
    )
  }
  return (
    <Button size="sm" onClick={() => void window.ambient.openPermissionSettings(permission.kind)}>
      Open System Settings
    </Button>
  )
}

function PermissionRow({ permission, onChange }: { permission: PermissionState; onChange: () => void }) {
  return (
    <Row label={PERMISSION_NAMES[permission.kind]} description={permission.help ?? PERMISSION_USE[permission.kind]}>
      {permissionPill(permission)}
      <PermissionAction permission={permission} onChange={onChange} />
    </Row>
  )
}

/**
 * Apple's speech model, on a Mac that supports it. macOS keeps it with
 * Dictation's models, outside the app, so it is only fetched on request.
 */
function LiveWordsRow({ speech, onChange }: { speech: SpeechEngineInfo; onChange: () => void }) {
  const [progress, setProgress] = useState<number | null>(speech.installing)
  const [error, setError] = useState<string | null>(null)
  const apple = speech.apple
  const downloading = progress !== null

  useEffect(() => {
    if (!downloading) return
    const timer = setInterval(() => {
      void window.ambient.speech.engine().then((info) => {
        if (info.installing !== null) setProgress(info.installing)
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [downloading])

  if (!apple?.available) return null
  if (apple.installed) {
    return (
      <Row label="Live words" description={error ?? 'Words appear as you talk and land the moment you stop. Runs on this Mac.'}>
        <Pill tone="ok">On</Pill>
      </Row>
    )
  }
  return (
    <Row
      label="Live words"
      description={
        error ??
        (downloading || apple.downloading
          ? 'macOS is downloading the speech model. You can keep working.'
          : 'Words appear as you talk. A one-time download, kept by macOS with Dictation.')
      }
    >
      {downloading || apple.downloading ? (
        <Pill tone="quiet">{progress ? `Downloading ${Math.round(progress * 100)}%` : 'Downloading…'}</Pill>
      ) : (
        <Button
          size="sm"
          onClick={async () => {
            setError(null)
            setProgress(0)
            try {
              await window.ambient.speech.install()
            } catch {
              setError('The download didn’t finish. Check your connection and try again.')
            } finally {
              setProgress(null)
              onChange()
            }
          }}
        >
          Download
        </Button>
      )}
    </Row>
  )
}

export function Capture({ data: { config, permissions, speech }, actions: { patch, refresh } }: PageProps) {
  const screen = permissions.find((p) => p.kind === 'screen')
  const accessibility = permissions.find((p) => p.kind === 'accessibility')
  const live = speech.engine === 'apple'
  return (
    <Page title="Capture" description="Add tasks by typing, talking or pointing at your screen.">
      <Group
        title="Voice"
        footer={
          live
            ? 'Hold the Quick Capture shortcut to talk and let go to finish, or tap it twice. The voice model below is only used if live words are unavailable.'
            : 'Speech is turned into text on the CPU, so a larger model costs seconds, not memory. A new model downloads once, in the background.'
        }
      >
        <LiveWordsRow speech={speech} onChange={() => void refresh()} />
        <Row label={live ? 'Fallback voice model' : 'Voice model'}>
          <Select aria-label="Voice model" value={config.whisperModel} onChange={(e) => void patch({ whisperModel: e.target.value })}>
            {WHISPER_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </Select>
        </Row>
      </Group>
      {screen && (
        <Group
          title="Screen"
          footer={
            accessibility
              ? 'Say “add what’s on my screen” in Quick Capture, or use the capture shortcut. With Accessibility it reads the window’s text directly; Screen Recording covers apps that don’t expose any.'
              : 'Say “add what’s on my screen” in Quick Capture, or use the capture shortcut.'
          }
        >
          {accessibility && <PermissionRow permission={accessibility} onChange={() => void refresh()} />}
          <PermissionRow permission={screen} onChange={() => void refresh()} />
        </Group>
      )}
    </Page>
  )
}

export function Learned({ data: { learned }, actions: { setLearned } }: PageProps) {
  return (
    <Page title="Learned" description="Things you deleted again and again without doing. New ones are kept off your list.">
      {learned.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-inner bg-fill px-6 py-10 text-center hairline">
          <p className="text-body text-ink-2">Nothing learned yet</p>
          <p className="max-w-[300px] text-small text-ink-3">When you keep deleting the same kind of task, it shows up here so you can undo it.</p>
        </div>
      ) : (
        <Group>
          {learned.map((entry) => (
            <Row key={entry.title} label={entry.title} description={`Deleted ${entry.deletes} times`}>
              <Button variant="ghost" size="sm" onClick={async () => setLearned(await window.ambient.learned.forget(entry.title))}>
                Allow again
              </Button>
            </Row>
          ))}
        </Group>
      )}
    </Page>
  )
}

function tomorrowMorning(now = new Date()): string {
  const next = new Date(now)
  next.setDate(next.getDate() + 1)
  next.setHours(8, 0, 0, 0)
  return next.toISOString()
}

export function Privacy({ data: { config }, actions: { patch, run, busy } }: PageProps) {
  const [passphrase, setPassphrase] = useState('')
  const paused = isAiPaused(config.pauseAiUntil)
  return (
    <Page title="Privacy & Data" description="Your mail, tasks and model all live on this Mac. Nothing is uploaded, and there is no account.">
      <Group title="Pause AI" footer="While paused nothing reads your mail or screen. Recurring tasks and snoozes still work.">
        <Row label={paused ? 'Paused' : 'AI is on'} description={paused ? describePause(config.pauseAiUntil!) : 'Reads new mail on schedule and answers in chat.'}>
          {paused ? (
            <Button variant="primary" size="sm" onClick={() => void patch({ pauseAiUntil: null })}>
              Resume
            </Button>
          ) : (
            <>
              <Button size="sm" onClick={() => void patch({ pauseAiUntil: pauseAiForHours(1) })}>
                For 1 hour
              </Button>
              <Button size="sm" onClick={() => void patch({ pauseAiUntil: tomorrowMorning() })}>
                Until tomorrow
              </Button>
            </>
          )}
        </Row>
      </Group>

      <Group title="Backup" footer="An encrypted file with your tasks, rules and settings. Without the passphrase it cannot be opened, by anyone.">
        <Row label="Passphrase" htmlFor="backup-passphrase">
          <input
            id="backup-passphrase"
            type="password"
            autoComplete="new-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="At least 8 characters"
            className={cn(fieldClass, 'w-48')}
          />
          <Button
            size="sm"
            disabled={!!busy || passphrase.length < 8}
            onClick={() =>
              void run('Writing backup…', async () => {
                const result = await window.ambient.exportBackup(passphrase)
                if (result.canceled) return
                setPassphrase('')
                return `Backup saved to ${result.path}`
              })
            }
          >
            Save backup…
          </Button>
        </Row>
      </Group>

      <Group title="Your data">
        <Row label="App data folder" description="The database, settings and downloaded models.">
          <Button size="sm" onClick={() => void window.ambient.openUserData()}>
            Show in Finder
          </Button>
        </Row>
      </Group>
    </Page>
  )
}

export function Permissions({ data: { permissions }, actions: { refresh } }: PageProps) {
  return (
    <Page title="Permissions" description="Asked for only when a feature needs it. Changes in System Settings show up here when you come back.">
      <Group>
        {permissions.map((permission) => (
          <PermissionRow key={permission.kind} permission={permission} onChange={() => void refresh()} />
        ))}
      </Group>
    </Page>
  )
}

export function About({ data: { appInfo } }: PageProps) {
  return (
    <Page title="About">
      <div className="flex items-center gap-4 rounded-inner bg-fill px-4 py-4 hairline">
        <span data-theme="dark" className="contents">
          <Orb look={{ motion: 'breathing', calm: true, arc: null, badge: null, attention: false, peek: '' }} size={48} />
        </span>
        <div>
          <p className="text-title font-semibold text-ink-1">AmbientMind</p>
          <p className="text-small text-ink-3">Version {appInfo?.version ?? '…'} · Your tasks, noticed for you.</p>
        </div>
      </div>
      <Group>
        <Row label="Welcome tour" description="The first-run guide: sources, permissions, model and shortcuts.">
          <Button size="sm" onClick={() => window.ambient.openOnboarding()}>
            Show again
          </Button>
        </Row>
        <Row label="Data folder" description={<span className="font-mono text-micro break-all">{appInfo?.userData ?? '…'}</span>}>
          <Button size="sm" onClick={() => void window.ambient.openUserData()}>
            Show
          </Button>
        </Row>
      </Group>
    </Page>
  )
}
