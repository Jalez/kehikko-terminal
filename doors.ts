import { MANIFEST } from './manifest.ts'
import { TICKET } from './shell.ts'
import { fromPage, readStanding, report, standing } from './trace.ts'

/**
 * The HTTP doors, which are four, because almost everything this module does
 * happens on a socket rather than on a request.
 *
 * The manifest, the health check, and the two that exist because of the freeze:
 * `GET /api/trace`, which prints what every layer of this module was doing in
 * the seconds before somebody looked, and `POST /api/trace/page`, which is how
 * the page tells this process it is still alive. Nothing here spawns.
 *
 * ## There used to be a third, and it was deleted for a reason that applies here
 *
 * `GET /api/chats` listed every Claude Code conversation on this machine, for a
 * sidebar that has since been cut. It went with it, and that was a small
 * security improvement rather than only a deletion: it was the one door here
 * that reported on somebody's own activity — what they had been working on, and
 * where. It carried no ticket, on the argument that a program running as this
 * user could read `~/.claude/projects` directly anyway. That argument was true
 * and it is better not to have needed it.
 *
 * `GET /api/trace` is the first door since then that reports on activity at
 * all, so the same question has to be answered rather than skipped.
 *
 * **What it says.** Counts, sizes, timings, pids, and the working directory
 * each shell was opened in. Not one byte of what anybody typed or what any
 * program printed — see the essay in `trace.ts`; the contents are the thing it
 * deliberately does not have, and the one switch that changes that
 * (`TERMINAL_TRACE_BYTES=1`) is off, is an environment variable somebody sets on
 * purpose, and is announced at the bottom of every report while it is on.
 *
 * **Why it carries no ticket.** Because the one command a person runs while
 * their terminal is frozen has to work, and the ticket is minted per process
 * into a page they cannot read when the page is the frozen half. A diagnostic
 * reachable only when you do not need it is not a diagnostic. Weigh that
 * against what is actually exposed: the working directory of a shell, which
 * this module already prints to its own stdout on every spawn, and which the
 * process list on this machine already carries.
 *
 * **What still fences it.** The same three things that fence everything else
 * here, and they are the ones that were ever load-bearing: the server is bound
 * to 127.0.0.1, so nothing on the network reaches it; there are no CORS headers
 * anywhere, so a page in another tab may send this GET and may not read the
 * answer; and the attacker who is left — a program already running as you —
 * could read all of it out of `ps` and this module's own log without asking.
 * The boundary is unchanged. It is worth writing down that it was checked
 * rather than assumed.
 *
 * **`POST /api/trace/page` does carry the ticket**, and that asymmetry is the
 * right way round. Reading a report changes nothing; writing into one is how
 * somebody else's page would fill this process's memory with lines of its own
 * choosing. The ticket is printed into this module's page, so its page has it
 * and nothing cross-origin does.
 */

export { TICKET } from './shell.ts'

export interface Reply {
  status: number
  body: unknown
  /** How to send it. `text` because a report somebody reads with `curl` should
      not need a second tool to make it legible. */
  type?: 'json' | 'text'
}

/** What a request brings with it, beyond its method and its path. */
export interface Asked {
  /** `?json` was on the query string. */
  json?: boolean
  /** The parsed body, for the one door that has one. */
  body?: unknown
  /** The ticket the body carried, if any. */
  ticket?: string
}

/**
 * Answer one request, or say this is not ours.
 *
 * `null` rather than a 404, so that Vite's own middleware keeps its chance at
 * the path. A module that 404'd everything it did not recognise would break its
 * own client, its own source, and its own HMR socket.
 */
export function answer(method: string, path: string, asked: Asked = {}): Reply | null {
  if (path === '/healthz') {
    if (method !== 'GET') {
      return {
        status: 405,
        body: { ok: false, error: `${path} answers GET, and this was a ${method}.` },
      }
    }
    return { status: 200, body: { ok: true, id: MANIFEST.id, version: MANIFEST.version } }
  }

  /*
   * The one command, and it is a GET so that it can BE one command.
   *
   * Plain text unless `?json` is asked for. The point of this door is that
   * somebody whose terminal has stopped can read the answer without piping it
   * through anything, from a shell that is not the frozen one.
   */
  if (path === '/api/trace') {
    if (method !== 'GET') {
      return { status: 405, body: { ok: false, error: `${path} answers GET, and this was a ${method}.` } }
    }
    if (asked.json) return { status: 200, body: standing(), type: 'json' }
    return { status: 200, body: report(), type: 'text' }
  }

  /*
   * The page saying it is still here.
   *
   * The reply is deliberately empty and always the same shape. This is not a
   * channel: nothing this process knows travels back on it. The container draws a
   * terminal, and a container that could read this module's trace would be one more
   * place the trace could leak from for no gain at all.
   */
  if (path === '/api/trace/page') {
    if (method !== 'POST') {
      return { status: 405, body: { ok: false, error: `${path} answers POST, and this was a ${method}.` } }
    }
    if (asked.ticket !== TICKET) {
      /* Deliberately not saying which part was wrong. The refusal to a caller
         with no ticket and to one with the wrong ticket is the same sentence,
         for the same reason the upgrade refusal in `shell.ts` is a bare 403. */
      return { status: 403, body: { ok: false, error: 'That did not carry this module’s ticket.' } }
    }
    const said = readStanding(asked.body)
    if (!said) return { status: 400, body: { ok: false, error: 'That was not a standing.' } }
    fromPage(said)
    return { status: 200, body: { ok: true } }
  }

  return null
}
