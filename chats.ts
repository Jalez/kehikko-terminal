import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Every Claude Code conversation on this machine, read off the disk it is
 * already written to.
 *
 * ## Why the disk and not a registry
 *
 * Claude Code writes each conversation as JSONL under
 * `~/.claude/projects/<slugged-cwd>/<session-id>.jsonl`, and it does that
 * whether or not anything is watching. So a session somebody started in their
 * own terminal an hour ago reads exactly as well as one started from this pane
 * a second ago, and this module needs nothing to have announced itself. A
 * registry of sessions that opted in would show neither — that argument is the
 * orchestrator's, in its `transcript.ts`, and it is right; this file borrows it
 * whole rather than restating it differently.
 *
 * ## The directory name is a mangled path, and it cannot be unmangled
 *
 * `/Users/jo/Projects/roadmap` becomes `-Users-jo-Projects-roadmap`. Every `/`
 * became `-`, and so did every `-` that was already there — the mapping is not
 * injective, so `my-app` and `my/app` land in the same place and there is no
 * way back from the slug alone. Guessing would mean spawning a shell in the
 * wrong repository, which is exactly the failure the orchestrator's `scope.ts`
 * calls "an agent editing the wrong repository".
 *
 * So the path is taken from INSIDE the transcript instead. Every row Claude
 * Code writes carries a `cwd`, which is the real absolute path, unmangled and
 * unambiguous. The slug is used for nothing but grouping files, and where no
 * row carries a cwd the chat is still listed and simply has no directory — a
 * chat you can read about but not resume, said out loud rather than hidden.
 */

export type { Chat } from './src/chats-shape.ts'
import type { Chat } from './src/chats-shape.ts'

/** Where Claude Code keeps them. Overridable so the tests do not read yours. */
export function projectsDir(home: string = homedir()): string {
  return join(home, '.claude', 'projects')
}

const OPENING_CLIP = 140

/**
 * Read one transcript far enough to describe it, and no further.
 *
 * A long conversation is megabytes and this list may hold dozens of them, so
 * the whole file is deliberately not parsed: rows are walked until the first
 * human turn is found, and after that only counted. The count is a `split`
 * rather than a parse for the same reason.
 *
 * Nothing here throws. A transcript being written to WHILE this reads it ends
 * mid-line and yields one unparseable row, which is ordinary rather than
 * exceptional — a chat that is live is the most interesting kind to list, and
 * refusing to describe it because its last line is half-written would hide
 * exactly the wrong ones.
 */
export function describe(file: string): { cwd: string | null; rows: number; opening: string } | null {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const lines = text.split('\n')
  let cwd: string | null = null
  let opening = ''
  let rows = 0

  for (const line of lines) {
    if (!line.trim()) continue
    rows += 1
    /* Stop LOOKING once both are found, but keep counting. The two facts are
       usually in the first row or two; the count needs every line. */
    if (cwd !== null && opening !== '') continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof row !== 'object' || row === null) continue
    const held = row as Record<string, unknown>
    if (cwd === null && typeof held.cwd === 'string' && held.cwd) cwd = held.cwd
    if (opening === '') opening = humanTurn(held)
  }

  return { cwd, rows, opening }
}

/**
 * The words a person typed, out of one row, or empty for every other row.
 *
 * Written defensively on purpose. This reads a file format belonging to another
 * program, which is free to change it without telling this one, and the failure
 * that matters is not an exception — it is this list quietly showing an empty
 * label for every chat because a field moved. Hence: several shapes accepted,
 * and a comment saying so, rather than one shape asserted.
 *
 * Rows whose content is a tool result are skipped. They are recorded as user
 * turns because that is who they are addressed to, but nobody typed them, and a
 * list captioned with the output of somebody's last grep would be useless.
 */
function humanTurn(row: Record<string, unknown>): string {
  if (row.type !== 'user') return ''
  const message = row.message
  if (typeof message !== 'object' || message === null) return ''
  const content = (message as Record<string, unknown>).content

  if (typeof content === 'string') return clip(content)

  if (Array.isArray(content)) {
    for (const piece of content) {
      if (typeof piece !== 'object' || piece === null) continue
      const part = piece as Record<string, unknown>
      /* A tool result is addressed to the person and written by a program. */
      if (part.type === 'tool_result') return ''
      if (part.type === 'text' && typeof part.text === 'string') return clip(part.text)
    }
  }
  return ''
}

function clip(text: string): string {
  const tidy = text.replace(/\s+/g, ' ').trim()
  if (!tidy) return ''
  /* A command typed at the prompt is not a sentence somebody wrote, and a list
     of chats all captioned "/clear" tells a reader nothing. Kept anyway rather
     than dropped, because it is still what happened first. */
  return tidy.length > OPENING_CLIP ? tidy.slice(0, OPENING_CLIP - 1) + '…' : tidy
}

/**
 * Every chat, newest first.
 *
 * Ordered by the file's own mtime rather than by anything inside it, because
 * mtime is the one fact that is true of a conversation still being written. A
 * timestamp parsed out of the last row would be the last row that was COMPLETE,
 * which for a live chat is a moment in the past that stops advancing.
 *
 * A directory that cannot be read is skipped rather than fatal: this walks
 * someone's home directory, and one unreadable folder should not empty the
 * list.
 */
export function chats(dir: string = projectsDir(), limit = 200): Chat[] {
  let slugs: string[]
  try {
    slugs = readdirSync(dir)
  } catch {
    /* No `~/.claude/projects` at all. Not an error: it is what a machine that
       has never run Claude Code looks like, and the page says so in words. */
    return []
  }

  const found: Chat[] = []
  for (const slug of slugs) {
    let files: string[]
    try {
      files = readdirSync(join(dir, slug))
    } catch {
      continue
    }
    for (const name of files) {
      if (!name.endsWith('.jsonl')) continue
      const file = join(dir, slug, name)
      let touched: number
      try {
        touched = statSync(file).mtimeMs
      } catch {
        continue
      }
      const read = describe(file)
      if (!read) continue
      found.push({
        id: name.slice(0, -'.jsonl'.length),
        cwd: read.cwd,
        touched,
        rows: read.rows,
        opening: read.opening,
      })
    }
  }

  found.sort((a, b) => b.touched - a.touched)
  return found.slice(0, limit)
}
