# Finance Fairies — design system

Surface mode: **Operate** (a working dashboard). The world lends type, palette, density and one signature move; layout, navigation and controls stay the standard ones.

## World
Admiralty nautical chart. Charts keep magenta for hazards and limits; so does this product.

- **Signature move: the load line.** The user's limit is drawn on the chart as a magenta line, with a hatched "ward" band between where the agent starts acting and the limit itself. Agent trades are magenta diamonds on the value line, linked by hover to their entry in Agent activity. The logo is the same mark: a load-line circle and bar.
- **Light ground.** Scene: self-directed investors checking in briefly during the working day on a laptop or phone, often in daylight.

## Tokens (see `src/index.css`)
| Role | Token | Value |
|---|---|---|
| Shell (rail, primary dark controls) | `--ink` | `oklch(0.25 0.06 258)` |
| Page ground | `--ground` | `oklch(0.962 0.01 235)` |
| Work surface | `--surface` | `oklch(0.996 0.003 235)` |
| Hairlines | `--line`, `--line-2` | `oklch(0.91 0.012 240)`, `oklch(0.85 0.016 240)` |
| Text | `--text`, `--text-2`, `--text-3` | primary, secondary (≥4.5:1), placeholder only |
| Limits, agent marks, Talk button | `--limit` | `oklch(0.53 0.21 352)` |
| Gain / loss | `--up`, `--down` | teal `oklch(0.5 0.1 168)`, vermilion `oklch(0.54 0.18 32)` |
| Getting close / agent acting | `--warn` | `oklch(0.68 0.15 68)` |

Magenta is never decoration: it means "your rule" or "the agent did this".

## Type
Geist Variable for everything, self-hosted via `@fontsource-variable/geist`. Tabular numerals on every number. Scale: 40 (value) / 26 (page title, rule readout) / 16 (panel title) / 15 (body) / 13.5 (secondary) / 12.5 (labels).

## Motion
Product-speed: 160 ms feedback, 260 ms state, `cubic-bezier(0.16, 1, 0.3, 1)`.
- Portfolio value rolls digit by digit, settled to one roll every 2 s so it stays readable.
- Agent action diamonds drop in with a small overshoot; feed items unclip from the top.
- "Why" explanations open inline (grid-rows 0fr→1fr with a blur-to-sharp fade). No modals.
- Guardrail sliders move the limit line and ward band on the chart live, before saving.
- Voice: mic rings scale with the live microphone level; spoken answers highlight the current word.
- `prefers-reduced-motion` keeps state colour changes and removes movement and loops.

## Components
Panels (12 px radius, 1 px hairline, soft offset shadow), segmented controls, chips with counts, ghost/solid/Talk buttons, meters with an "agent acts" tick, sortable table with intraday paths. Every interactive element has hover, focus-visible (magenta ring), active and disabled states.
