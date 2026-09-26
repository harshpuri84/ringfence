// The todos Ringfence wrote to your Bee account: every todo whose text starts with "[ringfence".
//   node scripts/todos.ts            # list them. Read-only.
//   node scripts/todos.ts --delete   # delete those todos and no others. Run it yourself; deleting cannot be undone.
import { createBeeClient } from '@beeai/cli/lib'

interface Todo { id: number; text: string; completed: boolean; created_at: number }
const bee = createBeeClient({ command: process.env.BEE_COMMAND ?? 'bee' })
const mine: Todo[] = []
let cursor: string | undefined
do {
  const page = await bee.api.todos.list<{ todos: Todo[]; next_cursor?: string }>({ limit: 50, ...(cursor ? { cursor } : {}) })
  mine.push(...page.todos.filter((t) => t.text.startsWith('[ringfence')))
  cursor = page.next_cursor || undefined
} while (cursor)

for (const t of mine) console.log(`${t.id}  ${t.completed ? 'done' : 'open'}  ${t.text}`)
console.log(`${mine.length} Ringfence todo${mine.length === 1 ? '' : 's'}, ${mine.filter((t) => !t.completed).length} open`)
if (process.argv.includes('--delete')) {
  for (const t of mine) await bee.api.todos.delete(t.id)
  console.log(`deleted ${mine.length}`)
} else if (mine.length) console.log('add --delete to remove them')
