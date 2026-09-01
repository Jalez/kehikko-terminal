import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { homedir, userInfo } from 'node:os'
import type { Duplex } from 'node:stream'

/**
 * A real terminal, and the fence in front of it.
 *
 * ## The objection this answers
 *
 * The orchestrator module refused to build this, and wrote down why
 * (`kehikko-orchestrator/transcript.ts`, around line 35):
 *
 *   "A websocket that carries keystrokes into a shell is a shell on this
 *    machine reachable by anything that can reach this port — and loopback is a
 *    fence around the machine, not around the programs on it."
 *
 * That sentence is true and is not deleted here. What follows is the part it
 * leaves out, which changes what the fence has to be.
 *
 * There are two attackers, and only one of them is real.
 *
 * **A hostile web page in another tab.** This is the one that matters, and it
 * is the one that is actually stoppable. A browser always sends `Origin` on a
 * WebSocket handshake and page JavaScript cannot forge it, so an origin check
 * refuses `https://evil.example` outright. It cannot read a ticket out of this
 * module's page either, because this module serves no CORS headers at all —
 * a cross-origin `fetch` may be sent but its response may not be read. And a
 * `Host` check closes DNS rebinding, which is the clever way around both.
 *
 * **Another program already running as this user.** Loopback does not fence
 * this one, exactly as the orchestrator says. But the conclusion does not
 * follow, because a process running as you can already run `claude`, or `rm`,
 * or anything else — it does not need this port to do it. This socket hands
 * such a program NO privilege it did not already hold. It is not a hole; it is
 * a door into a room whose walls that attacker is already inside.
 *
 * So the fence is: loopback bind, `Origin` and `Host` checked on upgrade, and a
 * ticket the page is served with. What it does NOT do — and this is the part a
 * README must not fudge — is protect you from software already running under
 * your own account. Nothing at this layer can, and a desktop app with an IPC
 * channel instead of a socket would only move that same boundary.
 *
 * ## The ticket is per-process, not per-connection
 *
 * One string, minted at start, embedded in the page. Not single-use, because a
 * container legitimately opens many terminals over its life and a one-shot ticket
 * would mean a round trip before every one of them for no gain: an attacker who
 * can read the ticket once can read it again, since it comes from the same
 * place. It dies with the process, so it cannot outlive the program it
 * authorises.
 */

export const TICKET = randomUUID()

/** How long a connection may stay silent before it has proved itself. */
const MUST_SPEAK_WITHIN = 5_000

/** What the shell is told it is, so programs inside it behave. */
const TERM = 'xterm-256color'

export interface Fenced {
  ok: boolean
  /** Why not, in words a person can act on. Empty when ok. */
  why: string
}

/**
 * Is this handshake coming from this module's own page?
 *
 * Both spellings of loopback are accepted because they are genuinely different
 * origins to a browser and a person may have opened either. Everything else is
 * refused, including a missing `Origin` — a WebSocket from a browser always has
 * one, so its absence means the caller is not a browser, and a caller that is
 * not a browser is not this module's page.
 *
 * `Host` is checked against the same list for DNS rebinding: a name that
 * resolves to 127.0.0.1 would otherwise let a page on `evil.example` reach this
 * port with its own origin intact.
 */
export function fenced(
  headers: { origin?: string; host?: string },
  port: number,
): Fenced {
  const allowed = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`])

  const origin = headers.origin
  if (!origin) {
    return {
      ok: false,
      why: 'That handshake carried no Origin. Every browser sends one, so this did not come from a page.',
    }
  }
  if (!allowed.has(origin)) {
    return { ok: false, why: `${origin} is not this module's own page, and only its own page may open a terminal.` }
  }

  const host = headers.host
  if (!host || !allowed.has(`http://${host}`)) {
    return {
      ok: false,
      why: `That request asked for host ${host ?? '(none)'}, which is not this module's address. A name that resolves here is still not here.`,
    }
  }

  return { ok: true, why: '' }
}

