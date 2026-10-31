import { Activity as ActivityIcon, FlaskConical, History, LayoutDashboard, Mic, Settings, ShieldCheck, Table2, TrendingDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useConnection } from './api/useEngine'
import { Activity } from './components/Activity'
import { Allocation } from './components/Allocation'
import { EngineThresholds } from './components/EngineThresholds'
import { Guardrails } from './components/Guardrails'
import { Holdings } from './components/Holdings'
import { PortfolioChart, type Period } from './components/PortfolioChart'
import { ReplayView } from './components/ReplayView'
import { RollingNumber, useSettled } from './components/RollingNumber'
import { SettingsView } from './components/SettingsView'
import { VoicePanel } from './components/VoicePanel'
import { WhatIfView } from './components/WhatIfView'
import { compactMoney, money, pct } from './engine/format'
import { sim } from './engine/sim'
import type { Snapshot } from './engine/types'
import { UIContext, useSim, viewFromHash, type UI, type View } from './store'

function Mark() {
  // a load line: the circle-and-bar mark painted on a hull to show how low it may safely sit
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden className="mark">
      <circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
      <line x1="2" x2="30" y1="16" y2="16" stroke="var(--limit-on-ink)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M10 9.5c2-3 4-4 6-4s4 1 6 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".7" />
    </svg>
  )
}

const NAV: { id: View; label: string; icon: typeof LayoutDashboard; title?: string; group?: 'engine' | 'end' }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'holdings', label: 'Holdings', icon: Table2 },
  { id: 'activity', label: 'Activity', icon: ActivityIcon },
  { id: 'guardrails', label: 'Guardrails', icon: ShieldCheck },
  { id: 'replay', label: 'Replay', icon: History, title: 'Replay a past period', group: 'engine' },
  { id: 'whatif', label: 'What-if', icon: FlaskConical, title: 'Test a market shock', group: 'engine' },
  { id: 'settings', label: 'Settings', icon: Settings, group: 'end' },
]

function TopSettings({ onOpen }: { onOpen: () => void }) {
  const conn = useConnection()
  return (
    <button className={`icon-btn top-settings conn-${conn.state}`} onClick={onOpen} aria-label={`Settings, engine ${conn.state === 'online' ? 'connected' : 'not connected'}`}>
      <Settings size={18} aria-hidden />
      <span className="status-dot" aria-hidden />
    </button>
  )
}

/** Views that run on the in-browser demo, so the demo controls and tag apply to them. */
const DEMO_VIEWS: View[] = ['overview', 'holdings', 'activity', 'guardrails']

function EngineStatus({ onOpen }: { onOpen: () => void }) {
  const conn = useConnection()
  const label = conn.state === 'online' ? 'Engine connected' : conn.state === 'checking' ? 'Checking engine…' : 'Engine offline'
  return (
    <button className={`engine-status conn-${conn.state}`} onClick={onOpen} title={conn.state === 'offline' ? conn.error : undefined}>
      <span className="status-dot" aria-hidden />
      {label}
    </button>
  )
}

