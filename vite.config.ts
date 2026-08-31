import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { WELL_KNOWN } from 'roadmap-module-protocol'
import { serves } from 'roadmap-module-protocol/serve'
import { defineConfig, type Plugin } from 'vite'

import { answer } from './doors.ts'
import { ID, MANIFEST, PREFERRED_PORT } from './manifest.ts'
import { page } from './page.ts'
import { TICKET, serveTerminals } from './shell.ts'

/**
 * The port this process actually ended up on, which is not knowable here.
 *
 * `serves()` decides it — preferring `$PORT`, then `PREFERRED_PORT` — and if
 * something else holds that address it moves to the next free one. So this
 * starts as the preference and is CORRECTED below, inside `listening`, from
 * `httpServer.address()`.
 *
 * Getting that wrong is not cosmetic in this module. `fenced()` in `shell.ts`
 * accepts a handshake only when its `Origin` and `Host` name this server's own
 * port; a fence holding a stale 7920 while the server answers on 7921 refuses
 * this module's own page, and the symptom is a container that draws and opens no
 * shell. So nothing reads this until the socket is up.
 */
let bound = PREFERRED_PORT

/**
 * Every door this module answers on, plus the socket, served by the one process
 * that serves the page.
 *
 * ## Why they cannot be a second server
 *
 * A module is ONE ORIGIN or it is nothing: the protocol refuses a manifest
 * whose `entry` points anywhere but the origin that served the manifest, and it
 * is right to — a program that could name somebody else's page would be a
 * program that could have the host frame somebody else.
 *
 * Here that argument reaches the WebSocket too, and it is the reason
 * `serveTerminals` attaches to Vite's own HTTP server with `noServer` instead
 * of listening on a port of its own. A terminal socket on 7921 would be
 * cross-origin to this page, which would put it outside the very origin check
 * that is holding the fence up. The socket has to live where the page lives.
 */
function doors(): Plugin {
  return {
    name: 'terminal-doors',
    configureServer(server) {
      const http = server.httpServer
      if (!http) {
        server.config.logger.error(
          'terminal: no HTTP server to attach the terminal socket to. The container will load and no shell will ever open.',
        )
      } else {
        /* After `listening`, not before, because the fence needs the port this
           server BOUND rather than the one it asked for — see `bound` above.
           Nothing can arrive on the socket before the server is listening, so
           attaching the upgrade handler here costs nothing. */
        http.once('listening', () => {
          const address = http.address()
          if (address && typeof address === 'object') bound = address.port
          serveTerminals(http, bound, (line) => server.config.logger.info(line))
        })
      }

      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', `http://127.0.0.1:${bound}`)
        const path = url.pathname
        const method = (request.method ?? 'GET').toUpperCase()

        const send = (status: number, body: unknown) => {
          response.statusCode = status
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(JSON.stringify(body, null, 2))
        }

        /* Spelled by the protocol package so that this module and every host
           cannot disagree about it by a character. */
        if (path === WELL_KNOWN) return send(200, MANIFEST)

        if (path === '/app' || path === '/app/' || path === '/') {
          void server
            .transformIndexHtml(request.url ?? '/app', page(TICKET), request.originalUrl)
            .then((html) => {
              response.statusCode = 200
              response.setHeader('content-type', 'text/html; charset=utf-8')
              /*
               * Framed by a host and by nothing else — and by nothing at all is
               * fine too, which is what opening this page directly is.
               *
               * `frame-ancestors` is the module's own half of the arrangement:
               * a host says which origins IT will frame, and this says who may
               * frame this. It matters more here than anywhere else in the
               * workspace, because this page holds a ticket to a shell. A page
               * with a live terminal in it, embedded in a stranger's document,
               * is a terminal somebody can be tricked into typing into.
               */
              response.setHeader(
                'content-security-policy',
                `frame-ancestors 'self' ${process.env.ROADMAP_ORIGIN ?? 'http://127.0.0.1:4181 http://localhost:4181'}`,
              )
              response.end(html)
            })
            .catch(next)
          return
        }

        const ours = path === '/healthz' || path.startsWith('/api/')
        if (!ours) return next()

        const reply = answer(method, path)
        if (!reply) return next()
        send(reply.status, reply.body)
      })
    },
  }
}

export default defineConfig({
  plugins: [serves({ id: ID, prefer: PREFERRED_PORT }), doors(), react(), tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  /**
   * Loopback, explicitly, and no `cors` line anywhere in this file.
   *
   * Both halves are load-bearing and neither is a default worth relying on.
   * `host: '127.0.0.1'` keeps the port off every other interface, so nothing on
   * the network can reach it. The ABSENCE of `server.cors` is what keeps a page
   * in another tab from reading this origin — a sibling module once served a
   * write ticket that was readable cross-origin because `cors: true` was set
   * for an unrelated reason, and here the thing behind the ticket is a shell.
   *
   * `cors: false` is written rather than omitted, so that adding it back is a
   * deliberate edit to a line that says what it is, rather than an easy
   * addition to a config that never mentioned it.
   *
   * `port` and `strictPort` used to be here and are not. `strictPort: true`
   * meant a taken 7920 stopped this module dead — `Error: Port 7920 is already
   * in use` — which was the only honest option while nothing handled a
   * collision, and a bad one for a module whose registration carries `keep: true`
   * precisely so that nothing reaps it out from under a running command.
   * `serves()`, first in the plugin list above, decides the port instead: a free
   * 7920 in silence, a clean exit rather than a second copy if this module is
   * already answering there, and otherwise a loud move to the next free port
   * with the registration rewritten to the port the server actually bound. It
   * sets `strictPort: false` itself, so Vite's own fallback is a second net
   * rather than the absence of one.
   *
   * `host` stays, and stays explicit. It is the half of this block that is about
   * the fence rather than about the address.
   */
  server: {
    host: '127.0.0.1',
    cors: false,
  },
})
