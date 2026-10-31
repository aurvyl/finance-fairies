# Finance Fairies — product

> Written from the founder's brief on 2026-10-31. Items marked *(inferred)* were not confirmed and should be checked.

## What it is
An agentic portfolio manager. The user sets rules at the **portfolio level** in plain language, and the agent keeps the whole portfolio inside them automatically, however many positions it holds (hundreds of stocks, crypto assets and funds).

Example rules from the brief:
- "I don't want my portfolio to drop below 10%" → a maximum drawdown from the high-water mark.
- "I don't want to lose more than 2% in a given day" → a daily loss limit measured from the day's open.

## The mechanism
The agent acts on its own when the portfolio approaches a limit, then explains, when asked, (a) why the market moved and (b) why it took the action it took. Explanations are available by text and by voice.

## Users and scene *(inferred)*
Self-directed investors with large, varied portfolios who do not want to watch them all day. They check in briefly from a laptop or phone during the working day, and sometimes ask questions hands-free.

## Must stay true
- The user's rules are the product. Headroom against each rule must be readable within seconds.
- Every automatic action has an explanation with the numbers behind it.
- The user can tighten, loosen, or pause the agent at any time.
- Demo data is synthetic and labelled as such. No invented performance claims.

## Platform
web (responsive, desktop first, usable on phones).

## Stack
Delegated: Vite + React + TypeScript, no UI framework. Optional Claude (Opus) explanations through a small server endpoint.
