import { useCallback, useEffect, useState } from 'react'
import {
  ABOUT_ME_MAX_CHARS,
  WHISPER_MODELS,
  type Config,
  type HealthReport,
  type OverlayCorner,
  type RecurrenceSuggestion,
  type SyncSummary
} from '@shared/types'
import type { RecurrenceRule } from '@shared/recurrence'
import { CAPTURE_SCREEN_SHORTCUT, CHAT_SHORTCUT, QUICK_ADD_SHORTCUT } from '@shared/ipc'
import { Recurring } from './Recurring'

const CORNERS: { id: OverlayCorner; label: string }[] = [
  { id: 'top-right', label: 'Top right' },
  { id: 'top-left', label: 'Top left' },
  { id: 'bottom-right', label: 'Bottom right' },
  { id: 'bottom-left', label: 'Bottom left' }
]

const INTERVALS: Config['syncIntervalMinutes'][] = [5, 15, 30, 60]

interface AccountStatus {
  google: boolean
  googleEmail: string | null
  credentialsConfigured: boolean
}

function shortcutLabel(accelerator: string) {
  return accelerator.replace('CommandOrControl', 'Ctrl').replace('Shift', 'Shift')
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms)) return 'never'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function App() {
  const [config, setConfig] = useState<Config | null>(null)
  const [account, setAccount] = useState<AccountStatus | null>(null)
  const [ragCount, setRagCount] = useState(0)
  const [health, setHealth] = useState<HealthReport | null>(null)
  const [sync, setSync] = useState<SyncSummary | null>(null)
  const [rules, setRules] = useState<RecurrenceRule[]>([])
  const [suggestions, setSuggestions] = useState<RecurrenceSuggestion[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [nextConfig, nextAccount, nextRag, nextHealth, nextSync, nextRules, nextSuggestions] =
      await Promise.all([
        window.ambient.getConfig(),
        window.ambient.accounts.status(),
        window.ambient.getRagCount(),
        window.ambient.getHealth(),
        window.ambient.getSyncSummary(),
        window.ambient.rules.list(),
        window.ambient.rules.suggestions()
      ])
    setConfig(nextConfig)
    setAccount(nextAccount)
    setRagCount(nextRag)
    setHealth(nextHealth)
    setSync(nextSync)
    setRules(nextRules)
    setSuggestions(nextSuggestions)
  }, [])

  useEffect(() => {
    void refresh()
    return window.ambient.onConfigChanged((next) => setConfig(next))
  }, [refresh])

  const patch = async (partial: Partial<Config>) => {
    const next = await window.ambient.setConfig(partial)
    setConfig(next)
  }

  const connect = async () => {
    setBusy('Connecting Google…')
    setNotice(null)
    try {
      await window.ambient.accounts.connect()
      await refresh()
      setNotice('Google connected. First sync may take a minute.')
    } catch (err) {
      setNotice((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const disconnect = async () => {
    setBusy('Disconnecting…')
    try {
      await window.ambient.accounts.disconnect()
      await refresh()
    } catch (err) {
      setNotice((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const exportCorpus = async () => {
    setBusy('Reading your mail… this takes a few minutes.')
    setNotice(null)
    try {
      const result = await window.ambient.exportCorpus()
      setNotice(
        `Wrote ${result.messages} messages (${result.prefilledTasks} draft tasks) to ${result.path}`
      )
    } catch (err) {
      setNotice((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const syncNow = async () => {
    setBusy('Syncing…')
    setNotice(null)
    try {
      const report = await window.ambient.syncNow()
      const errors = report.errors?.length ? ` (${report.errors[0]})` : ''
      setNotice(`Scanned ${report.scanned}, added ${report.added}${errors}`)
      await refresh()
    } catch (err) {
      setNotice((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!config || !account) {
    return <p className="p-6 text-sm text-white/50">Loading…</p>
  }

  return (
    <div className="flex min-h-full flex-col gap-6 bg-[#141414] p-6 text-white">
      <header>
        <h1 className="text-lg font-medium">Settings</h1>
        <p className="mt-1 text-xs text-white/45">Changes apply immediately. Nothing is uploaded.</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-[11px] font-medium tracking-[0.16em] text-white/40 uppercase">
          Status
        </h2>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm">
              {health?.ok ? 'Everything needed is available.' : 'Something needs attention.'}
            </p>
            <button type="button" className={btnGhost} onClick={() => void refresh()}>
              Re-check
            </button>
          </div>

          <ul className="mt-3 flex flex-col gap-1.5 text-[12px]">
            <li className={health?.ollama.running ? okClass : badClass}>
              Ollama {health?.ollama.running ? 'running' : 'not reachable'}{' '}
              <span className="text-white/35">{health?.ollama.url}</span>
            </li>
            {health?.models.map((model) => (
              <li key={model.name} className={model.present ? okClass : badClass}>
                {model.role === 'extraction' ? 'Extraction model' : 'Embedding model'}{' '}
                <span className="text-white/70">{model.name}</span>{' '}
                {model.present ? 'pulled' : 'missing'}
              </li>
            ))}
          </ul>

          {health && health.problems.length > 0 && (
            <div className="mt-3 flex flex-col gap-1 border-t border-white/10 pt-3">
              {health.problems.map((problem) => (
                <p key={problem} className="text-[12px] leading-relaxed text-urgency-approaching">
                  {problem}
                </p>
              ))}
            </div>
          )}

          <p className="mt-3 border-t border-white/10 pt-3 text-[12px] text-white/50">
            Last sync {relativeTime(sync?.lastRun ?? null)}
            {sync?.lastReport
              ? ` · scanned ${sync.lastReport.scanned}, added ${sync.lastReport.added}`
              : ''}
          </p>
          {sync?.lastError && (
            <p className="mt-1 text-[12px] text-urgency-overdue">{sync.lastError}</p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[11px] font-medium tracking-[0.16em] text-white/40 uppercase">
          Google
        </h2>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm">
            {account.google
              ? `Connected as ${account.googleEmail ?? 'your account'}`
              : 'Not connected'}
          </p>
          {!account.credentialsConfigured && (
            <p className="mt-2 text-xs leading-relaxed text-white/50">
              Drop a Desktop OAuth client JSON into the app data folder as{' '}
              <code className="text-white/70">google-credentials.json</code>, then connect. See
              docs/google-setup.md.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {account.google ? (
              <>
                <button type="button" className={btnClass} onClick={() => void syncNow()} disabled={!!busy}>
                  Sync now
                </button>
                <button type="button" className={btnGhost} onClick={() => void disconnect()} disabled={!!busy}>
                  Disconnect
                </button>
              </>
            ) : (
              <button
                type="button"
                className={btnClass}
                onClick={() => void connect()}
                disabled={!!busy || !account.credentialsConfigured}
              >
                Connect Google
              </button>
            )}
            <button type="button" className={btnGhost} onClick={() => void window.ambient.openUserData()}>
              Open app data folder
            </button>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[11px] font-medium tracking-[0.16em] text-white/40 uppercase">
          Overlay
        </h2>
        <label className="flex flex-col gap-1 text-sm">
          Corner
          <select
            value={config.overlayCorner}
            onChange={(e) => void patch({ overlayCorner: e.target.value as OverlayCorner })}
            className={selectClass}
          >
            {CORNERS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[12px] text-white/40">
          The overlay sits in that corner as a count badge. Click it to expand the
          list; use − to minimize it again.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          Tasks shown
          <input
            type="number"
            min={3}
            max={20}
            value={config.maxTasksVisible}
            onChange={(e) => void patch({ maxTasksVisible: Number(e.target.value) })}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Sync every
          <select
            value={config.syncIntervalMinutes}
            onChange={(e) =>
              void patch({
                syncIntervalMinutes: Number(e.target.value) as Config['syncIntervalMinutes']
              })
            }
            className={selectClass}
          >
            {INTERVALS.map((n) => (
              <option key={n} value={n}>
                {n} minutes
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[11px] font-medium tracking-[0.16em] text-white/40 uppercase">
          About you
        </h2>
        <label className="flex flex-col gap-1 text-sm">
          What your mail calls you
          <input
            value={config.displayName}
            placeholder="Suraj"
            onChange={(e) => void patch({ displayName: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Context for the model
          <textarea
            rows={5}
            value={config.aboutMe}
            maxLength={ABOUT_ME_MAX_CHARS}
            placeholder={'College until 4pm on weekdays.\nTuition is non-negotiable.\nI handle the fees, not my brother.'}
            onChange={(e) => void patch({ aboutMe: e.target.value })}
            className={`${inputClass} resize-y leading-relaxed`}
          />
        </label>
        <p className="text-[12px] text-white/40">
          Added to the prompt as background when reading mail and your screen. It is never
          turned into a task, and never leaves this machine. {config.aboutMe.length}/
          {ABOUT_ME_MAX_CHARS}
        </p>
      </section>

      <Recurring
        rules={rules}
        suggestions={suggestions}
        onChange={setRules}
        onSuggestionsChange={setSuggestions}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-[11px] font-medium tracking-[0.16em] text-white/40 uppercase">
          Model
        </h2>
        <label className="flex flex-col gap-1 text-sm">
          Ollama model
          <input
            value={config.ollamaModel}
            onChange={(e) => void patch({ ollamaModel: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.launchAtLogin}
            onChange={(e) => void patch({ launchAtLogin: e.target.checked })}
          />
          Start AmbientMind when I sign in to Windows
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Voice model
          <select
            value={config.whisperModel}
            onChange={(e) => void patch({ whisperModel: e.target.value })}
            className={selectClass}
          >
            {WHISPER_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[12px] text-white/40">
          Runs on the CPU, so a bigger model costs seconds, not VRAM. Changing it downloads the
          new one once, in the background.
        </p>

        <p className="text-xs text-white/40">
          RAG examples stored: {ragCount}. Similar past mail is shown to the model on the next
          sync.
        </p>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm">Measure accuracy on your own mail</p>
          <p className="mt-1 text-[12px] leading-relaxed text-white/45">
            Writes your recent mail to a JSONL file, pre-filled with what the model extracts
            today. Correct it, then run{' '}
            <code className="text-white/70">npm run eval -- --corpus &lt;file&gt;</code>. This can
            take a few minutes and never leaves the machine.
          </p>
          <button
            type="button"
            className={`${btnGhost} mt-3`}
            disabled={!!busy || !account.google}
            onClick={() => void exportCorpus()}
          >
            Export mail for labelling
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[11px] font-medium tracking-[0.16em] text-white/40 uppercase">
          Shortcuts
        </h2>
        <p className="text-sm text-white/70">
          <kbd className={kbdClass}>{shortcutLabel(QUICK_ADD_SHORTCUT)}</kbd> Quick add / voice
        </p>
        <p className="text-sm text-white/70">
          <kbd className={kbdClass}>{shortcutLabel(CAPTURE_SCREEN_SHORTCUT)}</kbd> Capture screen
          as a task
        </p>
        <p className="text-sm text-white/70">
          <kbd className={kbdClass}>{shortcutLabel(CHAT_SHORTCUT)}</kbd> Ask about your tasks
        </p>
        <p className="text-sm text-white/70">
          <kbd className={kbdClass}>Ctrl+Shift+,</kbd> Open settings
        </p>
      </section>

      {(busy || notice) && (
        <p className="text-xs text-urgency-approaching">{busy ?? notice}</p>
      )}
    </div>
  )
}

const btnClass =
  'rounded-lg bg-white/15 px-3 py-1.5 text-sm text-white hover:bg-white/25 disabled:opacity-40'
const btnGhost =
  'rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/80 hover:bg-white/10 disabled:opacity-40'
const inputClass =
  'rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white focus:outline-none'
const selectClass = inputClass
const kbdClass = 'rounded border border-white/20 px-1.5 py-0.5 text-[11px] text-white/80'
const okClass = 'text-white/60 before:mr-2 before:text-urgency-neutral before:content-["✓"]'
const badClass =
  'text-white/85 before:mr-2 before:text-urgency-overdue before:content-["✕"]'
