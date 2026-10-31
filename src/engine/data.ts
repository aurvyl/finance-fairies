import type { AssetClass, Holding, Sector } from './types'

/** Small deterministic PRNG so the demo portfolio is the same on every load. */
export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function gauss(r: () => number) {
  const u = Math.max(r(), 1e-9)
  const v = r()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

type Row = [symbol: string, name: string, price: number]

const book: Record<Sector, { cls: AssetClass; beta: number; vol: number; rows: Row[] }> = {
  Technology: {
    cls: 'Stock',
    beta: 1.2,
    vol: 0.28,
    rows: [
      ['AAPL', 'Apple', 231.4], ['MSFT', 'Microsoft', 438.2], ['GOOGL', 'Alphabet A', 178.6],
      ['META', 'Meta Platforms', 562.1], ['AMZN', 'Amazon', 196.3], ['CRM', 'Salesforce', 284.5],
      ['ADBE', 'Adobe', 512.9], ['ORCL', 'Oracle', 171.2], ['NOW', 'ServiceNow', 902.4],
      ['SHOP', 'Shopify', 78.4], ['SNOW', 'Snowflake', 126.8], ['PLTR', 'Palantir', 41.7],
      ['UBER', 'Uber', 72.3], ['NET', 'Cloudflare', 88.1], ['DDOG', 'Datadog', 124.6],
      ['PANW', 'Palo Alto Networks', 362.4], ['CRWD', 'CrowdStrike', 291.2], ['INTU', 'Intuit', 640.3],
      ['SAP', 'SAP', 221.5], ['SPOT', 'Spotify', 382.9],
    ],
  },
  Semiconductors: {
    cls: 'Stock',
    beta: 1.55,
    vol: 0.42,
    rows: [
      ['NVDA', 'NVIDIA', 138.2], ['AMD', 'Advanced Micro Devices', 152.6], ['AVGO', 'Broadcom', 171.4],
      ['TSM', 'Taiwan Semiconductor', 189.3], ['ASML', 'ASML Holding', 702.5], ['QCOM', 'Qualcomm', 166.2],
      ['MU', 'Micron', 104.8], ['ARM', 'Arm Holdings', 142.1], ['INTC', 'Intel', 22.6],
      ['AMAT', 'Applied Materials', 187.4], ['LRCX', 'Lam Research', 74.9], ['MRVL', 'Marvell', 88.3],
    ],
  },
  Financials: {
    cls: 'Stock',
    beta: 1.05,
    vol: 0.22,
    rows: [
      ['JPM', 'JPMorgan Chase', 221.7], ['BAC', 'Bank of America', 41.2], ['GS', 'Goldman Sachs', 512.3],
      ['MS', 'Morgan Stanley', 118.4], ['V', 'Visa', 289.6], ['MA', 'Mastercard', 498.2],
      ['BRK.B', 'Berkshire Hathaway B', 452.8], ['HSBA', 'HSBC', 6.9], ['BLK', 'BlackRock', 968.3],
      ['AXP', 'American Express', 271.1], ['SCHW', 'Charles Schwab', 70.4], ['PYPL', 'PayPal', 79.2],
    ],
  },
  Healthcare: {
    cls: 'Stock',
    beta: 0.7,
    vol: 0.2,
    rows: [
      ['LLY', 'Eli Lilly', 812.6], ['UNH', 'UnitedHealth', 571.4], ['JNJ', 'Johnson & Johnson', 157.2],
      ['NVO', 'Novo Nordisk', 112.8], ['AZN', 'AstraZeneca', 74.6], ['MRK', 'Merck', 101.3],
      ['ABBV', 'AbbVie', 188.9], ['TMO', 'Thermo Fisher', 548.2], ['ISRG', 'Intuitive Surgical', 512.7],
      ['PFE', 'Pfizer', 28.4],
    ],
  },
  Energy: {
    cls: 'Stock',
    beta: 0.8,
    vol: 0.27,
    rows: [
      ['XOM', 'Exxon Mobil', 118.3], ['CVX', 'Chevron', 151.6], ['SHEL', 'Shell', 66.2],
      ['BP', 'BP', 30.1], ['TTE', 'TotalEnergies', 63.4], ['COP', 'ConocoPhillips', 108.7],
      ['NEE', 'NextEra Energy', 78.2], ['ENPH', 'Enphase', 71.9],
    ],
  },
  Consumer: {
    cls: 'Stock',
    beta: 0.9,
    vol: 0.24,
    rows: [
      ['TSLA', 'Tesla', 248.5], ['COST', 'Costco', 902.1], ['WMT', 'Walmart', 82.4],
      ['NKE', 'Nike', 78.6], ['MCD', "McDonald's", 296.3], ['SBUX', 'Starbucks', 96.2],
      ['KO', 'Coca-Cola', 69.8], ['PEP', 'PepsiCo', 168.4], ['PG', 'Procter & Gamble', 170.1],
      ['DIS', 'Disney', 96.7], ['NFLX', 'Netflix', 748.9], ['ABNB', 'Airbnb', 131.5],
      ['LVMH', 'LVMH', 682.4], ['ULVR', 'Unilever', 48.9],
    ],
  },
  Industrials: {
    cls: 'Stock',
    beta: 1.0,
    vol: 0.23,
    rows: [
      ['CAT', 'Caterpillar', 382.4], ['GE', 'GE Aerospace', 189.6], ['HON', 'Honeywell', 212.3],
      ['BA', 'Boeing', 152.8], ['UNP', 'Union Pacific', 241.2], ['DE', 'Deere', 398.6],
      ['RTX', 'RTX', 121.4], ['SIEGY', 'Siemens', 96.3], ['LMT', 'Lockheed Martin', 572.1],
      ['UPS', 'UPS', 131.9],
    ],
  },
  Crypto: {
    cls: 'Crypto',
    beta: 1.8,
    vol: 0.65,
    rows: [
      ['BTC', 'Bitcoin', 68420], ['ETH', 'Ether', 2614], ['SOL', 'Solana', 168.4],
      ['XRP', 'XRP', 0.54], ['ADA', 'Cardano', 0.36], ['AVAX', 'Avalanche', 27.3],
      ['LINK', 'Chainlink', 11.8], ['DOT', 'Polkadot', 4.4], ['MATIC', 'Polygon', 0.39],
      ['ATOM', 'Cosmos', 4.9], ['UNI', 'Uniswap', 7.6], ['LTC', 'Litecoin', 68.2],
      ['DOGE', 'Dogecoin', 0.12], ['ARB', 'Arbitrum', 0.61],
    ],
  },
  'Global equity': {
    cls: 'Fund',
    beta: 0.95,
    vol: 0.04,
    rows: [
      ['VWRL', 'Vanguard FTSE All-World', 118.6], ['SPY', 'SPDR S&P 500', 572.4], ['QQQ', 'Invesco QQQ', 489.3],
      ['VTI', 'Vanguard Total Market', 284.1], ['IWDA', 'iShares Core MSCI World', 98.2], ['EEM', 'iShares MSCI EM', 44.6],
      ['VGK', 'Vanguard FTSE Europe', 69.8], ['ISF', 'iShares Core FTSE 100', 8.2], ['SCHD', 'Schwab US Dividend', 28.4],
      ['VNQ', 'Vanguard Real Estate', 91.7], ['ARKK', 'ARK Innovation', 48.3], ['SMH', 'VanEck Semiconductor', 241.6],
      ['XLE', 'Energy Select SPDR', 89.4], ['XLV', 'Health Care SPDR', 151.2], ['IWM', 'iShares Russell 2000', 219.8],
      ['EWJ', 'iShares MSCI Japan', 71.3], ['INDA', 'iShares MSCI India', 56.9], ['GLD', 'SPDR Gold', 238.4],
    ],
  },
  Bonds: {
    cls: 'Bond',
    beta: -0.15,
    vol: 0.05,
    rows: [
      ['AGG', 'iShares Core US Aggregate', 99.8], ['TLT', 'iShares 20+ Yr Treasury', 96.4], ['IGLT', 'iShares UK Gilts', 11.9],
      ['LQD', 'iShares IG Corporate', 109.2], ['TIP', 'iShares TIPS', 109.7], ['BNDX', 'Vanguard Intl Bond', 49.6],
    ],
  },
  Cash: {
    cls: 'Cash',
    beta: 0,
    vol: 0.002,
    rows: [['SGOV', 'iShares 0–3 Month Treasury', 100.4], ['USD', 'Cash (USD)', 1]],
  },
}

/** Target weights by sector for the demo book. */
const weights: Record<Sector, number> = {
  Technology: 0.2,
  Semiconductors: 0.14,
  Financials: 0.09,
  Healthcare: 0.07,
  Energy: 0.04,
  Consumer: 0.08,
  Industrials: 0.05,
  Crypto: 0.12,
  'Global equity': 0.15,
  Bonds: 0.04,
  Cash: 0.02,
}

export const SECTORS = Object.keys(book) as Sector[]

export function sectorBeta(s: Sector) {
  return book[s].beta
}

export function buildPortfolio(total: number): Holding[] {
  const r = rng(20261031)
  const out: Holding[] = []
  for (const sector of SECTORS) {
    const def = book[sector]
    // uneven position sizes inside a sector, like a real book
    const raw = def.rows.map(() => 0.25 + r() ** 2 * 2)
    const sum = raw.reduce((a, b) => a + b, 0)
    def.rows.forEach(([symbol, name, price], i) => {
      const value = (total * weights[sector] * raw[i]) / sum
      const beta = def.beta * (0.8 + r() * 0.4)
      out.push({
        symbol,
        name,
        assetClass: def.cls,
        sector,
        qty: value / price,
        price,
        open: price,
        beta,
        vol: def.vol * (0.75 + r() * 0.5),
        path: [price],
      })
    })
  }
  return out
}
