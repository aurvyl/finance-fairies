import { useTween } from '../motion'

/** A number that counts toward its new value instead of snapping. Formatting is the caller's. */
export function TweenNumber({ value, format, duration, from }: { value: number; format: (v: number) => string; duration?: number; from?: number }) {
  const v = useTween(value, { duration, from })
  return (
    <span className="tween" aria-label={format(value)} role="text">
      <span aria-hidden>{format(v)}</span>
    </span>
  )
}
