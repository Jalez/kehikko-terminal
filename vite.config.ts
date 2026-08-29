import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { WELL_KNOWN } from 'roadmap-module-protocol'
import { defineConfig, type Plugin } from 'vite'

import { answer } from './doors.ts'
import { MANIFEST } from './manifest.ts'
import { page } from './page.ts'
import { TICKET, serveTerminals } from './shell.ts'

const PORT = Number(process.env.PORT ?? 7920)

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
      if (!server.httpServer) {
        server.config.logger.error(
          'terminal: no HTTP server to attach the terminal socket to. The pane will load and no shell will ever open.',
        )
      } else {
        serveTerminals(server.httpServer, PORT, (line) => server.config.logger.info(line))
      }

      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`)
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
  plugins: [doors(), react(), tailwindcss()],
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
   */
  server: {
    host: '127.0.0.1',
    port: PORT,
    strictPort: true,
    cors: false,
  },
})