/** The first frame a client must send, before anything is spawned. */
export interface Opening {
  ticket: string
  /** Where to start. Null means the user's home directory. */
  cwd: string | null
  cols: number
  rows: number
}

/**
 * Read the opening frame, refusing anything that is not one.
 *
 * Returns a string when it is not acceptable — the sentence to close the socket
 * with. The ticket is compared before anything else is looked at, and compared
 * whole rather than by prefix.
 */
export function opening(raw: unknown, ticket: string = TICKET): Opening | string {
  if (typeof raw !== 'string') return 'The first frame must be text.'
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'The first frame must be JSON naming a ticket.'
  }
  if (typeof parsed !== 'object' || parsed === null) return 'The first frame must be a JSON object.'
  const held = parsed as Record<string, unknown>

  if (typeof held.ticket !== 'string' || held.ticket !== ticket) {
    return 'That did not carry this module’s ticket. The ticket is printed into the page this module serves, and only that page has it.'
  }

  const cols = Number(held.cols)
  const rows = Number(held.rows)
  return {
    ticket,
    cwd: typeof held.cwd === 'string' && held.cwd ? held.cwd : null,
    /* Clamped rather than trusted. A pty told it is one column wide wraps every
       character onto its own line; told it is a million, programs allocate for
       it. Neither is worth crashing over, and neither is worth obeying. */
    cols: Number.isFinite(cols) ? Math.min(500, Math.max(20, Math.trunc(cols))) : 80,
    rows: Number.isFinite(rows) ? Math.min(200, Math.max(5, Math.trunc(rows))) : 24,
  }
}

/**
 * The command a new terminal runs.
 *
 * The user's own login shell, interactive, exactly as a terminal emulator would
 * start it — this is a terminal, not a launcher for one program. `claude` is
 * something you type in it, and the chat list types it for you.
 *
 * `-i` and no `-l`: an interactive shell reads the rc file people actually put
 * their aliases and PATH in, and a login shell additionally re-runs profile
 * files that assume they are running once at login. Terminal emulators differ
 * on this; interactive-only is the choice that surprises fewest people.
 */
export function command(shell: string = userInfo().shell || '/bin/zsh'): { file: string; args: string[] } {
  return { file: shell, args: ['-i'] }
}

export interface Live {
  /** Kill the process and everything it started. */
  close: () => void
}

/**
 * Attach the terminal to an HTTP server's upgrade event.
 *
 * `noServer` and a manual upgrade rather than letting `ws` own the port,
 * because the port belongs to Vite: a module is ONE ORIGIN, and a second
 * listener would make this module's own terminal cross-origin to its own page.
 *
 * Everything native is imported lazily, inside the handler. `node-pty` and `ws`
 * are native and CommonJS respectively, and importing them at module scope
 * would drag them into anything that imports this file — including the tests,
 * which are about the fence and must run without a compiled binary present.
 */
/**
 * A close reason short enough that closing does not throw.
 *
 * The WebSocket protocol caps a close reason at **123 bytes**, and `ws`
 * enforces it by throwing — inside the `message` handler, where there is
 * nothing to catch it, so the throw reaches the top and takes the whole Vite
 * process with it.
 *
 * This module found that the hard way. The refusal sentences here are written
 * to be read by a person, which makes them long, and the ticket refusal is 150
 * bytes. So sending a wrong ticket did not get you refused: it killed the
 * server, for everybody, from an unauthenticated frame. The careful prose was
 * the bug.
 *
 * Clipped by BYTES and not by characters, because these sentences contain `—`
 * and `’`, which are three bytes each — a character count would pass its own
 * check and still throw. Cut on a codepoint boundary so the result is not
 * invalid UTF-8, which `ws` would also refuse.
 *
 * The full sentence still goes to the log. The socket gets the short form; the
 * person running the module gets the whole thing.
 */
