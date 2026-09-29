// Jev over the TypeSafe HTTP API. Contract from https://docs.typesafe.ai/api.md (read 2026-09-24, rechecked 2026-09-26).
// Two ways in, same request and response: a TypeSafe key, or a Vercel AI Gateway key on the gateway's
// TypeSafe-compatible endpoint (https://vercel.com/docs/ai-gateway/models-and-providers/evaluation-fallbacks).
import type { JudgeRequest, JudgeResponse } from '../engine/types.ts'

const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone'
const GATEWAY_URL = 'https://ai-gateway.vercel.sh/typesafe/v1/systemone'

export function jevRoute(env = process.env): { url: string; key: string; via: string } | null {
  if (env.TYPESAFE_API_KEY) return { url: TYPESAFE_URL, key: env.TYPESAFE_API_KEY, via: 'TypeSafe' }
  if (env.AI_GATEWAY_API_KEY) return { url: GATEWAY_URL, key: env.AI_GATEWAY_API_KEY, via: 'Vercel AI Gateway' }
  return null
}

export const NO_JEV_KEY = 'No Jev key. Put TYPESAFE_API_KEY or AI_GATEWAY_API_KEY (a Vercel AI Gateway key) in .env, or run with --standin.'

export async function jev(req: JudgeRequest, route = jevRoute()): Promise<JudgeResponse> {
  if (!route) throw new Error(NO_JEV_KEY)
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(route.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${route.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(30_000),
    })
    if (r.ok) return (await r.json()) as JudgeResponse
    if ((r.status === 429 || r.status === 529) && attempt < 4) {
      await new Promise((res) => setTimeout(res, 500 * 2 ** attempt))
      continue
    }
    throw new Error(`Jev ${r.status} via ${route.via}: ${(await r.text()).slice(0, 300)}`)
  }
}
