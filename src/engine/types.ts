// Shared types. Jev-shaped request and response, so the engine does not care which judge ran.

export type Intent = 'none' | 'note' | 'task' | 'answer'

export interface Utterance {
  id: number
  text: string
  spokenAt: string
}

export interface WindowLabel {
  media: boolean
  climate: number
  intent: Intent
  performance: boolean
}

export interface Window {
  id: string
  startedAt: string
  endedAt: string
  place?: string
  chunkText?: string
  utterances: Utterance[]
  label?: WindowLabel
}

export type NoulQ = { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } }
export type ChoiceQ = { type: 'choice'; instructions: string; criteria: Record<string, string> }
export type ScoreQ = { type: 'score'; instructions: string; criteria: string[] }
export type Question = NoulQ | ChoiceQ | ScoreQ

export interface JudgeRequest {
  model: string
  state: unknown
  questions: Record<string, Question>
}

export type NoulA = { type: 'noul'; noul: number }
export type ChoiceA = { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence?: number }
export type ScoreA = { type: 'score'; score: number; probabilities: Record<string, number>; confidence?: number }
export type Answer = NoulA | ChoiceA | ScoreA

export interface JudgeResponse {
  model: string
  answers: Record<string, Answer>
  usage?: { input_tokens: number; output_tokens: number }
}

export interface Judgment {
  windowId: string
  judge: string
  latencyMs: number
  request: JudgeRequest
  response: JudgeResponse
}

export interface OpenQuestion {
  id: string
  runId: string
  text: string
  askedAt: string
}

// A recorded or live ring-1 agent run.
export interface AgentRun {
  taskWindowId: string
  task: string
  mode: 'plan' | 'acceptEdits'
  branch: string
  durationMs: number
  costUsd: number
  model: string
  question?: string
  resume?: { durationMs: number; costUsd: number; model: string; diffStat: string }
  diffStat?: string
  summary: string
  recorded: boolean
}

export type Ring = 0 | 1 | 2
export type Trust = 'shadow' | 'propose' | 'auto'

export interface EngineEvent {
  at: string
  windowId?: string
  ring?: Ring
  kind:
    | 'media.skipped'
    | 'note.saved'
    | 'agent.started'
    | 'agent.shadow'
    | 'agent.capped'
    | 'agent.question'
    | 'agent.resumed'
    | 'agent.result'
    | 'agent.binned'
    | 'pr.proposed'
    | 'pr.approved'
    | 'manners.hold'
    | 'manners.release'
    | 'exhale.nudge'
    | 'exhale.skip'
  text: string
  task?: string
  bee?: string
  runId?: string
  todoId?: string
  held?: boolean
}
