import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import './motion.css'

/**
 * Small motion helpers shared across the app. Everything here respects
 * prefers-reduced-motion: values jump to their target instead of travelling.
 */

const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null

const subscribe = (f: () => void) => {
  query?.addEventListener('change', f)
  return () => query?.removeEventListener('change', f)
}

export const prefersReducedMotion = () => query?.matches ?? false

export function useReducedMotion() {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false)
}

/** The product's curve, cubic-bezier(0.16, 1, 0.3, 1), as an ease-out-expo stand-in for JS tweens. */
export const easeOut = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))

/**
 * Tween a number toward `target`. Starts from `from` on mount (so a gauge sweeps up from zero
 * the first time it is seen), then follows later changes from wherever it currently is, so an
 * interrupted tween never jumps.
 */
export function useTween(target: number, { duration = 520, from }: { duration?: number; from?: number } = {}) {
  const reduced = useReducedMotion()
  const [value, setValue] = useState(() => (reduced || from === undefined ? target : from))
  const current = useRef(value)
  const frame = useRef(0)

  useEffect(() => {
    cancelAnimationFrame(frame.current)
    if (reduced || !Number.isFinite(target)) {
      current.current = target
      return
    }
    const start = current.current
    if (start === target) return
    const t0 = performance.now()
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration)
      const v = start + (target - start) * easeOut(p)
      current.current = v
      setValue(v)
      if (p < 1) frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame.current)
  }, [target, duration, reduced])

  return reduced || !Number.isFinite(target) ? target : value
}

export interface GlideBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Measure the active child of a container so a single indicator can glide between items,
 * instead of the highlight blinking from one to the next. `live` turns on after the first
 * placement so the indicator never slides in from the corner on load.
 */
export function useGlide<T extends HTMLElement>(selector: string, dep: unknown) {
  const ref = useRef<T>(null)
  const [box, setBox] = useState<GlideBox | null>(null)
  const [live, setLive] = useState(false)

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const measure = () => {
      const el = root.querySelector<HTMLElement>(selector)
      if (!el || el.offsetWidth === 0) return setBox(null)
      const r = root.getBoundingClientRect()
      const e = el.getBoundingClientRect()
      setBox({ x: e.left - r.left - root.clientLeft, y: e.top - r.top - root.clientTop, w: e.width, h: e.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    return () => ro.disconnect()
  }, [selector, dep])

  useEffect(() => {
    if (!box || live) return
    const id = requestAnimationFrame(() => setLive(true))
    return () => cancelAnimationFrame(id)
  }, [box, live])

  const style = box ? { width: box.w, height: box.h, transform: `translate(${box.x}px, ${box.y}px)` } : { opacity: 0 }
  return { ref, style, live }
}
