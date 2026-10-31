import { createContext, useContext, useSyncExternalStore } from 'react'
import { sim } from './engine/sim'

export function useSim() {
  return useSyncExternalStore(sim.subscribe, sim.getSnapshot)
}

export type View = 'overview' | 'holdings' | 'activity' | 'guardrails' | 'replay' | 'whatif' | 'settings'

export const VIEWS: View[] = ['overview', 'holdings', 'activity', 'guardrails', 'replay', 'whatif', 'settings']

/** Plain #name hash routing, so links work inside a sandboxed frame too. */
export function viewFromHash(): View {
  const h = window.location.hash.replace(/^#\/?/, '') as View
  return VIEWS.includes(h) ? h : 'overview'
}

export interface UI {
  /** activity item hovered in the feed or on the chart; both highlight together */
  hovered: string | null
  setHovered: (id: string | null) => void
  /** activity item whose explanation is open */
  expanded: string | null
  setExpanded: (id: string | null) => void
  /** live preview of a guardrail being edited, drawn on the chart before it is saved */
  preview: { dailyLoss?: number; maxDrawdown?: number }
  setPreview: (p: { dailyLoss?: number; maxDrawdown?: number }) => void
  openVoice: (question?: string) => void
  view: View
  setView: (v: View) => void
}

export const UIContext = createContext<UI | null>(null)

export function useUI() {
  const ui = useContext(UIContext)
  if (!ui) throw new Error('UIContext missing')
  return ui
}
