import { useCallback, useEffect, useState } from 'react'
import { DESTINATION_LABEL, type NetworkSummary } from '@shared/network'
import { describePause, isAiPaused, pauseAiForHours, PAUSE_UNTIL_RESUMED, tomorrowMorning } from '@shared/pauseAi'
import { Button } from '@/ui/Button'
import { Group, Page, Pill, Row, Toggle } from './controls'
import { relativeTime, type SettingsActions, type SettingsData } from './pages'

interface PageProps {
  data: SettingsData
  actions: SettingsActions
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function NetworkActivity({ actions: { run, busy } }: Pick<PageProps, 'actions'>) {
  const [summary, setSummary] = useState<NetworkSummary | null>(null)
  const [showRecent, setShowRecent] = useState(false)
  const load = useCallback(async () => setSummary(await window.ambient.privacy.network()), [])

  useEffect(() => {
    void load()
  }, [load])

  if (!summary) return null
  const offDevice = summary.destinations.filter((d) => d.destination !== 'this-mac')
  return (
    <Group
      title="What leaves this Mac"
      footer="AmbientMind logs its own requests and its windows’ as they happen: where to, never what was sent. macOS downloads Apple’s speech model itself, so that isn’t listed."
    >
      {offDevice.length === 0 ? (
        <Row label="Nothing yet" description="No request has left this Mac since the log started." />
      ) : (
        offDevice.map((destination) => (
          <Row
            key={destination.destination}
            label={DESTINATION_LABEL[destination.destination]}
            description={`${destination.hosts.join(', ')} · last ${relativeTime(destination.lastAt).toLowerCase()}`}
          >
            <Pill tone={destination.destination === 'other' ? 'warn' : 'quiet'}>{plural(destination.requests, 'request')}</Pill>
          </Row>
        ))
      )}
      <Row label="To this Mac" description="Ollama and the Google sign-in callback. Counted, not logged.">
        <Pill tone="quiet">{summary.localSinceLaunch.toLocaleString()} since launch</Pill>
      </Row>
      {summary.recent.length > 0 && (
        <Row label="Recent requests" description={showRecent ? undefined : `The last ${summary.recent.length}, newest first.`} stacked={showRecent}>
          {showRecent ? (
            <div className="flex w-full flex-col gap-2">
              <ol aria-label="Recent requests" className="max-h-56 overflow-y-auto rounded-control bg-fill-2 px-2.5 py-2 font-mono text-micro leading-[1.7] text-ink-2 hairline">
                {summary.recent.map((request, index) => (
                  <li key={`${request.at}-${index}`} className="flex gap-2 whitespace-nowrap">
                    <span className="text-ink-4">{clock(request.at)}</span>
                    <span className={request.status === null || request.status >= 400 ? 'text-danger' : 'text-ink-3'}>
                      {request.status ?? 'failed'}
                    </span>
                    <span className="truncate">
                      {request.method} {request.host}
                      {request.path}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setShowRecent(false)}>
                  Hide
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() =>
                    void run('Clearing…', async () => {
                      const result = await window.ambient.privacy.clearNetwork()
                      await load()
                      return result.canceled ? undefined : 'Network log cleared'
                    })
                  }
                >
                  Clear log…
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" onClick={() => void load().then(() => setShowRecent(true))}>
              Show
            </Button>
          )}
        </Row>
      )}
    </Group>
  )
}

export function Privacy({ data, actions }: PageProps) {
  const { config } = data
  const { patch, run } = actions
  const paused = isAiPaused(config.pauseAiUntil)
  return (
    <Page title="Privacy" description="Your mail, tasks and models stay on this Mac. There is no AmbientMind server and no account.">
      <Group title="Pause AI" footer="While paused nothing reads your mail or screen. Recurring tasks and snoozes still work. Also in the menu bar.">
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
              <Button size="sm" onClick={() => void patch({ pauseAiUntil: PAUSE_UNTIL_RESUMED })}>
                Until I resume
              </Button>
            </>
          )}
        </Row>
      </Group>

      <Group title="Where your data goes">
        <Row
          label="Stays on this Mac"
          description="Tasks, the mail text that was read, chat, decisions, logs, and every model that reads them."
        />
        <Row
          label="Read from Google"
          description={
            config.calendarWriteBack
              ? 'Gmail and Google Calendar, with your sign-in, straight from Google. Recurring tasks are written to an AmbientMind calendar there.'
              : 'Gmail and Google Calendar, with your sign-in, straight from Google. Nothing is written back.'
          }
        />
        <Row
          label="Downloaded once"
          description="Voice and text-recognition models from Hugging Face and jsDelivr, the first time they’re needed. Nothing about you is sent."
        />
      </Group>

      <NetworkActivity actions={actions} />

      <Group title="Screen and windows">
        <Row
          label="Hide from screen sharing"
          description="AmbientMind’s windows show up blank in screenshots, recordings and shared screens."
        >
          <Toggle label="Hide from screen sharing" checked={config.contentProtection} onChange={(on) => void patch({ contentProtection: on })} />
        </Row>
        <Row
          label="Quiet during calls and full screen"
          description="The orb steps aside and sync notifications wait while another app uses the mic or fills the screen."
        >
          <Toggle label="Quiet during calls and full screen" checked={config.quietMode} onChange={(on) => void patch({ quietMode: on })} />
        </Row>
      </Group>

      <Group>
        <Row label="Crash log" description="Written on this Mac when something goes wrong. Never sent anywhere.">
          <Button
            size="sm"
            onClick={() =>
              void run('Opening…', async () => ((await window.ambient.openCrashLog()) ? undefined : 'Nothing has crashed.'))
            }
          >
            Open
          </Button>
        </Row>
      </Group>
    </Page>
  )
}
