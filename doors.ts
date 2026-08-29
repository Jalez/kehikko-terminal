import { MANIFEST } from './manifest.ts'

/**
 * The HTTP doors, which are two, because almost everything this module does
 * happens on a socket rather than on a request.
 *
 * The manifest and the health check. Nothing here writes, nothing here spawns,
 * and nothing here carries a ticket — the ticket guards the terminal, and the
 * terminal is not reached through this file.
 *
 * ## There used to be a third
 *
 * `GET /api/chats` listed every Claude Code conversation on this machine, for a
 * sidebar that has since been cut. It is gone with it, and that is a small
 * security improvement rather than only a deletion: it was the one door here
 * that reported on somebody's own activity — what they had been working on, and
 * where. It carried no ticket, on the argument that a program running as this
 * user could read `~/.claude/projects` directly anyway. That argument was true
 * and it is better not to have needed it.
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
    if (method !== 'GET') {
      return {
        status: 405,
        body: {
          ok: false,
          error: `${path} answers GET, and this was a ${method}. Nothing in this module is written to over HTTP.`,
        },
      }
    }
    return { status: 200, body: { ok: true, id: MANIFEST.id, version: MANIFEST.version } }
  }

  return null
}
