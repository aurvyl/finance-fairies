import type { Holding, Sector } from './types'

/**
 * Story-driven sell-offs for the demo. Each scenario is fiction: a headline, the beats of how
 * the panic spread (each beat changes which sectors and symbols are falling), the groups of
 * holdings it hits and why, and where the money ran. The sim plays the beats on a tick clock.
 * Add a scenario by adding an entry to SCENARIOS; nothing else needs to change.
 */

type Drift = Partial<Record<Sector, number>>

export interface Beat {
  /** sim ticks after the start at which this beat begins */
  at: number
  title: string
  text: string
  /** extra market-wide drift per tick while this beat runs */
  market: number
  /** per-tick drift by sector while this beat runs (replaces the previous beat's) */
  sectors: Drift
  /** per-tick drift for single symbols while this beat runs */
  symbols?: Record<string, number>
  /** one-off price jumps applied the moment the beat starts, e.g. a gap down at the open */
  gaps?: Record<string, number>
}

export interface Match {
  sectors?: Sector[]
  symbols?: string[]
}

export interface HitGroup {
  id: string
  label: string
  /** the label as it reads mid-sentence */
  noun: string
  /** the beat from which this group is part of the story */
  from: number
  match: Match
  why: string
}

export interface Scenario {
  id: string
  /** short name used inside sentences: "the Tesla sell-off" */
  short: string
  headline: string
  dek: string
  /** total length of the shock in ticks */
  ticks: number
  beats: Beat[]
  /** what happens after the shock: shown as the last step and applied as the new drift */
  after: { title: string; text: string; sectors: Drift; symbols?: Record<string, number> }
  hits: HitGroup[]
  haven: HitGroup
  /** one line on where the fairy's sales went, and why that fits this story */
  fairy: string
  disclaimer: string
}

const musk: Scenario = {
  id: 'musk-tesla',
  short: 'Tesla sell-off',
  headline: 'Elon Musk sells 90% of his Tesla shares, and markets panic',
  dek: 'A filing shows Tesla’s founder has dumped almost his whole stake. Traders read it as him losing faith, and the selling spreads well beyond one stock.',
  ticks: 18,
  beats: [
    {
      at: 0,
      title: 'Tesla gaps down',
      text: 'A regulatory filing shows Musk sold about 90% of his Tesla shares overnight. The stock opens sharply lower as everyone tries to sell at once.',
      market: -0.0008,
      sectors: { Consumer: -0.0003 },
      symbols: { TSLA: -0.006 },
      gaps: { TSLA: -0.11 },
    },
    {
      at: 3,
      title: 'Panic spreads to EVs and big tech',
      text: 'Other electric-car makers fall in sympathy. Funds that own Tesla sell their other big tech names too, to cut risk fast.',
      market: -0.0011,
      sectors: { Technology: -0.0007, Consumer: -0.0003 },
      symbols: { TSLA: -0.004, ARKK: -0.002, QQQ: -0.0006 },
    },
    {
      at: 6,
      title: 'Chipmakers get sold next',
      text: 'Tesla is one of the biggest buyers of AI chips. Traders bet its AI and robotaxi spending will be cut, and chip stocks drop.',
      market: -0.0011,
      sectors: { Technology: -0.0005, Semiconductors: -0.0015 },
      symbols: { TSLA: -0.002, SMH: -0.001, NVDA: -0.0008 },
    },
    {
      at: 9,
      title: 'Crypto slides',
      text: 'Tesla holds bitcoin, and Dogecoin has traded on Musk’s every word for years. As fear rises, the most volatile assets are sold first.',
      market: -0.001,
      sectors: { Technology: -0.0004, Semiconductors: -0.0012, Crypto: -0.002 },
      symbols: { DOGE: -0.006, BTC: -0.0004, TSLA: -0.001 },
    },
    {
      at: 13,
      title: 'Fear spikes and money runs to safety',
      text: 'The market’s fear gauge jumps. Investors pile into Treasuries and gold, so bond prices rise while almost everything else falls.',
      market: -0.0009,
      sectors: { Technology: -0.0003, Semiconductors: -0.0008, Crypto: -0.0015, Bonds: 0.0004 },
      symbols: { DOGE: -0.003, TLT: 0.0006, GLD: 0.0008 },
    },
  ],
  after: {
    title: 'Bargain hunters step in',
    text: 'With the worst of the panic over, some buyers come back for chips and crypto at lower prices.',
    sectors: { Semiconductors: 0.0006, Crypto: 0.0008 },
  },
  hits: [
    {
      id: 'tsla',
      label: 'Tesla',
      noun: 'Tesla',
      from: 0,
      match: { symbols: ['TSLA'] },
      why: 'Where it started. A founder selling 90% floods the market with shares and reads as a loss of faith.',
    },
    {
      id: 'tech',
      label: 'Big tech and growth funds',
      noun: 'big tech and growth funds',
      from: 1,
      match: { sectors: ['Technology'], symbols: ['QQQ', 'ARKK'] },
      why: 'Funds that own Tesla sold their other big tech holdings to cut risk, so the whole group fell together.',
    },
    {
      id: 'chips',
      label: 'Chipmakers',
      noun: 'chipmakers',
      from: 2,
      match: { sectors: ['Semiconductors'], symbols: ['SMH'] },
      why: 'Tesla buys a lot of AI chips. Traders priced in less spending from it.',
    },
    {
      id: 'crypto',
      label: 'Crypto',
      noun: 'crypto',
      from: 3,
      match: { sectors: ['Crypto'] },
      why: 'Tesla holds bitcoin and Dogecoin moves on Musk news. In a panic, the most volatile assets go first.',
    },
  ],
  haven: {
    id: 'haven',
    label: 'Treasuries and bonds',
      noun: 'Treasuries and bonds',
    from: 4,
    match: { sectors: ['Bonds', 'Cash'] },
    why: 'Where the money ran. Prices rose as investors looked for somewhere safe.',
  },
  fairy: 'It moved the money into short-dated Treasuries, the same place other investors were running to.',
  disclaimer: 'Fictional scenario for the demo. Elon Musk has not sold his Tesla shares; the news, prices and trades here are all simulated.',
}

export const SCENARIOS: Record<string, Scenario> = { [musk.id]: musk }
export const DEFAULT_SCENARIO = musk.id

/** "a, b and c" */
export const listOf = (xs: string[]) => xs.join(', ').replace(/, ([^,]*)$/, ' and $1')

export function matches(h: Holding, m: Match) {
  return (m.symbols?.includes(h.symbol) ?? false) || (m.sectors?.includes(h.sector) ?? false)
}

/** The story group a holding belongs to, if the story has reached it by this beat. */
export function hitFor(sc: Scenario, h: Holding, beat: number): HitGroup | undefined {
  // symbol matches win over sector matches, so TSLA counts as Tesla, not Consumer
  return (
    sc.hits.find((g) => g.from <= beat && g.match.symbols?.includes(h.symbol)) ??
    sc.hits.find((g) => g.from <= beat && g.match.sectors?.includes(h.sector))
  )
}