export function sayable(reason: string, limit = 123): string {
  const bytes = Buffer.from(reason, 'utf8')
  if (bytes.length <= limit) return reason
  let cut = limit
  /* Back off to a codepoint boundary: continuation bytes are 0b10xxxxxx. */
  while (cut > 0 && ((bytes[cut] ?? 0) & 0xc0) === 0x80) cut -= 1
  return Buffer.from(bytes.subarray(0, cut)).toString('utf8')
}

/**
 * The least a server has to be for this to attach to it.
 *
 * Not `http.Server`, and that is not fussiness: Vite's `httpServer` is typed as
 * possibly an HTTP/2 server, which is not assignable to it. Naming the one
 * event this actually uses is both honest and portable — nothing here touches a
 * server's timeouts, its headers, or its sockets except the one it is handed.
 */
export interface Upgradable {
  on(
    event: 'upgrade',
    listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown
}

/**
 * Where a shell may actually be opened.
 *
 * The page asks for the open project's folder, so that a terminal beside a
 * project does not begin with the same `cd` every time. What arrives here is
 * still a string off a socket, and `spawn` with a directory that does not exist
 * fails in a way nobody can read: node-pty throws from inside the fork, the
 * socket closes with a message about a file, and the container says the shell
 * would not start. The path is the thing that was wrong and nothing would have
 * said so.
 *
 * So the answer is checked before it is used, and the fallback is the home
 * directory — which is where every shell opened before any of this, so falling
 * back is the old behaviour rather than a new failure.
 *
 * It is deliberately NOT confined to a root. The fence around this socket is
 * the ticket and the origin check in `fenced`, and past those the caller is
 * this module's own page; a person who can reach it can already type `cd`
 * anywhere the shell can go. A confinement here would suggest a boundary the
 * shell itself does not have.
 */
export function openable(asked: string | null, fallback = homedir()): string {
  if (!asked) return fallback
  try {
    return statSync(asked).isDirectory() ? asked : fallback
  } catch {
    /* Gone, unreadable, or never there. All the same answer. */
    return fallback
  }
}

export function serveTerminals(server: Upgradable, port: number, log: (line: string) => void): void {
  void (async () => {
    const { WebSocketServer } = await import('ws')
    const sockets = new WebSocketServer({ noServer: true })

    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
      /* Vite's own HMR websocket shares this server. Anything not ours is left
         alone rather than refused — refusing it would break the dev client. */
      if (url.pathname !== '/terminal') return

      const gate = fenced(
        { origin: request.headers.origin, host: request.headers.host },
        port,
      )
      if (!gate.ok) {
        log(`terminal: refused an upgrade — ${gate.why}`)
        /* A bare 403 and no websocket. The reason is logged here and not sent:
           the caller failed a check about who it is, and telling it which check
           it failed is telling it what to send next. */
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }

      sockets.handleUpgrade(request, socket, head, (ws) => {
        void hold(ws, log)
      })
    })

    log(`terminal: ready on ws://127.0.0.1:${port}/terminal`)
  })().catch((error: unknown) => {
    log(`terminal: could not start — ${error instanceof Error ? error.message : String(error)}`)
  })
}

/**
 * One connection, from silence to a running shell to a dead one.
 *
 * The socket is open before the ticket has been seen, which is unavoidable —
 * a browser cannot put a header on a WebSocket handshake, and a ticket in the
 * URL would be a secret in a query string, which is the one place secrets are
 * most reliably written to somebody's logs. So the socket opens, and NOTHING is
 * spawned until the first frame proves itself. A connection that never speaks
 * is closed.
 */
