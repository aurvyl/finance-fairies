import { useEffect, useRef, useState } from 'react'

/** Hold a fast-changing value steady for `ms` so the eye has time to read it between rolls. */
export function useSettled<T>(value: T, ms: number) {
  const [shown, setShown] = useState(value)
  const last = useRef(0)
  useEffect(() => {
    const wait = Math.max(0, last.current + ms - Date.now())
    const id = window.setTimeout(() => {
      last.current = Date.now()
      setShown(value)
    }, wait)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return shown
}

/**
 * Digits roll to their new value instead of snapping, so a ticking balance reads as
 * motion in one place rather than flicker across the whole number.
 */
export function RollingNumber({ value, className }: { value: string; className?: string }) {
  return (
    <span className={`roll ${className ?? ''}`} aria-label={value} role="text">
      {value.split('').map((ch, i) => {
        const d = ch.charCodeAt(0) - 48
        if (d < 0 || d > 9)
          return (
            <span key={i} className="roll-static" aria-hidden>
              {ch}
            </span>
          )
        return (
          <span key={i} className="roll-digit" aria-hidden>
            <span className="roll-col" style={{ transform: `translateY(${-d * 10}%)` }}>
              {'0123456789'.split('').map((n) => (
                <span key={n}>{n}</span>
              ))}
            </span>
          </span>
        )
      })}
    </span>
  )
}
