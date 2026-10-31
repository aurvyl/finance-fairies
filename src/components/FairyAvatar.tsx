import { useEffect, useRef, useState, type CSSProperties } from 'react'

/**
 * The fairy wings from the logo, drawn as lines so they can move.
 * Shapes are drawn once for the left side and mirrored, in a 120 × 80 box with the body at x = 60.
 */
const UP = 'M57 46C53 37 44 21 8 8C16 13 17 24 21 32C26 41 38 45 57 46Z'
const UP_VEIN = 'M57 46C46 41 34 33 27 19'
const UP_FOLD = 'M15 15C20 24 27 29 37 31'
const LO = 'M57 46.5C47 45.5 37 47 31 55C27 62 24 68 18 72C30 70 40 66 46 60C51 54 53 49 57 46.5Z'
const LO_VEIN = 'M57 46.5C47 50 39 57 32 66'
const BODY = 'M60 38.5C62.6 41.2 63.2 44 63.2 46C63.2 48.6 61.8 50.4 60 52.5C58.2 50.4 56.8 48.6 56.8 46C56.8 44 57.4 41.2 60 38.5Z'

export type FairyState = 'idle' | 'listening' | 'thinking' | 'speaking'

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function Wing({ lines = true }: { lines?: boolean }) {
  return (
    <>
      <g className="fw-flap fw-up">
        <path className="fw-shape" d={UP} pathLength={1} />
        {lines && <path className="fw-vein" d={UP_VEIN} pathLength={1} />}
        {lines && <path className="fw-vein" d={UP_FOLD} pathLength={1} />}
        <path className="fw-trace" d={UP} pathLength={1} />
      </g>
      <g className="fw-flap fw-lo">
        <path className="fw-shape" d={LO} pathLength={1} />
        {lines && <path className="fw-vein" d={LO_VEIN} pathLength={1} />}
        <path className="fw-trace" d={LO} pathLength={1} />
      </g>
    </>
  )
}

function Spark({ x, y, i }: { x: number; y: number; i: number }) {
  return <path className="fw-spark" style={{ '--i': i } as CSSProperties} d={`M${x} ${y - 4}Q${x} ${y} ${x + 4} ${y}Q${x} ${y} ${x} ${y + 4}Q${x} ${y} ${x - 4} ${y}Q${x} ${y} ${x} ${y - 4}Z`} />
}

/**
 * Animated line-drawing fairy used as the agent's avatar.
 * - idle: slow breathing flutter
 * - listening: wings open with the microphone level (`level`, 0–1)
 * - thinking: light runs round the wing outlines, sparks twinkle
 * - speaking: a wing beat on every spoken word (`beat` changes per word)
 * - `react` (a counter) or a tap / hover makes it hop and flutter
 * Reduced motion keeps every state readable through colour and glow, with no movement.
 */
export function FairyAvatar({
  state = 'idle',
  size = 40,
  level = 0,
  beat,
  react = 0,
  still = false,
  label,
  className = '',
}: {
  state?: FairyState
  size?: number
  level?: number
  beat?: number
  react?: number
  still?: boolean
  label?: string
  className?: string
}) {
  const root = useRef<HTMLSpanElement>(null)
  const [hop, setHop] = useState(0)

  const pop = () => {
    if (still || reduced()) return
    setHop((h) => h + 1)
  }

  useEffect(() => {
    if (react) pop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [react])

  // restart the hop animation every time it is asked for
  useEffect(() => {
    if (!hop || !root.current) return
    const el = root.current
    el.classList.remove('fw-react')
    void el.getBoundingClientRect()
    el.classList.add('fw-react')
    const t = window.setTimeout(() => el.classList.remove('fw-react'), 950)
    return () => window.clearTimeout(t)
  }, [hop])

  // one quick wing beat per spoken word
  useEffect(() => {
    if (state !== 'speaking' || beat === undefined || still || reduced() || !root.current) return
    const flick = [{ transform: 'none' }, { transform: 'scale(.8, .96) rotate(5deg)' }, { transform: 'none' }]
    root.current.querySelectorAll<SVGGElement>('.fw-beat').forEach((g, i) => g.animate(flick, { duration: 240, delay: i % 2 ? 30 : 0, easing: 'ease-out' }))
    root.current.querySelector<SVGPathElement>('.fw-body')?.animate([{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }], { duration: 240 })
  }, [beat, state, still])

  return (
    <span
      ref={root}
      className={`fairy fw-${state} ${still ? 'fw-still' : ''} ${className}`}
      style={{ '--fw-size': `${size}px`, '--level': Math.min(1, Math.max(0, level)) } as CSSProperties}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      onPointerEnter={pop}
      onPointerDown={pop}
    >
      <svg viewBox="0 0 120 80" width={size} height={(size * 80) / 120} overflow="visible">
        <g className="fw-bob">
          <g className="fw-side fw-left">
            <g className="fw-beat">
              <Wing lines={size >= 28} />
            </g>
          </g>
          <g transform="matrix(-1 0 0 1 120 0)">
            <g className="fw-side fw-right">
              <g className="fw-beat">
                <Wing lines={size >= 28} />
              </g>
            </g>
          </g>
          <path className="fw-body" d={BODY} />
          <Spark x={14} y={50} i={0} />
          <Spark x={104} y={58} i={1} />
          <Spark x={92} y={6} i={2} />
          <Spark x={30} y={2} i={3} />
        </g>
      </svg>
    </span>
  )
}

/** The filled logo mark, for the brand and anywhere the fairy sits still. */
export function FairyMark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 120 80" width={size} height={(size * 80) / 120} aria-hidden className="mark fairy-mark">
      <defs>
        <linearGradient id="fm-wing" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1fb3bd" />
          <stop offset=".55" stopColor="#9fe3e6" />
          <stop offset="1" stopColor="#2bb5bf" />
        </linearGradient>
      </defs>
      {[undefined, 'matrix(-1 0 0 1 120 0)'].map((t) => (
        <g key={t ?? 'l'} transform={t} fill="url(#fm-wing)" stroke="#16a3ad" strokeWidth="1.6" strokeLinejoin="round">
          <path d={UP} />
          <path d={LO} />
        </g>
      ))}
      <path d={BODY} fill="#0e8f99" />
    </svg>
  )
}
