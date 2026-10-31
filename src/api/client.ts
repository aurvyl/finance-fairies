import { getLlmKey, getSettings } from './settings'
import type { AgentConfig, AnalyzeOut, Health, LimitsOut, PortfolioIn, Provider, ReplayOut } from './types'

export class EngineError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** Python's json can emit NaN; treat it as "no value". */
function parse<T>(text: string): T {
  return JSON.parse(text.replace(/\bNaN\b|-?\bInfinity\b/g, 'null')) as T
}

async function call<T>(path: string, init: RequestInit & { timeout?: number } = {}): Promise<T> {
  const base = getSettings().engineUrl.replace(/\/+$/, '')
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), init.timeout ?? 15_000)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const key = getLlmKey()
  if (key) headers['X-LLM-Key'] = key
  try {
    const r = await fetch(base + path, { ...init, headers, signal: ctrl.signal })
    const text = await r.text()
    if (!r.ok) {
      let detail = text
      try {
        detail = (parse<{ detail?: unknown }>(text).detail as string) ?? text
      } catch {
        /* not JSON */
      }
      throw new EngineError(typeof detail === 'string' ? detail : JSON.stringify(detail), r.status)
    }
    return parse<T>(text)
  } catch (e) {
    if (e instanceof EngineError) throw e
    if ((e as Error).name === 'AbortError') throw new EngineError('The engine took too long to answer.', 0)
    throw new EngineError('Can’t reach the engine.', 0)
  } finally {
    window.clearTimeout(timer)
  }
}

const post = <T>(path: string, body: unknown, timeout?: number) => call<T>(path, { method: 'POST', body: JSON.stringify(body), timeout })

function agent(): { agent?: AgentConfig } {
  const s = getSettings()
  return s.useAgent ? { agent: { provider: s.provider } } : {}
}

export const engine = {
  health: () => call<Health>('/health', { timeout: 4000 }),
  providers: () => call<{ default: string; providers: Provider[] }>('/providers', { timeout: 4000 }),
  limits: (p: PortfolioIn) => post<LimitsOut>('/limits', p, 8000),
  replay: (p: PortfolioIn & { start: string; end: string }) => post<ReplayOut>('/replay', { ...p, ...agent() }, agent().agent ? 180_000 : 60_000),
  analyze: (p: PortfolioIn & { date: string; inject?: Record<string, number> }) =>
    post<AnalyzeOut>('/analyze', { ...p, ...agent() }, agent().agent ? 120_000 : 30_000),
}
