import { useCallback, useEffect, useRef, useState } from 'react'

/* ---------------- speech recognition (talk to the agent) ---------------- */

interface RecognitionResult {
  isFinal: boolean
  0: { transcript: string }
}
interface RecognitionEvent {
  resultIndex: number
  results: ArrayLike<RecognitionResult>
}
interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: RecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start(): void
  stop(): void
  abort(): void
}

function recognitionCtor(): (new () => Recognition) | undefined {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

export const canListen = typeof window !== 'undefined' && !!recognitionCtor()
export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

export type ListenError = 'not-allowed' | 'no-speech' | 'network' | 'unsupported' | 'allowed' | null

async function micPermission(): Promise<PermissionState | 'unknown'> {
  try {
    return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state
  } catch {
    return 'unknown'
  }
}

/**
 * Push-to-talk recognition plus a live microphone level for the waveform.
 * onFinal fires once with the whole utterance when the user stops talking.
 */
export function useListen(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<ListenError>(null)
  const [level, setLevel] = useState(0)
  const rec = useRef<Recognition | null>(null)
  const finalText = useRef('')
  const heard = useRef('')
  const holding = useRef(false)
  const cancelled = useRef(false)
  const audio = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null)
  const cb = useRef(onFinal)
  cb.current = onFinal

  const stopMeter = () => {
    const a = audio.current
    if (!a) return
    cancelAnimationFrame(a.raf)
    a.stream.getTracks().forEach((t) => t.stop())
    void a.ctx.close()
    audio.current = null
    setLevel(0)
  }

  const startMeter = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const an = ctx.createAnalyser()
      an.fftSize = 512
      src.connect(an)
      const buf = new Uint8Array(an.fftSize)
      const loop = () => {
        an.getByteTimeDomainData(buf)
        let sum = 0
        for (const b of buf) sum += ((b - 128) / 128) ** 2
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4))
        if (audio.current) audio.current.raf = requestAnimationFrame(loop)
      }
      audio.current = { ctx, stream, raf: requestAnimationFrame(loop) }
    } catch {
      /* the level meter is decoration; recognition reports permission errors itself */
    }
  }

  const start = useCallback(async () => {
    const Ctor = recognitionCtor()
    if (!Ctor) {
      setError('unsupported')
      return
    }
    if ((await micPermission()) === 'prompt') {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true })
        s.getTracks().forEach((t) => t.stop())
        setError('allowed')
      } catch {
        setError('not-allowed')
      }
      return
    }
    window.speechSynthesis?.cancel()
    setError(null)
    setInterim('')
    finalText.current = ''
    heard.current = ''
    holding.current = true
    cancelled.current = false
    let failed = false
    const finish = () => {
      setListening(false)
      stopMeter()
      const text = cancelled.current ? '' : (finalText.current.trim() || heard.current).trim()
      heard.current = ''
      if (text) cb.current(text)
      else if (!failed && !cancelled.current) setError('no-speech')
      cancelled.current = false
    }
    const begin = () => {
      const r = new Ctor()
      r.lang = navigator.language || 'en-US'
      r.interimResults = true
      r.continuous = false
      const base = finalText.current
      r.onresult = (e) => {
        let fin = ''
        let live = ''
        for (let i = 0; i < e.results.length; i++) {
          const res = e.results[i]
          if (res.isFinal) fin += res[0].transcript
          else live += res[0].transcript
        }
        finalText.current = (base + ' ' + fin).trim()
        heard.current = (finalText.current + ' ' + live).trim()
        setInterim(heard.current)
      }
      r.onerror = (e) => {
        if (e.error === 'aborted' || (e.error === 'no-speech' && holding.current)) return
        failed = true
        const map: Record<string, ListenError> = { 'not-allowed': 'not-allowed', 'service-not-allowed': 'not-allowed', 'audio-capture': 'not-allowed', 'no-speech': 'no-speech', network: 'network' }
        setError(map[e.error] ?? null)
      }
      r.onend = () => {
        if (holding.current && !failed && !cancelled.current) {
          finalText.current = heard.current || finalText.current
          begin()
          return
        }
        finish()
      }
      rec.current = r
      r.start()
    }
    try {
      begin()
      setListening(true)
      void startMeter()
    } catch {
      holding.current = false
      setError('unsupported')
    }
  }, [])

  const stop = useCallback(() => {
    holding.current = false
    rec.current?.stop()
  }, [])
  const cancel = useCallback(() => {
    finalText.current = ''
    cancelled.current = true
    holding.current = false
    rec.current?.abort()
  }, [])

  useEffect(() => () => {
    holding.current = false
    cancelled.current = true
    rec.current?.abort()
    stopMeter()
  }, [])

  return { listening, interim, error, level, start, stop, cancel }
}

/* ---------------- speech synthesis (hear the explanation) ---------------- */

function pickVoice() {
  const voices = window.speechSynthesis.getVoices()
  const lang = (navigator.language || 'en').slice(0, 2)
  const prefer = ['Google UK English Female', 'Samantha', 'Serena', 'Karen', 'Moira', 'Google US English', 'Microsoft Aria', 'Microsoft Libby']
  for (const name of prefer) {
    const v = voices.find((x) => x.name.startsWith(name))
    if (v) return v
  }
  return voices.find((v) => v.lang.startsWith(lang) && v.localService) ?? voices.find((v) => v.lang.startsWith('en'))
}

/**
 * One shared speaker so only one explanation talks at a time.
 * `charIndex` lets the UI highlight the word being spoken.
 */
type SpeakState = { id: string | null; charIndex: number }
let state: SpeakState = { id: null, charIndex: 0 }
const subs = new Set<(s: SpeakState) => void>()
const set = (s: SpeakState) => {
  state = s
  subs.forEach((f) => f(s))
}

export function speak(id: string, text: string) {
  if (!canSpeak) return
  const synth = window.speechSynthesis
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const v = pickVoice()
  if (v) u.voice = v
  u.rate = 1.03
  u.pitch = 1.02
  u.onboundary = (e) => {
    if (e.name === 'word' || e.charIndex > 0) set({ id, charIndex: e.charIndex })
  }
  u.onend = () => state.id === id && set({ id: null, charIndex: 0 })
  u.onerror = () => state.id === id && set({ id: null, charIndex: 0 })
  set({ id, charIndex: 0 })
  synth.speak(u)
}

export function stopSpeaking() {
  if (canSpeak) window.speechSynthesis.cancel()
  set({ id: null, charIndex: 0 })
}

export function useSpeaking() {
  const [s, setS] = useState(state)
  useEffect(() => {
    subs.add(setS)
    return () => {
      subs.delete(setS)
    }
  }, [])
  return s
}
