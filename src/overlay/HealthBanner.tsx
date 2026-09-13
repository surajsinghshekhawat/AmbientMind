import type { HealthReport } from '@shared/types'

interface Props {
  health: HealthReport
  connecting: boolean
  onConnectGoogle: () => void
  onRecheck: () => void
}

/**
 * An empty list has several very different causes. Saying which one it is
 * beats an unexplained blank panel.
 */
export function HealthBanner({ health, connecting, onConnectGoogle, onRecheck }: Props) {
  const canConnect = health.google.credentialsConfigured && !health.google.connected
  const [first] = health.problems

  return (
    <div className="mx-2 rounded-lg border border-urgency-approaching/40 bg-black/50 px-3 py-2.5">
      <p className="text-[12px] leading-relaxed text-white/85">{first}</p>
      {health.problems.length > 1 && (
        <p className="mt-1 text-[11px] text-white/45">
          +{health.problems.length - 1} more in Settings
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {canConnect && (
          <button
            type="button"
            onClick={onConnectGoogle}
            disabled={connecting}
            className="rounded-md bg-white/15 px-2.5 py-1 text-[11px] text-white hover:bg-white/25 disabled:opacity-50"
          >
            {connecting ? 'Opening Google…' : 'Connect Google'}
          </button>
        )}
        <button
          type="button"
          onClick={onRecheck}
          className="rounded-md border border-white/15 px-2.5 py-1 text-[11px] text-white/75 hover:bg-white/10"
        >
          Re-check
        </button>
        <button
          type="button"
          onClick={() => window.ambient.openSettings()}
          className="rounded-md border border-white/15 px-2.5 py-1 text-[11px] text-white/75 hover:bg-white/10"
        >
          Settings
        </button>
      </div>
    </div>
  )
}
