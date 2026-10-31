import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { engine, EngineError } from './client'
import { useSettings } from './settings'
import type { Health } from './types'

export type Connection = { state: 'checking' } | { state: 'online'; health: Health } | { state: 'offline'; error: string }

let conn: Connection = { state: 'checking' }
const subs = new Set<() => void>()
const set = (c: Connection) => {
  conn = c
  subs.forEach((f) => f())
}
let inflight: Promise<void> | null = null

export const getConnection = () => conn

/** Check the engine once; callers share the result. */
export function checkEngine() {
  inflight ??= engine
    .health()
    .then((health) => set({ state: 'online', health }))
    .catch((e: EngineError) => set({ state: 'offline', error: e.message }))
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function useConnection() {
  const settings = useSettings()
  const c = useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => {
        subs.delete(f)
      }
    },
    () => conn,
  )
  useEffect(() => {
    set({ state: 'checking' })
    void checkEngine()
    // re-check quietly while offline, so starting the engine is picked up without a reload
    const id = window.setInterval(() => conn.state === 'offline' && void checkEngine(), 15_000)
    return () => window.clearInterval(id)
  }, [settings.engineUrl])
  return c
}

export type Load<T> = { status: 'idle' } | { status: 'loading' } | { status: 'done'; data: T } | { status: 'error'; error: string }

/** Run an engine request on demand; keeps only the latest answer. */
export function useRequest<A extends unknown[], T>(fn: (...a: A) => Promise<T>) {
  const [s, setS] = useState<Load<T>>({ status: 'idle' })
  const seq = useRef(0)
  const run = useCallback(
    async (...a: A) => {
      const n = ++seq.current
      setS({ status: 'loading' })
      try {
        const data = await fn(...a)
        if (n === seq.current) setS({ status: 'done', data })
      } catch (e) {
        if (n === seq.current) setS({ status: 'error', error: (e as Error).message })
      }
    },
    [fn],
  )
  return [s, run, setS] as const
}
