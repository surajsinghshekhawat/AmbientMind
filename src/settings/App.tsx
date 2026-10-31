import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import {
  Brain,
  Cable,
  Command,
  GraduationCap,
  Info,
  KeyRound,
  Mic,
  Repeat,
  Settings2,
  ShieldCheck,
  type LucideProps
} from 'lucide-react'
import type { RecurrenceRule } from '@shared/recurrence'
import type { ShortcutSet, ShortcutStatus } from '@shared/shortcuts'
import type { Config, RecurrenceSuggestion } from '@shared/types'
import { cn } from '@/ui/cn'
import { ToastProvider, ToastRegion, useToast } from '@/ui/Toast'
import { About, AiModels, Capture, General, Learned, Permissions, Privacy, Sources, type SettingsActions, type SettingsData } from './pages'
import { Recurring } from './Recurring'
import { clientOs, Shortcuts } from './Shortcuts'

export type SectionId =
  | 'general'
  | 'sources'
  | 'ai'
  | 'capture'
  | 'shortcuts'
  | 'recurring'
  | 'learned'
  | 'privacy'
  | 'permissions'
  | 'about'

const SECTIONS: { id: SectionId; label: string; icon: ComponentType<LucideProps> }[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'sources', label: 'Sources', icon: Cable },
  { id: 'ai', label: 'AI & Models', icon: Brain },
  { id: 'capture', label: 'Capture', icon: Mic },
  { id: 'shortcuts', label: 'Shortcuts', icon: Command },
  { id: 'recurring', label: 'Recurring', icon: Repeat },
  { id: 'learned', label: 'Learned', icon: GraduationCap },
  { id: 'privacy', label: 'Privacy & Data', icon: ShieldCheck },
  { id: 'permissions', label: 'Permissions', icon: KeyRound },
  { id: 'about', label: 'About', icon: Info }
]

const SAVED_DELAY_MS = 600

interface Props {
  initialSection?: SectionId | undefined
  /** Off in the gallery, where the page around it has its own theme. */
  applyTheme?: boolean
}

export function App(props: Props) {
  return (
    <ToastProvider>
      <Settings {...props} />
    </ToastProvider>
  )
}

