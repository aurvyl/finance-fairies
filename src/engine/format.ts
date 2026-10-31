const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function money(v: number, cents = false) {
  return (cents ? usd2 : usd0).format(v)
}

export function compactMoney(v: number) {
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`
  if (a >= 1e4) return `${sign}$${(a / 1e3).toFixed(1)}k`
  return `${sign}${usd0.format(a)}`
}

export function price(v: number) {
  if (v >= 1000) return usd0.format(v)
  if (v >= 1) return usd2.format(v)
  return `$${v.toFixed(4)}`
}

/** A fraction as a percent with a real minus sign. */
export function pct(f: number, digits = 2, signed = true) {
  const s = (Math.abs(f) * 100).toFixed(digits)
  if (!signed) return `${s}%`
  if (Math.abs(f) < 0.5 * 10 ** -(digits + 2)) return `${(0).toFixed(digits)}%`
  return `${f < 0 ? '−' : '+'}${s}%`
}

export function clock(t: number) {
  return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export function dayLabel(t: number, now: number) {
  const d = new Date(t)
  const n = new Date(now)
  const same = d.toDateString() === n.toDateString()
  if (same) return `Today ${clock(t)}`
  const y = new Date(now)
  y.setDate(y.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return `Yesterday ${clock(t)}`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ` ${clock(t)}`
}
