import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { doors, serves } from 'kehikot-module-protocol/serve'
import { defineConfig, type Plugin } from 'vite'

import { BUILD, answer } from './doors.ts'
import { ID, MANIFEST, PREFERRED_PORT } from './manifest.ts'
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
 * The socket, beside the doors and served by the one process that serves the
 * page.
 *
 * The HTTP doors are the protocol's `doors()`, below. The socket is not one of
 * them: it needs Vite's own HTTP server, which is Vite's to give, so it is a
 * plugin of its own.
 *
 * ## Why it cannot be a second server
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
function sockets(): Plugin {
  return {
    name: 'terminal-sockets',
    apply: 'serve',
    configureServer(server) {
      const http = server.httpServer
      if (!http) {
        server.config.logger.error(
          'terminal: no HTTP server to attach the terminal socket to. The container will load and no shell will ever open.',
        )
        return
      }
      /* After `listening`, not before, because the fence needs the port this
         server BOUND rather than the one it asked for — see `bound` above.
         Nothing can arrive on the socket before the server is listening, so
         attaching the upgrade handler here costs nothing. */
      http.once('listening', () => {
        const address = http.address()
        if (address && typeof address === 'object') bound = address.port
        serveTerminals(http, bound, (line) => server.config.logger.info(line))
      })
    },
  }
}

/**
 * The doors: the manifest at both well-known paths, `/app` (generated, with
 * the write ticket and this process's build printed into it, `no-store`,
 * `frame-ancestors`), and `/healthz` and `/api/*` through `answer` in
 * `doors.ts`. See the protocol's docs/module-plumbing.md.
 *
 * `/app` is claimed here before Vite's resolver sees it, which matters: under
 * Vite dev an extensionless `/app` next to a `src/app.tsx` can answer `200
 * text/javascript`, a document a browser loads happily and runs nothing in.
 *
 * A beacon is a few hundred bytes, so the body bound is this module's own: 64
 * KiB, past which the answer is a 413 and nothing is read.
 */
const MOST_READ = 64 * 1024

export default defineConfig({
  plugins: [
    serves({ id: ID, prefer: PREFERRED_PORT }),
    sockets(),
    doors({ manifest: MANIFEST, answer, build: BUILD, page: { title: 'Terminal', ticket: TICKET }, maxBodyBytes: MOST_READ }),
    react(),
    tailwindcss(),
  ],
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
