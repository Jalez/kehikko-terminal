#!/usr/bin/env bun
import { run } from 'kehikot-module-protocol/run'

import { BUILD, answer, stream } from './doors.ts'
import { ID, MANIFEST, PREFERRED_PORT } from './manifest.ts'
import { TICKET, terminalSockets } from './shell.ts'

/**
 * This module over its BUILT page (`bun run build`), on the same doors, the
 * same port and the same socket. `run.sh` starts this when `dist/` carries a
 * stamp of the commit checked out, and Vite otherwise.
 *
 * Everything this module says is decided elsewhere and shared with the dev
 * server: the doors are `answer` in `doors.ts`, mounted by the protocol's
 * `run` exactly as `doors()` mounts them on Vite; the socket is `session` in
 * `shell.ts`, on Bun's WebSocket here and on `ws` there. What differs is the
 * pty: under Bun it is Bun's own (`pty.ts` says why node-pty cannot be).
 *
 * The fence is unchanged in substance: 127.0.0.1 only, no CORS header on any
 * door, a handshake upgraded only when its `Origin` and `Host` name this
 * server's own loopback address (the protocol's `socketFence`), and nothing
 * spawned until the first frame carries this process's ticket.
 *
 * A build that is not this checkout's is never served: `run` answers the page
 * with a 503 saying which commit each is, and the command to run.
 */

const MOST_READ = 64 * 1024
const terminals = terminalSockets((line) => console.log(line))

const running = await run({
  id: ID,
  prefer: PREFERRED_PORT,
  dir: import.meta.dirname,
  manifest: MANIFEST,
  answer,
  stream,
  build: BUILD,
  ticket: TICKET,
  maxBodyBytes: MOST_READ,
  sockets: terminals.sockets,
  onStop: terminals.stopAll,
})

terminals.listening(running.port)
