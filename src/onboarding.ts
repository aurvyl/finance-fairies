import { useSyncExternalStore } from 'react'
import { sim } from './engine/sim'
import type { Autonomy } from './engine/types'

/**
 * First-run state and the user's own rules, remembered in this browser so the limits and
 * agent mode chosen during setup (or changed later in Guardrails) survive a reload.
 */
const DONE_KEY = 'ff.onboarded.v1'
const RULES_KEY = 'ff.rules.v1'

interface SavedRules {
  dailyLoss: number
  maxDrawdown: number
  autonomy: Autonomy
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage can be unavailable (private mode, sandboxed frames); the choice still applies to this tab */
  }
}

let done = read<boolean>(DONE_KEY) === true
const subs = new Set<() => void>()
const subscribe = (f: () => void) => {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}

export function useOnboarded() {
  return useSyncExternalStore(subscribe, () => done)
}

export function setOnboarded(v: boolean) {
  done = v
  write(DONE_KEY, v)
  subs.forEach((f) => f())
}

/** Apply saved rules to the simulation, then keep saving whenever the user changes them. */
export function restoreRules() {
  const saved = read<Partial<SavedRules>>(RULES_KEY)
  if (saved) {
    const ok = (x: unknown, lo: number, hi: number) => typeof x === 'number' && x >= lo && x <= hi
    sim.restore(
      {
        ...(ok(saved.dailyLoss, 0.001, 0.2) ? { dailyLoss: saved.dailyLoss } : {}),
        ...(ok(saved.maxDrawdown, 0.01, 0.6) ? { maxDrawdown: saved.maxDrawdown } : {}),
      },
      saved.autonomy && ['auto', 'ask', 'paused'].includes(saved.autonomy) ? saved.autonomy : undefined,
    )
  }
  let last = ''
  return sim.subscribe(() => {
    const s = sim.getSnapshot()
    const next: SavedRules = { dailyLoss: s.guardrails.dailyLoss, maxDrawdown: s.guardrails.maxDrawdown, autonomy: s.autonomy }
    const key = JSON.stringify(next)
    if (key !== last) {
      last = key
      write(RULES_KEY, next)
    }
  })
}