async function hold(ws: import('ws').WebSocket, log: (line: string) => void): Promise<void> {
  let pty: import('node-pty').IPty | null = null

  /* Closing must not be able to throw. Every call goes through here, because
     this is a `ws` handler and an exception in one reaches the top of the
     process — see `sayable`. */
  const shut = (code: number, reason: string) => {
    try {
      ws.close(code, sayable(reason))
    } catch {
      /* Already closing, or a code `ws` will not send. Either way the socket is
         going; there is nothing left to say on it. */
      try {
        ws.terminate()
      } catch {
        /* Gone. */
      }
    }
  }

  const silent = setTimeout(() => {
    if (!pty) shut(4408, 'nothing was said')
  }, MUST_SPEAK_WITHIN)

  const stop = () => {
    clearTimeout(silent)
    if (!pty) return
    const doomed = pty
    pty = null
    /*
     * The process AND everything it started.
     *
     * `pty.kill()` signals the process; the shell's children are in the same
     * process group and get SIGHUP when the pty closes, which is how a real
     * terminal window ends its jobs. The explicit group kill is a belt on top,
     * because a child that detached itself would otherwise outlive the container
     * that started it and there would be no way left to reach it.
     */
    try {
      process.kill(-doomed.pid, 'SIGHUP')
    } catch {
      /* Already gone, or never had its own group. Nothing to do and nothing
         worth saying — this runs on every close, including the ordinary one. */
    }
    try {
      doomed.kill()
    } catch {
      /* Same. */
    }
  }

  ws.on('message', (data: unknown) => {
    const text = typeof data === 'string' ? data : String(data)

    if (!pty) {
      clearTimeout(silent)
      const said = opening(text)
      if (typeof said === 'string') {
        log(`terminal: ${said}`)
        shut(4403, said)
        return
      }
      void (async () => {
        try {
          const nodePty = await import('node-pty')
          const { file, args } = command()
          const where = openable(said.cwd)
          pty = nodePty.spawn(file, args, {
            name: TERM,
            cols: said.cols,
            rows: said.rows,
            cwd: where,
            env: { ...process.env, TERM },
          })
          pty.onData((chunk: string) => {
            if (ws.readyState === ws.OPEN) ws.send(chunk)
          })
          pty.onExit(({ exitCode }: { exitCode: number }) => {
            if (ws.readyState === ws.OPEN) shut(4000, `the shell exited (${exitCode})`)
          })
          log(`terminal: a shell in ${where}`)
        } catch (error: unknown) {
          const why = error instanceof Error ? error.message : String(error)
          log(`terminal: could not start a shell — ${why}`)
          shut(4500, 'a shell could not be started on this machine')
        }
      })()
      return
    }

    /*
     * Every frame after the opening one is an envelope, and that is not
     * ceremony — it is the fix for a bug this had first.
     *
     * The first cut sent keystrokes as bare text and marked a resize with a
     * leading space. But a keystroke CAN be a space: typing " ls" sends exactly
     * that frame, which would have been read as a malformed resize and
     * swallowed. A person would have watched a leading space go missing,
     * occasionally, with nothing in any log, and would reasonably have blamed
     * the terminal emulator.
     *
     * There is no prefix a keyboard cannot produce, so there is no prefix-based
     * answer. Everything is wrapped instead: `d` is data, `r` is a resize, and
     * a frame that is neither is DROPPED rather than typed — feeding an
     * unrecognised control frame into somebody's shell is worse than ignoring
     * it.
     */
    let said: unknown
    try {
      said = JSON.parse(text)
    } catch {
      return
    }
    if (typeof said !== 'object' || said === null) return
    const frame = said as Record<string, unknown>

    if (typeof frame.d === 'string') {
      pty.write(frame.d)
      return
    }

    if (typeof frame.r === 'object' && frame.r !== null) {
      const size = frame.r as { cols?: unknown; rows?: unknown }
      const cols = Math.min(500, Math.max(20, Math.trunc(Number(size.cols) || 80)))
      const rows = Math.min(200, Math.max(5, Math.trunc(Number(size.rows) || 24)))
      try {
        pty.resize(cols, rows)
      } catch {
        /* A resize the pty refuses is dropped. The alternative is closing
           somebody's shell because a number arrived wrong. */
      }
    }
  })

  ws.on('close', stop)
  ws.on('error', stop)
}
