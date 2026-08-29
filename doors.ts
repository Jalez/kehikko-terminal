import { chats } from './chats.ts'
import { MANIFEST } from './manifest.ts'

/**
 * The HTTP doors, which are few, because almost everything this module does
 * happens on a socket rather than on a request.
 *
 * There are three: the manifest, the health check, and the chat list. Nothing
 * here writes, nothing here spawns, and nothing here carries a ticket — the
 * ticket guards the terminal, and the terminal is not reached through this
 * file.
 *
 * ## Why the chat list needs no ticket, and what that admits
 *
 * `GET /api/chats` tells the caller which conversations exist on this machine,
 * their directories, and the first line of each. That is not nothing: it is a
 * list of what somebody has been working on. It carries no ticket because a
 * ticket would not help — the fence that matters is the same one the whole
 * module relies on, which is that no CORS header is ever sent, so a page in
 * another tab may issue this request but may not read the answer.
 *
 * A program running as this user can read `~/.claude/projects` directly and
 * does not need this door. That is the same argument `shell.ts` makes about the
 * pty, and it has the same limit: it is an argument about a threat that already
 * won, not a reason the door is free.
 */

export { TICKET } from './shell.ts'

export interface Reply {
  status: number
  body: unknown
}

/**
 * Answer one request, or say this is not ours.
 *
 * `null` rather than a 404, so that Vite's own middleware keeps its chance at
 * the path. A module that 404'd everything it did not recognise would break its
 * own client, its own source, and its own HMR socket.
 */
export function answer(method: string, path: string): Reply | null {
  if (path === '/healthz') {
    if (method !== 'GET') return notAllowed(method, path)
    return { status: 200, body: { ok: true, id: MANIFEST.id, version: MANIFEST.version } }
  }

  if (path === '/api/chats') {
    if (method !== 'GET') return notAllowed(method, path)
    /*
     * Read on every request rather than cached.
     *
     * A chat list that is stale is worse than one that is slow: the whole point
     * of the pane is to reopen the thing you were just doing, and the thing you
     * were just doing is the newest file on disk. The read is a directory walk
     * plus a partial parse per file, which is cheap enough that caching it
     * would be trading correctness for nothing anybody can perceive.
     */
    return { status: 200, body: { chats: chats() } }
  }

  return null
}

function notAllowed(method: string, path: string): Reply {
  return {
    status: 405,
    body: {
      ok: false,
      error: `${path} answers GET, and this was a ${method}. Nothing in this module is written to over HTTP.`,
    },
  }
}
