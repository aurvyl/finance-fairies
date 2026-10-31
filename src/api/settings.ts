import { useSyncExternalStore } from 'react'

/**
 * Where the engine lives and how to use its AI agent. The engine URL and provider are
 * remembered in this browser; an API key is held in memory for this tab only and is
 * never written to storage.
 */
export interface Settings {
  engineUrl: string
  useAgent: boolean
  provider: string
  readAloud: boolean
  /** let the agent read today's news (What-if only; never used for replays) */
  liveNews: boolean
}

const KEY = 'ff.settings.v1'
const DEFAULT_URL = (import.meta.env.VITE_ENGINE_URL as string | undefined) ?? 'http://localhost:8000'

function load(): Settings {
  const base: Settings = { engineUrl: DEFAULT_URL, useAgent: false, provider: 'gemini', readAloud: true, liveNews: false }
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...base, ...JSON.parse(raw) } : base
  } catch {
    return base
  }
}

let state = load()
let llmKey = ''
const subs = new Set<() => void>()

export function getSettings() {
  return state
}

export function setSettings(next: Partial<Settings>) {
  state = { ...state, ...next }
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* storage can be unavailable (private mode, sandboxed frames); settings still apply to this tab */
  }
  subs.forEach((f) => f())
}

export function getLlmKey() {
  return llmKey
}

export function setLlmKey(k: string) {
  llmKey = k
  subs.forEach((f) => f())
}

const subscribe = (f: () => void) => {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}

export function useSettings() {
  return useSyncExternalStore(subscribe, getSettings)
}

export function useHasLlmKey() {
  return useSyncExternalStore(subscribe, () => llmKey.length > 0)
}
