import type { Ring, Trust } from './types.ts'

// The rings live in config, not in the model. Code owns what may run; Jev only says what was heard.

export type ActionClass = 'note' | 'agent' | 'open_pr' | 'nudge'

export const RING_OF: Record<ActionClass, Ring> = {
  note: 0, // local intent.md line. Private, reversible, free.
  nudge: 0, // Bee todo with an alarm. Private, reversible, free.
  agent: 1, // headless coding agent in a git worktree on a branch. Reversible, costs compute.
  open_pr: 2, // leaves the machine. Never automatic.
}

// Ring 2 can never be promoted past 'propose'.
export const TRUST_CEILING: Record<Ring, Trust> = { 0: 'auto', 1: 'auto', 2: 'propose' }

export interface Policy {
  thresholds: { task: number; selfContained: number; note: number; media: number; answer: number; performance: number }
  answerWindowMin: number
  ring1MaxPerHour: number
  requireAddress: boolean
  addressWord: string
  manners: { alpha: number; holdAt: number; releaseBelow: number }
  exhale: { enabled: boolean; cooldownMin: number }
  trust: Record<ActionClass, Trust>
}

export const DEFAULT_POLICY: Policy = {
  thresholds: { task: 0.6, selfContained: 0.5, note: 0.5, media: 0.6, answer: 0.7, performance: 0.7 },
  answerWindowMin: 90,
  ring1MaxPerHour: 3,
  requireAddress: false,
  addressWord: 'ringfence',
  // Set by hand on one scripted day. They mean nothing until tuned on labelled real speech.
  manners: { alpha: 0.6, holdAt: 2.2, releaseBelow: 1.8 },
  exhale: { enabled: false, cooldownMin: 30 },
  // Demo setting: agent pre-promoted to auto (say so on camera). Day one for a real user: 'shadow'.
  trust: { note: 'auto', nudge: 'auto', agent: 'auto', open_pr: 'propose' },
}

export function clampTrust(cls: ActionClass, t: Trust): Trust {
  const order: Trust[] = ['shadow', 'propose', 'auto']
  const ceiling = TRUST_CEILING[RING_OF[cls]]
  return order.indexOf(t) > order.indexOf(ceiling) ? ceiling : t
}
