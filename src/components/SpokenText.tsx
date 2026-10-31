/**
 * Renders text with the word currently being spoken highlighted and the words already
 * spoken settled, so the eye can follow the voice. `offset` is where this text starts
 * inside the full utterance.
 */
export function SpokenText({ text, charIndex, offset = 0 }: { text: string; charIndex: number; offset?: number }) {
  const at = charIndex - offset
  const parts = text.split(/(\s+)/)
  let pos = 0
  return (
    <span className="spoken">
      {parts.map((p, i) => {
        const start = pos
        pos += p.length
        if (/^\s+$/.test(p)) return p
        const state = at >= start && at < pos ? 'now' : at >= pos ? 'done' : 'todo'
        return (
          <span key={i} className={`w ${state}`}>
            {p}
          </span>
        )
      })}
    </span>
  )
}
