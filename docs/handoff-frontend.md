# Handoff: wire the web interface to the verified Gemini agent

You are taking over the frontend of Finance Fairies (repo `aurvyl/finance-fairies`, your branch `claude/project-thread-gf1cs0`). The Python engine in `engine/` is finished and verified against the real Gemini API. Your job is to make the interface show what the agent now returns, and to move the remaining Claude call to Gemini. Hackathon timing: feature freeze 14:45, submission via GitHub at 16:00 (London, 31 October 2026), so keep changes small and demo-focused.

## Context you need

- Track 1 is "Frontier Agents with Gemini": the agent must run on Gemini. Gemini 4 Argon is the default provider; OpenAI, Anthropic and OpenRouter stay selectable in Settings.
- Principle: the LLM proposes, the engine's code decides. Every number comes from the engine; the UI only displays.
- Read first: `engine/API.md` (contract and response shapes), then `engine/README.md`. Interactive docs at `http://localhost:8000/docs` once the engine runs.
- Your branch already calls `/providers`, `/limits`, `/replay` and `/analyze` from `src/api/client.ts` and sends `X-LLM-Key`. That stays.

Run the engine (the user's key is already in `engine/.env.local` on their machine; on another machine run `bash scripts/set_gemini_key.sh` once):

```bash
cd engine && uv sync && uv run --project . uvicorn guardian.api:app --port 8000
```

## Tasks, in priority order

1. **Merge `origin/main` into your branch.** Note: at 14:20 `main` was rewritten to fix commit authorship (same files, new commit IDs), so your branch still holds the old copies of the engine commits. Plain `git fetch && git merge origin/main` works because the content is identical; do not force-push `main`, and do not `git pull --rebase` onto it. `README.md` will conflict: take main's version. It already contains your branch's Web interface section (rewritten around the whole project); re-add anything of yours that is missing. Root-level prototype docs moved to `docs/quant-prototype.md`.
2. **Fix the agent type.** In `src/api/types.ts`, `AnalyzeOut.agent` and `ReplayEvent.agent` are typed as `string | null`, but the engine returns an object or null:

   ```ts
   export interface AgentNote {
     provider: string
     model: string
     error: string | null
     decision?: 'ROTATE' | 'HOLD' | 'HEDGE_REQUEST'
     explanation?: string
     key_factors?: string[]
     news_considered?: string[]
     sources: { url: string; title: string | null }[]
     tool_calls: string[]          // e.g. ["get_risk_snapshot", "check_plan", "check_plan"]
     checks_run: number
     news_brief?: string | null
     news_error?: string | null
   }
   ```

   Also add `agent_agrees_with_engine: boolean` and `cached: boolean` to `AnalyzeOut`, and `live?: boolean`, `thinking_level?: 'minimal' | 'low' | 'medium' | 'high'`, `code_execution?: boolean` to `AgentConfig`.
3. **Show the agent's work in What-if (and any "today" view that calls `/analyze`).** Add an agent card: decision, `explanation` as the main "why" text, `key_factors` as a short list, `news_considered` plus `sources` as links (live mode only), and a one-line verification trail such as "Gemini proposed, the engine checked it 2 times" from `tool_calls` and `checks_run`. Show `agent_agrees_with_engine` as a small badge. `approval_reasons` can now include "the AI agent recommended holding: …"; show it like the other reasons. If `agent.error` is set, show it quietly and fall back to the engine plan. Reading `explanation` aloud with the existing voice code is a good touch but optional.
4. **Replay feed.** For trigger events with an `agent` object, show its decision and explanation under the engine's plans.
5. **Live news toggle in Settings.** Sends `agent.live = true`. Use it only for `/analyze` (What-if or today). Never send it with `/replay`: replays must not see news from after the replayed date.
6. **Timeouts and progress.** Measured latencies: `/analyze` with agent 25 to 45 s, with live news about 75 s, cached 0 s; `/replay` with agent about 60 s per trigger (the demo period has 7 triggers, about 7 minutes). Raise the agent timeouts in `client.ts` (analyze 150 s, replay 600 s), show a progress state ("Gemini is checking the plan…"), and consider keeping the agent off for Replay by default.
7. **Move `/api/ask` to Gemini.** The engine serves the same contract at `POST {engineUrl}/ask` with body `{question, context, provider}` and returns `{answer, provider, model}` (about 5 s; it says percentages aloud correctly). Call it from `src/engine/ask.ts` with the Settings provider and `X-LLM-Key`; fall back to the built-in explainer on any error. Keep `server/agentApi.ts` only as an optional fallback, not the default path.

## Demo cache

`/analyze` answers are cached per request body. These are pre-recorded with real Gemini output and return instantly if the body matches the engine defaults (do not send `holdings` for the default demo book; default limits 0.10 / 0.02, mode `automatic`):

- `{"date": "2026-10-30", "agent": {"provider": "gemini"}}`
- `{"date": "2026-10-30", "agent": {"provider": "gemini", "live": true}}` (with news and sources)
- `{"date": "2026-10-29", "inject": {"NVDA": -0.15}, "agent": {"provider": "gemini"}}`

Any other field value makes a fresh call. `use_cache: false` forces one.

## Out of scope for now

Voice changes, a news section (the backend `/news` endpoint exists for later), the HEDGE path, and anything inside `engine/`. If the engine looks wrong, report it instead of changing it.

## Rules

- Never commit API keys; `.env.local` is git-ignored. A key typed in Settings stays in memory for the tab only.
- Keep the "simulated" labelling visible; this is a paper portfolio and not investment advice.

## Done when

- `npm run build` and `npm run lint` pass.
- With the engine running: What-if on 2026-10-30 with the agent on shows Gemini's explanation, the verification trail and the approval decision; with live news on it shows news and source links; the NVDA -15% what-if on 2026-10-29 returns instantly from cache.
- Asking "why did you sell AMD?" gets a Gemini answer through the engine's `/ask`.
- Without the engine, the app still runs on its built-in simulation.
- Your branch is pushed. Merge into `main` (the submission branch) and push once the flow works, telling the team when you do.
