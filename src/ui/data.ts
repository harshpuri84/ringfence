import { useEffect, useState } from 'react'
import windowsJson from '../../fixtures/day.windows.json'
import runsJson from '../../fixtures/agent-runs.json'
import type { AgentRun, Judgment, Window } from '../engine/types.ts'

// What the dashboard draws: the scripted day, or the snapshot live mode serves on localhost.
export interface DayData {
  live: boolean
  windows: Window[]
  judgments: Record<string, Judgment>
  runs: Record<string, AgentRun>
  approvals: Record<string, string>
  judgeName: string
  updatedAt?: string
}

// Prefer Jev judgments when they exist; otherwise the labelled stand-in.
const files = import.meta.glob('../../fixtures/judgments.*.json', { eager: true, import: 'default' }) as Record<string, Record<string, Judgment>>
const judgeKey = Object.keys(files).find((k) => k.includes('.jev.')) ?? Object.keys(files).find((k) => k.includes('.standin.'))!

export const FIXTURE: DayData = {
  live: false,
  windows: windowsJson as Window[],
  judgments: files[judgeKey],
  runs: (runsJson as { runs: Record<string, AgentRun> }).runs,
  approvals: {},
  judgeName: Object.values(files[judgeKey])[0]?.judge ?? 'none',
}

export const LIVE_URL = 'http://localhost:5189/state'

// Polls live mode's snapshot every 2 s. Null until the first answer.
export function useLiveData(enabled: boolean): { data: DayData | null; error: string | null } {
  const [data, setData] = useState<DayData | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    let stopped = false
    const poll = async () => {
      try {
        const r = await fetch(LIVE_URL)
        if (!r.ok) throw new Error(`${r.status}`)
        const d = (await r.json()) as DayData
        if (!stopped) { setData({ ...d, live: true }); setError(null) }
      } catch (e) {
        if (!stopped) setError((e as Error).message)
      }
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => { stopped = true; clearInterval(id) }
  }, [enabled])
  return { data, error }
}