function Rail({ s, view, setView }: { s: Snapshot; view: View; setView: (v: View) => void }) {
  const pending = s.activity.filter((a) => a.pending).length
  const watch = { auto: 'On watch', ask: 'Asking first', paused: 'Paused' }[s.autonomy]
  return (
    <nav className="rail" aria-label="Main">
      <div className="brand">
        <Mark />
        <span>Finance Fairies</span>
      </div>
      <ul className="nav">
        {NAV.map((n, i) => (
          <li key={n.id} className={n.group && n.group !== NAV[i - 1]?.group ? `nav-${n.group}` : undefined}>
            <button title={n.title} aria-current={view === n.id ? 'page' : undefined} onClick={() => setView(n.id)}>
              <n.icon size={18} aria-hidden />
              <span>{n.label}</span>
              {n.id === 'activity' && pending > 0 && <span className="nav-badge">{pending}</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className={`watch mode-${s.autonomy}`}>
        <span className="watch-dot" aria-hidden />
        <div>
          <strong>{watch}</strong>
          <span>
            {s.holdings.length} positions · {pct(s.guardrails.dailyLoss, 1, false)} a day · {pct(s.guardrails.maxDrawdown, 0, false)} max
          </span>
        </div>
      </div>
      <EngineStatus onOpen={() => setView('settings')} />
    </nav>
  )
}

function Headline({ s, period, setPeriod }: { s: Snapshot; period: Period; setPeriod: (p: Period) => void }) {
  const base = period === '1D' ? s.open : s.daily[Math.max(0, s.daily.length - { '1W': 5, '1M': 21, '3M': 63, '1Y': 252 }[period as '1W'])]?.v
  const change = s.value - base
  const up = change >= 0
  return (
    <div className="headline">
      <div>
        <p className="label">Portfolio value</p>
        <RollingNumber value={useSettled(money(s.value), 2000)} className="value" />
        <p className={`delta ${up ? 'up' : 'down'}`}>
          {pct(change / base)} <span>{compactMoney(change)}</span>
          <span className="delta-period">{period === '1D' ? 'today' : `over ${period}`}</span>
        </p>
      </div>
      <div className="tabs" role="tablist" aria-label="Chart period">
        {(['1D', '1W', '1M', '3M', '1Y'] as Period[]).map((p) => (
          <button key={p} role="tab" aria-selected={period === p} onClick={() => setPeriod(p)}>
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

function Legend({ period }: { period: Period }) {
  return (
    <ul className="legend" aria-label="Chart key">
      <li>
        <i className="k-line" /> Portfolio
      </li>
      <li>
        <i className="k-limit" /> {period === '1D' ? 'Daily loss limit' : 'Floor from your maximum drop'}
      </li>
      {period === '1D' && (
        <li>
          <i className="k-limit dashed" /> Floor, when near
        </li>
      )}
      <li>
        <i className="k-ward" /> Agent steps in
      </li>
      <li>
        <i className="k-marker" /> Agent action
      </li>
    </ul>
  )
}

export default function App() {
  const s = useSim()
  const [view, setViewState] = useState<View>(viewFromHash)
  const [period, setPeriod] = useState<Period>('1D')
  const [hovered, setHovered] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [preview, setPreview] = useState<UI['preview']>({})
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [seed, setSeed] = useState<{ q: string; n: number } | null>(null)

  const setView = (v: View) => {
    setViewState(v)
    if (viewFromHash() !== v) window.history.pushState(null, '', v === 'overview' ? window.location.pathname + window.location.search : `#${v}`)
    document.getElementById('main')?.focus({ preventScroll: true })
    window.scrollTo({ top: 0 })
  }

  useEffect(() => {
    const onHash = () => setViewState(viewFromHash())
    window.addEventListener('hashchange', onHash)
    window.addEventListener('popstate', onHash)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('popstate', onHash)
    }
  }, [])

  useEffect(() => {
    document.title = view === 'overview' ? 'Finance Fairies' : `${NAV.find((n) => n.id === view)!.label} · Finance Fairies`
  }, [view])

  useEffect(() => {
    sim.start()
    const onVis = () => (document.hidden ? sim.stop() : sim.start())
    document.addEventListener('visibilitychange', onVis)
    return () => {
      sim.stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  const ui: UI = useMemo(
    () => ({
      hovered,
      setHovered,
      expanded,
      setExpanded,
      preview,
      setPreview,
      view,
      setView,
      openVoice: (q?: string) => {
        setVoiceOpen(true)
        if (q) setSeed((p) => ({ q, n: (p?.n ?? 0) + 1 }))
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hovered, expanded, preview, view],
  )

  const date = new Date(s.now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const time = new Date(s.now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const title = NAV.find((n) => n.id === view)!.title ?? NAV.find((n) => n.id === view)!.label
  const demo = DEMO_VIEWS.includes(view)

  return (
    <UIContext.Provider value={ui}>
      <div className="app">
        <Rail s={s} view={view} setView={setView} />
        <main className="main" id="main" tabIndex={-1}>
          <header className="top">
            <div>
              <h1>{title}</h1>
              <p className="meta">
                {demo && <span className={`live ${s.marketOpen ? 'on' : ''}`} aria-hidden />}
                {date}
                {demo && (s.marketOpen ? ` · Market open, ${time}` : ' · Market closed')}
                {demo && (
                  <span className="demo-tag" title="Prices, holdings and trades are simulated">
                    Demo data
                  </span>
                )}
              </p>
            </div>
            <div className="top-actions">
              {demo && (
              <button className="btn ghost" onClick={() => sim.triggerShock()} disabled={s.shock > 0} title="Demo: start a sharp sell-off to watch the agent respond">
                <TrendingDown size={16} aria-hidden />
                {s.shock > 0 ? 'Sell-off in progress' : 'Simulate a sell-off'}
              </button>
              )}
              <TopSettings onOpen={() => setView('settings')} />
              <button className={`btn talk-btn ${voiceOpen ? 'on' : ''}`} onClick={() => setVoiceOpen((o) => !o)} aria-expanded={voiceOpen}>
                <Mic size={16} aria-hidden />
                Talk to your fairy
              </button>
            </div>
          </header>

          {view === 'overview' && (
            <div className="grid overview">
              <div className="col">
                <section className="panel hero" aria-label="Portfolio value">
                  <Headline s={s} period={period} setPeriod={setPeriod} />
                  <PortfolioChart s={s} period={period} />
                  <Legend period={period} />
                </section>
                <Activity s={s} limit={6} />
              </div>
              <div className="col">
                <Guardrails s={s} />
                <Allocation s={s} />
              </div>
              <div className="span-all">
                <Holdings s={s} compact />
              </div>
            </div>
          )}
          {view === 'holdings' && <Holdings s={s} />}
          {view === 'activity' && (
            <div className="grid two">
              <Activity s={s} />
              <section className="panel hero" aria-label="Portfolio value">
                <Headline s={s} period={period} setPeriod={setPeriod} />
                <PortfolioChart s={s} period={period} height={240} />
                <Legend period={period} />
              </section>
            </div>
          )}
          {view === 'guardrails' && (
            <div className="grid two">
              <div className="col">
                <Guardrails s={s} />
                <EngineThresholds s={s} />
              </div>
              <section className="panel hero" aria-label="Portfolio value">
                <Headline s={s} period={period} setPeriod={setPeriod} />
                <PortfolioChart s={s} period={period} />
                <Legend period={period} />
                <div className="how">
                  <h2>How the agent keeps you inside your limits</h2>
                  <p>
                    It measures the whole portfolio, not single positions. When either limit is {pct(s.guardrails.actAt, 0, false)} used, it sells a slice of the
                    positions that add the most risk per dollar and parks the money in short-dated Treasuries. At 85% it cuts deeper, and at the limit it moves most
                    risk out and stops adding risk until the next day.
                  </p>
                  <p>Every trade appears in Activity with the numbers behind it. Ask “why” by tapping, or out loud.</p>
                </div>
              </section>
            </div>
          )}
          {view === 'replay' && <ReplayView s={s} />}
          {view === 'whatif' && <WhatIfView s={s} />}
          {view === 'settings' && <SettingsView />}
        </main>
        <VoicePanel open={voiceOpen} onClose={() => setVoiceOpen(false)} seed={seed} />
      </div>
    </UIContext.Provider>
  )
}