function Settings({ initialSection = 'general', applyTheme = true }: Props) {
  const toast = useToast()
  const [section, setSection] = useState<SectionId>(initialSection)
  const [data, setData] = useState<SettingsData | null>(null)
  const [rules, setRules] = useState<RecurrenceRule[]>([])
  const [suggestions, setSuggestions] = useState<RecurrenceSuggestion[]>([])
  const [shortcuts, setShortcuts] = useState<ShortcutStatus[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    const [config, account, ragCount, health, sync, nextRules, nextSuggestions, learned, permissions, appInfo, nextShortcuts, speech] =
      await Promise.all([
        window.ambient.getConfig(),
        window.ambient.accounts.status(),
        window.ambient.getRagCount(),
        window.ambient.getHealth(),
        window.ambient.getSyncSummary(),
        window.ambient.rules.list(),
        window.ambient.rules.suggestions(),
        window.ambient.learned.list(),
        window.ambient.getPermissions(),
        window.ambient.getAppInfo(),
        window.ambient.getShortcuts(),
        window.ambient.speech.engine()
      ])
    setData({ config, account, ragCount, health, sync, learned, permissions, appInfo, speech })
    setRules(nextRules)
    setSuggestions(nextSuggestions)
    setShortcuts(nextShortcuts)
  }, [])

  useEffect(() => {
    void refresh()
    const offConfig = window.ambient.onConfigChanged((config) => setData((current) => (current ? { ...current, config } : current)))
    // Permissions change in System Settings, so check again on return.
    const onFocus = () => void window.ambient.getPermissions().then((permissions) => setData((current) => (current ? { ...current, permissions } : current)))
    window.addEventListener('focus', onFocus)
    return () => {
      offConfig()
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  useEffect(() => {
    if (data && applyTheme) document.documentElement.dataset.theme = data.config.theme
  }, [data?.config.theme, applyTheme])

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current)
  }, [])

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [section])

  const patch = useCallback(
    async (partial: Partial<Config>) => {
      const config = await window.ambient.setConfig(partial)
      setData((current) => (current ? { ...current, config } : current))
      // One toast for a burst of changes, not one per click.
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => toast.show({ message: 'Saved' }), SAVED_DELAY_MS)
    },
    [toast]
  )

  const run = useCallback(
    async (label: string, task: () => Promise<string | void>) => {
      setBusy(label)
      try {
        const message = await task()
        if (message) toast.show({ message })
      } catch (err) {
        toast.show({ message: (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), tone: 'danger' })
      } finally {
        setBusy(null)
      }
    },
    [toast]
  )

  const saveShortcuts = async (overrides: Partial<ShortcutSet>) => {
    await patch({ shortcuts: overrides })
    setShortcuts(await window.ambient.getShortcuts())
  }

  if (!data) return <div className="h-full bg-[var(--window)]" />

  const actions: SettingsActions = {
    patch,
    refresh,
    run,
    busy,
    setLearned: (learned) => setData((current) => (current ? { ...current, learned } : current))
  }

  const attention: Partial<Record<SectionId, boolean>> = {
    sources: !data.account.google || Boolean(data.sync?.lastError),
    ai: Boolean(data.health && !data.health.ok),
    shortcuts: shortcuts.some((s) => s.problem),
    recurring: suggestions.length > 0,
    permissions: data.permissions.some((p) => p.status === 'denied' || p.status === 'restricted')
  }

  const page = (() => {
    switch (section) {
      case 'general':
        return <General data={data} actions={actions} />
      case 'sources':
        return <Sources data={data} actions={actions} />
      case 'ai':
        return <AiModels data={data} actions={actions} />
      case 'capture':
        return <Capture data={data} actions={actions} />
      case 'shortcuts':
        return <Shortcuts shortcuts={shortcuts} overrides={data.config.shortcuts} onSave={saveShortcuts} />
      case 'recurring':
        return <Recurring rules={rules} suggestions={suggestions} onChange={setRules} onSuggestionsChange={setSuggestions} />
      case 'learned':
        return <Learned data={data} actions={actions} />
      case 'privacy':
        return <Privacy data={data} actions={actions} />
      case 'permissions':
        return <Permissions data={data} actions={actions} />
      case 'about':
        return <About data={data} actions={actions} />
    }
  })()

  return (
    <div className="flex h-full bg-[var(--window)] text-ink-1">
      <nav
        aria-label="Settings"
        className="flex w-[208px] shrink-0 flex-col gap-px bg-[var(--sidebar)] px-2.5 pb-3 shadow-[inset_-0.5px_0_0_var(--hairline)]"
      >
        {/* Room for the traffic lights on the Mac, and a handle to move the window. */}
        <div className={cn('shrink-0 [-webkit-app-region:drag]', clientOs === 'mac' ? 'h-[52px]' : 'h-3')} />
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={section === id ? 'page' : undefined}
            onClick={() => setSection(id)}
            className={cn(
              'focus-ring flex h-8 items-center gap-2.5 rounded-control px-2.5 text-left text-body transition-colors duration-100',
              section === id ? 'bg-fill-2 font-medium text-ink-1' : 'text-ink-2 hover:bg-fill hover:text-ink-1'
            )}
          >
            <Icon className={cn('size-[15px] shrink-0 stroke-[1.75]', section === id ? 'text-accent' : 'text-ink-3')} />
            <span className="flex-1 truncate">{label}</span>
            {attention[id] && <span aria-label="Needs attention" className="size-1.5 rounded-full bg-warning" />}
          </button>
        ))}
        {busy && <p className="mt-auto px-2.5 text-small text-ink-3 shimmer">{busy}</p>}
      </nav>

      <main className="relative flex min-w-0 flex-1 flex-col">
        {clientOs === 'mac' && <div className="h-6 shrink-0 [-webkit-app-region:drag]" />}
        <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto">
          {page}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-8">
          <ToastRegion className="pointer-events-auto w-full max-w-[400px] [&>div]:bg-[var(--sidebar)] [&>div]:shadow-[0_6px_24px_oklch(0_0_0/0.25),inset_0_0_0_0.5px_var(--hairline-2)]" />
        </div>
      </main>
    </div>
  )
}
