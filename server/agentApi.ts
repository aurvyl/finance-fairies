import Anthropic from '@anthropic-ai/sdk'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

/**
 * Optional: answers open questions with Claude when ANTHROPIC_API_KEY (or another
 * credential the SDK understands) is set. Without one, /api/health reports
 * claude:false and the app uses its built-in explainer.
 *
 * The browser never sees the key; it sends only the question and a numeric
 * portfolio summary.
 */

const MODEL = 'claude-opus-5-5'

const SYSTEM = `You are the voice of Finance Fairies, an agent that manages a user's whole portfolio against portfolio-level guardrails (a maximum drop from the peak, and a daily loss limit).
You act automatically when a limit gets close and explain yourself when asked.
Answer the user's question using only the JSON context you are given. Quote the numbers from it.
Your answer will often be read aloud, so: two to four short sentences, plain spoken English, no lists, no markdown, no emoji.
If the context does not contain the answer, say so briefly and say what you can tell them instead.
Never give personalised investment advice beyond explaining the agent's rules and actions.`

function hasCredentials() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
}

let client: Anthropic | null = null

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
  if (req.url === '/api/health') return send(res, 200, { claude: hasCredentials() })
  if (req.url !== '/api/ask' || req.method !== 'POST') return next()
  if (!hasCredentials()) return send(res, 503, { error: 'Claude is not configured on this server.' })

  try {
    const { question, context } = await readJson(req)
    if (typeof question !== 'string' || !question.trim() || question.length > 1000) {
      return send(res, 400, { error: 'Ask a question of up to 1000 characters.' })
    }
    client ??= new Anthropic()
    const msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      // re-run a declined request on Anthropic's recommended fallback model
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Portfolio context (synthetic demo data):\n${JSON.stringify(context).slice(0, 20000)}\n\nQuestion: ${question}`,
        },
      ],
    } as Parameters<typeof client.beta.messages.create>[0] & { fallbacks: 'default' })
    if (!('content' in msg)) return send(res, 502, { error: 'Unexpected streaming response.' })
    if (msg.stop_reason === 'refusal') return send(res, 200, { answer: 'I can’t help with that one, but I can explain your guardrails or my recent trades.' })
    const answer = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => ('text' in b ? b.text : ''))
      .join(' ')
      .trim()
    return send(res, 200, { answer })
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return send(res, 429, { error: 'Claude is busy. Try again in a moment.' })
    if (err instanceof Anthropic.APIError) return send(res, 502, { error: `Claude API error ${err.status ?? ''}`.trim() })
    return send(res, 500, { error: 'Could not reach Claude.' })
  }
}

export function agentApi(): Plugin {
  return {
    name: 'finance-fairies-agent-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handle(req, res, next))
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handle(req, res, next))
    },
  }
}
