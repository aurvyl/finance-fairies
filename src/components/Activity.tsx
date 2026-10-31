import { Check, ChevronDown, MessageCircleQuestion, ShieldCheck, Square, Volume2, Waves, X } from 'lucide-react'
import { compactMoney, dayLabel } from '../engine/format'
import { sim } from '../engine/sim'
import type { ActivityItem, Snapshot } from '../engine/types'
import { useUI } from '../store'
import { canSpeak, speak, stopSpeaking, useSpeaking } from '../voice'
import { SpokenText } from './SpokenText'

function Glyph({ kind }: { kind: ActivityItem['kind'] }) {
  if (kind === 'action')
    return (
      <span className="glyph action" aria-hidden>
        <svg viewBox="0 0 12 12" width="12" height="12">
          <rect x="2.5" y="2.5" width="7" height="7" rx="1" transform="rotate(45 6 6)" />
        </svg>
      </span>
    )
  if (kind === 'market')
    return (
      <span className="glyph market" aria-hidden>
        <Waves size={13} />
      </span>
    )
  return (
    <span className="glyph rule" aria-hidden>
      <ShieldCheck size={13} />
    </span>
  )
}

function Item({ a, now }: { a: ActivityItem; now: number }) {
  const ui = useUI()
  const speaking = useSpeaking()
  const open = ui.expanded === a.id
  const isSpeaking = speaking.id === a.id
  const spoken = `${a.title}. ${a.summary} ${a.why.join(' ')}`
  const sells = a.trades?.filter((t) => t.side === 'Sell') ?? []

  return (
    <li
      className={`item kind-${a.kind} ${open ? 'open' : ''} ${ui.hovered === a.id ? 'hover' : ''} ${a.pending ? 'pending' : ''}`}
      onPointerEnter={() => ui.setHovered(a.id)}
      onPointerLeave={() => ui.setHovered(null)}
    >
      <time className="item-time" dateTime={new Date(a.t).toISOString()}>
        {dayLabel(a.t, now).replace('Today ', '')}
      </time>
      <Glyph kind={a.kind} />
      <div className="item-body">
        <button className="item-title" aria-expanded={open} onClick={() => ui.setExpanded(open ? null : a.id)}>
          <span>{a.title}</span>
          <ChevronDown size={15} className="chev" aria-hidden />
        </button>
        <p className="item-summary">{a.summary}</p>

        {a.pending && (
          <div className="row-actions approve">
            <button className="btn solid sm" onClick={() => sim.approve(a.id)}>
              <Check size={14} aria-hidden /> Approve trades
            </button>
            <button className="btn ghost sm" onClick={() => sim.dismiss(a.id)}>
              <X size={14} aria-hidden /> Decline
            </button>
          </div>
        )}

        <div className="reveal" aria-hidden={!open}>
          <div className="reveal-inner">
            <h4 className="why-head">{a.kind === 'action' ? 'Why I did this' : a.kind === 'market' ? 'Why it moved' : 'What this means'}</h4>
            <ul className="why">
              {isSpeaking ? (
                <li className="speaking-line">
                  <SpokenText text={a.why.join(' ')} offset={a.title.length + a.summary.length + 3} charIndex={speaking.charIndex} />
                </li>
              ) : (
                a.why.map((w, i) => <li key={i}>{w}</li>)
              )}
            </ul>
            {sells.length > 0 && (
              <table className="trades">
                <caption className="sr-only">Trades placed</caption>
                <tbody>
                  {a.trades!.map((t, i) => (
                    <tr key={i}>
                      <td className={`side-${t.side.toLowerCase()}`}>{t.side}</td>
                      <td>{t.symbol}</td>
                      <td className="num">{compactMoney(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="item-tools">
          {canSpeak && (
            <button
              className={`tool ${isSpeaking ? 'live' : ''}`}
              onClick={() => {
                if (isSpeaking) stopSpeaking()
                else {
                  ui.setExpanded(a.id)
                  speak(a.id, spoken)
                }
              }}
            >
              {isSpeaking ? (
                <>
                  <span className="eq" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                  <Square size={11} aria-hidden /> Stop
                </>
              ) : (
                <>
                  <Volume2 size={14} aria-hidden /> Listen
                </>
              )}
            </button>
          )}
          <button className="tool" onClick={() => ui.openVoice(a.kind === 'action' ? `Why did you ${a.title.replace(/^(Proposed|Declined): /, '').toLowerCase()}?` : 'What happened in the market today?')}>
            <MessageCircleQuestion size={14} aria-hidden /> Ask about this
          </button>
        </div>
      </div>
    </li>
  )
}

export function Activity({ s, limit }: { s: Snapshot; limit?: number }) {
  const ui = useUI()
  const items = limit ? s.activity.slice(0, limit) : s.activity
  const pending = s.activity.filter((a) => a.pending).length
  return (
    <div className="panel activity">
      <header className="panel-head">
        <h2>Agent activity</h2>
        {pending > 0 && <span className="badge">{pending} waiting for you</span>}
        {limit && s.activity.length > limit && (
          <button className="link" onClick={() => ui.setView('activity')}>
            See all {s.activity.length}
          </button>
        )}
      </header>
      {items.length === 0 ? (
        <p className="empty">Nothing yet. When markets move or a limit gets close, I’ll explain what happened and what I did here.</p>
      ) : (
        <ol className="feed">
          {items.map((a) => (
            <Item key={a.id} a={a} now={s.now} />
          ))}
        </ol>
      )}
    </div>
  )
}
