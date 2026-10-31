import { Keyboard, Mic, Send, Square, Volume2, X } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { setSettings, useSettings } from '../api/settings'
import { ask } from '../engine/ask'
import { sim } from '../engine/sim'
import { useUI } from '../store'
import { canListen, canSpeak, speak, stopSpeaking, useListen, useSpeaking } from '../voice'
import { FairyAvatar } from './FairyAvatar'
import { SpokenText } from './SpokenText'

interface Turn {
  id: string
  q: string
  a?: string
  source?: 'agent' | 'claude' | 'engine'
  model?: string
}

const SUGGESTIONS = ['Why is my portfolio down today?', 'What did you just do, and why?', 'How close am I to my limits?', 'Don’t let me lose more than 3% in a day']

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it in your browser’s site settings, or type instead.',
  'no-speech': 'I didn’t catch anything. Hold the button and speak, or type below.',
  network: 'Speech recognition needs a connection right now. You can type instead.',
  allowed: 'Microphone is on. Hold the button again and ask your question.',
  unsupported: 'This browser can’t do speech recognition. Type your question instead; I can still answer out loud.',
}

let seq = 0

export function VoicePanel({ open, onClose, seed }: { open: boolean; onClose: () => void; seed: { q: string; n: number } | null }) {
  const ui = useUI()
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [thinking, setThinking] = useState(false)
  const [nudge, setNudge] = useState(0)
  const settings = useSettings()
  const voiceOn = canSpeak && settings.readAloud
  const setVoiceOn = (on: boolean) => setSettings({ readAloud: on })
  const [typing, setTyping] = useState(!canListen)
  const speaking = useSpeaking()
  const list = useRef<HTMLOListElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  const submit = async (q: string) => {
    const question = q.trim()
    if (!question) return
    const id = `t${++seq}`
    setTurns((t) => [...t, { id, q: question }])
    setNudge((n) => n + 1)
    setText('')
    setThinking(true)
    const ans = await ask(question, sim.getSnapshot())
    setThinking(false)
    setTurns((t) => t.map((x) => (x.id === id ? { ...x, a: ans.text, source: ans.source, model: ans.model } : x)))
    if (!voiceOn) setNudge((n) => n + 1)
    if (ans.focus) {
      ui.setExpanded(ans.focus)
      ui.setHovered(ans.focus)
      window.setTimeout(() => ui.setHovered(null), 2400)
    }
    if (voiceOn) speak(id, ans.text)
  }

  const listen = useListen((t) => void submit(t))

  // a question handed over from elsewhere ("Ask about this")
  useEffect(() => {
    if (seed) void submit(seed.q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.n])

  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [turns, thinking])

  useEffect(() => {
    if (!open) {
      listen.cancel()
      return
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // hold Space anywhere outside a text field to talk
  useEffect(() => {
    if (!open || !canListen) return
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName))
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isField(e.target)) return
      e.preventDefault()
      void listen.start()
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isField(e.target)) return
      e.preventDefault()
      listen.stop()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [open, listen])

  const state = listen.listening ? 'listening' : thinking ? 'thinking' : speaking.id && turns.some((t) => t.id === speaking.id) ? 'speaking' : 'idle'
  const caption = {
    listening: listen.interim || 'Listening…',
    thinking: 'Thinking it through…',
    speaking: 'Speaking. Tap to interrupt.',
    idle: canListen ? 'Hold to talk, or hold Space' : 'Type a question below',
  }[state]

  return (
    <div className={`voice ${open ? 'open' : ''} state-${state}`} ref={panel} role="dialog" aria-modal="false" aria-label="Talk to your agent" aria-hidden={!open} inert={!open}>
      <header className="voice-head">
        <div className="voice-who">
          <FairyAvatar state={state} size={52} level={listen.level} beat={speaking.charIndex} react={nudge} label={`Your fairy is ${state === 'idle' ? 'ready' : state}`} />
          <div>
            <h2>Ask your fairy</h2>
            <p className="muted">It knows your rules, positions and every trade it made.</p>
          </div>
        </div>
        <div className="voice-head-tools">
          {canSpeak && (
            <button
              className={`icon-btn ${voiceOn ? 'on' : ''}`}
              aria-pressed={voiceOn}
              aria-label={voiceOn ? 'Answers are read aloud' : 'Answers are silent'}
              title={voiceOn ? 'Read answers aloud: on' : 'Read answers aloud: off'}
              onClick={() => {
                if (voiceOn) stopSpeaking()
                setVoiceOn(!voiceOn)
              }}
            >
              <Volume2 size={16} aria-hidden />
            </button>
          )}
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>
      </header>

      <ol className="turns" ref={list} aria-live="polite">
        {turns.length === 0 && (
          <li className="suggest">
            <p className="muted">Try asking</p>
            <div className="suggest-list">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => void submit(s)}>
                  {s}
                </button>
              ))}
            </div>
          </li>
        )}
        {turns.map((t) => (
          <li key={t.id} className="turn">
            <p className="q">{t.q}</p>
            {t.a ? (
              <div className="a-row">
              <FairyAvatar size={26} state={speaking.id === t.id ? 'speaking' : 'idle'} beat={speaking.id === t.id ? speaking.charIndex : undefined} still={speaking.id !== t.id} />
              <div className="a">
                <p>{speaking.id === t.id ? <SpokenText text={t.a} charIndex={speaking.charIndex} /> : t.a}</p>
                <div className="a-meta">
                  <span>From your portfolio data</span>
                  {canSpeak && (
                    <button className="tool" onClick={() => (speaking.id === t.id ? stopSpeaking() : speak(t.id, t.a!))}>
                      {speaking.id === t.id ? <Square size={11} aria-hidden /> : <Volume2 size={13} aria-hidden />}
                      {speaking.id === t.id ? 'Stop' : 'Replay'}
                    </button>
                  )}
                </div>
              </div>
              </div>
            ) : (
              <div className="a-row">
                <FairyAvatar size={26} state="thinking" />
                <div className="a skeleton" aria-label="Thinking">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>

      <footer className="voice-foot">
        {listen.error && (
          <p className="voice-error" role="alert">
            {ERRORS[listen.error]}
          </p>
        )}
        {!typing && canListen ? (
          <div className="talk">
            <button
              className="mic"
              style={{ '--level': listen.level } as CSSProperties}
              aria-label={listen.listening ? 'Release to send' : 'Hold to talk'}
              aria-pressed={listen.listening}
              onPointerDown={(e) => {
                e.preventDefault()
                if (state === 'speaking') stopSpeaking()
                void listen.start()
              }}
              onPointerUp={() => listen.stop()}
              onPointerLeave={() => listen.listening && listen.stop()}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
                  e.preventDefault()
                  if (listen.listening) listen.stop()
                  else void listen.start()
                }
              }}
            >
              <span className="mic-ring" aria-hidden />
              <span className="mic-ring two" aria-hidden />
              <Mic size={22} aria-hidden />
            </button>
            <p className="caption" aria-live="polite">
              {caption}
            </p>
            <button className="icon-btn" aria-label="Type instead" onClick={() => setTyping(true)}>
              <Keyboard size={16} aria-hidden />
            </button>
          </div>
        ) : (
          <form
            className="type"
            onSubmit={(e) => {
              e.preventDefault()
              void submit(text)
            }}
          >
            {canListen && (
              <button type="button" className="icon-btn" aria-label="Talk instead" onClick={() => setTyping(false)}>
                <Mic size={16} aria-hidden />
              </button>
            )}
            <label className="sr-only" htmlFor="ask-input">
              Ask a question
            </label>
            <input id="ask-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask why, or set a rule…" autoComplete="off" />
            <button className="icon-btn solid" aria-label="Send" disabled={!text.trim() || thinking}>
              <Send size={15} aria-hidden />
            </button>
          </form>
        )}
      </footer>
    </div>
  )
}
