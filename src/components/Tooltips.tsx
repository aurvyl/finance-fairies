import { useEffect } from 'react'

const DELAY = 380
/** after one tip closes, the next one opens at once for this long, so scanning a row of meters feels quick */
const WARM = 600
const GAP = 8

/**
 * One styled tooltip for every element that already carries a `title`. Native titles stay in the
 * markup (screen readers and touch keep working); while a tip is showing, the title is parked in
 * data-tip so the browser's own tooltip doesn't double up. Opens on mouse hover and on keyboard focus.
 */
export function Tooltips() {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    const tip = document.createElement('div')
    tip.className = 'tip'
    tip.id = 'ff-tip'
    tip.setAttribute('role', 'tooltip')
    document.body.append(tip)

    let target: HTMLElement | null = null
    let pending: HTMLElement | null = null
    let timer = 0
    // React re-sets a title whose text changed (live meters); fold it into the open tip instead
    const watch = new MutationObserver(() => {
      const text = target?.getAttribute('title')
      if (!target || !text) return
      target.dataset.tip = text
      target.removeAttribute('title')
      tip.textContent = text
      place(target)
    })
    let closedAt = 0

    const place = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      const t = tip.getBoundingClientRect()
      const below = r.top - t.height - GAP < 8
      const x = Math.min(window.innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2))
      const y = below ? r.bottom + GAP : r.top - t.height - GAP
      tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
      tip.dataset.side = below ? 'below' : 'above'
    }

    const open = (el: HTMLElement) => {
      const text = el.getAttribute('title')
      if (!text) return
      target = el
      pending = null
      watch.observe(el, { attributes: true, attributeFilter: ['title'] })
      el.dataset.tip = text
      el.removeAttribute('title')
      if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-describedby')) el.setAttribute('aria-describedby', tip.id)
      tip.textContent = text
      tip.classList.remove('on')
      place(el)
      // next frame, so the entrance runs from the placed position
      requestAnimationFrame(() => tip.classList.add('on'))
    }

    const close = () => {
      window.clearTimeout(timer)
      pending = null
      if (!target) return
      watch.disconnect()
      const el = target
      target = null
      if (el.dataset.tip) {
        el.setAttribute('title', el.dataset.tip)
        delete el.dataset.tip
      }
      if (el.getAttribute('aria-describedby') === tip.id) el.removeAttribute('aria-describedby')
      tip.classList.remove('on')
      closedAt = performance.now()
    }

    const schedule = (el: HTMLElement) => {
      if (el === target || el === pending) return
      close()
      pending = el
      const warm = performance.now() - closedAt < WARM
      timer = window.setTimeout(() => open(el), warm ? 0 : DELAY)
    }

    const titled = (n: EventTarget | null) => (n instanceof Element ? (n.closest('[title], [data-tip]') as HTMLElement | null) : null)

    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const el = titled(e.target)
      if (el) schedule(el)
      else close()
    }
    const onLeave = (e: PointerEvent) => {
      const into = e.relatedTarget as Node | null
      const el = target ?? pending
      if (el && !el.contains(into)) close()
    }
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement
      if (el.matches?.(':focus-visible') && el.hasAttribute('title')) schedule(el)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()

    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerout', onLeave)
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', close)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    return () => {
      close()
      watch.disconnect()
      tip.remove()
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerout', onLeave)
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', close)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
    }
  }, [])
  return null
}
