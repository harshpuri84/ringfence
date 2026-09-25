import type { JudgeRequest, OpenQuestion, Question, Window } from './types.ts'

// One Jev request per window. All questions run in parallel over the same state.
// Speculative questions (task_line, answer_to) are asked every time; code only reads them when they apply.

export const CLIMATE_LEVELS = [
  'Relaxed or light: joking, casual chat, calm reflection, no pressure mentioned.',
  'Ordinary working focus: neutral planning or problem solving, no strain expressed.',
  'Pressured: deadlines, being behind, or urgency are mentioned, but people stay composed.',
  'Tense: frustration, irritation, conflict, or feeling overwhelmed is expressed openly.',
  'Acute distress: panic, anger, crying, or statements of not coping.',
]

export function buildRequest(
  w: Window,
  ctx: { previousSummary?: string; openQuestions: OpenQuestion[]; now: string },
  model = 'jev-latest',
): JudgeRequest {
  const minutesAgo = (iso: string) => Math.max(0, Math.round((Date.parse(ctx.now) - Date.parse(iso)) / 60000))
  const state = {
    listener: 'One person wears a microphone all day. Speakers are not identified, and media playing nearby is also transcribed.',
    window: {
      time: w.startedAt.slice(11, 16),
      segment_summary: w.chunkText ?? null,
      utterances: w.utterances.map((u, i) => ({ id: `u${i}`, text: u.text })),
    },
    previous_segment_summary: ctx.previousSummary ?? null,
    open_questions: ctx.openQuestions.map((q) => ({ id: q.id, question: q.text, asked_minutes_ago: minutesAgo(q.askedAt) })),
  }

  const intentCriteria: Record<string, string> = {
    none: 'Nothing to act on: chat, narration, media, feelings, or thinking aloud with no request.',
    note: "An idea, opinion, reminder or wish with no request to do work now (for example 'someone should', 'it would be nice if', 'remind me to').",
    task: "A direct, specific request for software work to be done now, phrased as an instruction that names a target (for example 'add a retry to the stream client').",
  }
  if (ctx.openQuestions.length) intentCriteria.answer = 'A reply to one of the questions in `open_questions`.'

  const lineCriteria: Record<string, string> = { none: 'No utterance states a request for work.' }
  w.utterances.forEach((u, i) => (lineCriteria[`u${i}`] = `The request for work is stated in utterance ${i}: "${u.text}"`))

  const questions: Record<string, Question> = {
    intent: {
      type: 'choice',
      instructions: 'What, if anything, in `window.utterances` should a software assistant act on? Treat media playback as nothing to act on.',
      criteria: intentCriteria,
    },
    task_line: {
      type: 'choice',
      instructions: 'If `window.utterances` contains a direct request for software work, which utterance states it?',
      criteria: lineCriteria,
    },
    task_self_contained: {
      type: 'noul',
      instructions: 'If `window.utterances` contains a request for software work, does that request name what to change (a file, feature, command or behaviour) clearly enough that someone with no other context could start on it?',
      criteria: {
        true: "Self-contained: names its target, e.g. 'add a retry with backoff to the stream client'.",
        false: "A fragment or a reply that only makes sense next to something else, e.g. 'five attempts, go ahead', or no request at all.",
      },
    },
    media: {
      type: 'noul',
      instructions: 'Is `window.utterances` most likely audio from media playing nearby (a video, podcast, TV show, song or advert) rather than a live conversation or someone thinking aloud?',
      criteria: { true: 'Media playback: narration, presenter or advert voice, scripted drama.', false: 'Live speech by people present.' },
    },
    climate: {
      type: 'score',
      instructions: 'Rate the emotional climate of the live speech in `window.utterances`, as it would feel to someone present.',
      criteria: CLIMATE_LEVELS,
    },
    performance: {
      type: 'noul',
      instructions: 'Does someone in `window.utterances` say they are about to present, pitch, interview, perform or face a high-stakes moment within the next hour?',
    },
  }

  if (ctx.openQuestions.length) {
    const c: Record<string, string> = { none: 'The window does not answer any open question.' }
    for (const q of ctx.openQuestions) c[q.id] = `The window answers open question ${q.id}: "${q.text}"`
    questions.answer_to = {
      type: 'choice',
      instructions: 'Does `window.utterances` give an answer to one of `open_questions`? Pick the question it answers.',
      criteria: c,
    }
  }

  return { model, state, questions }
}
