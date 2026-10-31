import { ThinkingOrb } from 'thinking-orbs'
import type { OrbLook } from '@shared/orb'
import { cn } from './cn'

const ARC_COLOR = {
  approaching: 'var(--soon)',
  urgent: 'var(--warning)',
  overdue: 'var(--danger)'
} as const

interface Props {
  look: OrbLook
  /** Disc diameter in CSS px. */
  size?: number
  /** Bare: no disc, for use inside the panel header. */
  bare?: boolean
}

/**
 * The orb is drawn at the library's tuned 64 px and scaled down, which keeps
 * the hand-tuned dot density instead of the interpolated 32 px preset.
 */
function Dots({ look, px }: { look: OrbLook; px: number }) {
  return (
    <span className="pointer-events-none relative block" style={{ width: px, height: px }}>
      <ThinkingOrb
        state={look.motion}
        size={64}
        theme="dark"
        speed={look.calm ? 0.55 : 1}
        aria-hidden
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: `translate(-50%, -50%) scale(${px / 64})`,
          opacity: look.calm ? 0.78 : 1,
          transition: 'opacity .4s var(--ease-out)'
        }}
      />
    </span>
  )
}

export function Orb({ look, size = 48, bare }: Props) {
  const inner = Math.round(size * 0.86)
  if (bare) return <Dots look={look} px={inner} />

  const r = size / 2 + 3
  const box = size + 8
  const circumference = 2 * Math.PI * r
  const arcLength = circumference / 3

  return (
    <span className="relative grid place-items-center" style={{ width: box, height: box }}>
      <span
        className="grid place-items-center rounded-full bg-glass shadow-[inset_0_0_0_0.5px_var(--hairline-2),0_0_0_0.5px_var(--edge)]"
        style={{ width: size, height: size }}
      >
        <Dots look={look} px={inner} />
      </span>
      {look.arc && (
        <svg
          aria-hidden
          className={cn('pointer-events-none absolute inset-0', look.arc === 'overdue' && 'animate-[arc-pulse_2.4s_ease-in-out_infinite]')}
          viewBox={`0 0 ${box} ${box}`}
        >
          <circle
            cx={box / 2}
            cy={box / 2}
            r={r}
            fill="none"
            stroke={ARC_COLOR[look.arc]}
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${circumference}`}
            transform={`rotate(${-90 - 60} ${box / 2} ${box / 2})`}
          />
        </svg>
      )}
      {look.badge !== null && (
        <span
          className={cn(
            'tabular absolute top-0 right-0 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] leading-none font-semibold shadow-[0_0_0_1.5px_oklch(0.16_0.005_286)]',
            look.arc === 'overdue' ? 'bg-danger text-white' : 'bg-ink-1 text-black'
          )}
        >
          {look.badge > 9 ? '9+' : look.badge}
        </span>
      )}
      {look.attention && (
        <span className="absolute right-1 bottom-1 size-2 rounded-full bg-warning shadow-[0_0_0_1.5px_oklch(0.16_0.005_286)]" />
      )}
    </span>
  )
}
