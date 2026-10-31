import { Check, KeyRound, Plug, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { engine } from '../api/client'
import { getSettings, setLlmKey, setSettings, useHasLlmKey, useSettings } from '../api/settings'
import type { Provider } from '../api/types'
import { checkEngine, useConnection } from '../api/useEngine'
import { canListen, canSpeak } from '../voice'

export function SettingsView() {
  const settings = useSettings()
  const conn = useConnection()
  const hasKey = useHasLlmKey()
  const [url, setUrl] = useState(settings.engineUrl)
  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [key, setKey] = useState('')

  useEffect(() => {
    if (conn.state !== 'online') return
    engine
      .providers()
      .then((p) => setProviders(p.providers))
      .catch(() => setProviders(null))
  }, [conn.state])

  const current = providers?.find((p) => p.id === settings.provider)

  return (
    <div className="grid two">
      <section className="panel" aria-labelledby="eng-h">
        <header className="panel-head">
          <h2 id="eng-h">Guardian engine</h2>
          <span className={`conn conn-${conn.state}`}>
            <span className="status-dot" aria-hidden />
            {conn.state === 'online' ? 'Connected' : conn.state === 'checking' ? 'Checking…' : 'Not connected'}
          </span>
        </header>
        <p className="lede">The engine computes every number for replays and what-if scenarios. Without it, Overview runs on built-in demo data and Replay shows a saved run.</p>
        <form
          className="url-form"
          onSubmit={(e) => {
            e.preventDefault()
            const clean = url.trim().replace(/\/+$/, '')
            if (clean === getSettings().engineUrl) void checkEngine()
            else setSettings({ engineUrl: clean })
          }}
        >
          <label className="field grow">
            <span>Engine address</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} inputMode="url" placeholder="http://localhost:8000" />
          </label>
          <button className="btn ghost" disabled={conn.state === 'checking'}>
            {conn.state === 'checking' ? <RefreshCw size={15} className="spin" aria-hidden /> : <Plug size={15} aria-hidden />}
            {url.trim().replace(/\/+$/, '') === settings.engineUrl ? 'Test connection' : 'Connect'}
          </button>
        </form>
        {conn.state === 'offline' && (
          <div className="notice">
            <p>
              <strong>{conn.error}</strong> Start it from the repository, then press Test connection:
            </p>
            <pre className="cmd">
              <code>cd engine && uv run --project . uvicorn guardian.api:app --port 8000</code>
            </pre>
          </div>
        )}
        {conn.state === 'online' && (
          <p className="notice ok">
            <Check size={14} aria-hidden /> Connected. All engine results are simulated; no real trades are placed.
          </p>
        )}
      </section>

      <section className="panel" aria-labelledby="ai-h">
        <header className="panel-head">
          <h2 id="ai-h">AI agent</h2>
        </header>
        <p className="lede">When on, an AI model proposes a plan at every limit check. The engine re-checks it with the same rules as its own plan and keeps whichever is safer.</p>
        <label className="toggle">
          <input type="checkbox" checked={settings.useAgent} onChange={(e) => setSettings({ useAgent: e.target.checked })} />
          <span className="toggle-ui" aria-hidden />
          Let the AI agent propose plans in replays and what-ifs
        </label>

        <fieldset className="providers" disabled={!settings.useAgent}>
          <legend>Model provider</legend>
          {(providers ?? [{ id: 'gemini', label: 'Gemini', default_model: '', features: [], key_configured: false, recommended: true }]).map((p) => (
            <label key={p.id} className={`provider ${settings.provider === p.id ? 'on' : ''}`}>
              <input type="radio" name="provider" value={p.id} checked={settings.provider === p.id} onChange={() => setSettings({ provider: p.id })} />
              <span className="provider-name">
                {p.label}
                {p.recommended && <span className="badge">Recommended</span>}
              </span>
              <span className="provider-meta">
                {p.default_model}
                {providers && (p.key_configured ? ' · key on server' : ' · no key on server')}
              </span>
            </label>
          ))}
          {!providers && <p className="muted small">Connect the engine to see every provider and which have keys.</p>}
        </fieldset>

        {settings.useAgent && current && !current.key_configured && (
          <form
            className="url-form"
            onSubmit={(e) => {
              e.preventDefault()
              setLlmKey(key.trim())
              setKey('')
            }}
          >
            <label className="field grow">
              <span>{current.label} API key for this tab</span>
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" placeholder={hasKey ? 'Key set for this tab' : 'Paste a key'} />
            </label>
            <button className="btn ghost" disabled={!key.trim()}>
              <KeyRound size={15} aria-hidden /> Use key
            </button>
          </form>
        )}
        {hasKey && (
          <p className="muted small">
            A key is set for this tab only. It’s sent with each engine request and never saved.{' '}
            <button className="link" onClick={() => setLlmKey('')}>
              Forget it
            </button>
          </p>
        )}
      </section>

      <section className="panel" aria-labelledby="voice-h">
        <header className="panel-head">
          <h2 id="voice-h">Voice</h2>
        </header>
        <label className="toggle">
          <input type="checkbox" checked={settings.readAloud} disabled={!canSpeak} onChange={(e) => setSettings({ readAloud: e.target.checked })} />
          <span className="toggle-ui" aria-hidden />
          Read answers aloud
        </label>
        <p className="muted small">
          {canListen ? 'Hold the mic button, or hold Space, to talk to your fairy.' : 'This browser can’t listen, so you’ll type questions. Chrome, Edge and Safari support talking.'}
          {!canSpeak && ' This browser can’t read answers aloud.'}
        </p>
      </section>
    </div>
  )
}
