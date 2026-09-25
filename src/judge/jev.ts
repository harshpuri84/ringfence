// Jev over the TypeSafe HTTP API. Contract from https://docs.typesafe.ai/api.md (read 2026-09-24).
import type { JudgeRequest, JudgeResponse } from '../engine/types.ts'

const URL_ = 'https://api.typesafe.ai/v1/systemone'

export async function jev(req: JudgeRequest, key = process.env.TYPESAFE_API_KEY): Promise<JudgeResponse> {
  if (!key) throw new Error('TYPESAFE_API_KEY is not set. Get one at https://console.typesafe.ai/settings/keys and put it in .env')
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(URL_, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
    if (r.ok) return (await r.json()) as JudgeResponse
    if ((r.status === 429 || r.status === 529) && attempt < 4) {
      await new Promise((res) => setTimeout(res, 500 * 2 ** attempt))
      continue
    }
    throw new Error(`Jev ${r.status}: ${(await r.text()).slice(0, 300)}`)
  }
}
