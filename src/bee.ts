// Every Bee call Ringfence makes, through Bee's own library.
// `command: 'bee'` uses the global binary: a local install's postinstall is blocked by modern npm (FRICTION-LOG F4).
import { createBeeClient } from '@beeai/cli/lib'

const bee = createBeeClient({ command: process.env.BEE_COMMAND ?? 'bee' })

export interface BeeTodo { id: number; text: string; completed: boolean; alarm_at?: number | null }

export async function createTodo(text: string, alarmAt?: string): Promise<BeeTodo> {
  const out = await bee.api.todos.create<BeeTodo | { todo: BeeTodo }>({ text, ...(alarmAt ? { alarmAt } : {}) })
  return 'todo' in out ? out.todo : out
}

// The changefeed. Todo ticks show up here; the stream never sends todo events (tested 25 Sep 2026).
export async function changedSince(cursor?: string): Promise<{ cursor: string; todos: BeeTodo[] }> {
  const j = await bee.api.changed<{ meta: { next_cursor: string }; todos?: BeeTodo[] }>(cursor ? { cursor } : {})
  return { cursor: j.meta.next_cursor, todos: j.todos ?? [] }
}
