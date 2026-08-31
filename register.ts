#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { ID } from './manifest.ts'

/**
 * Tell a host on this machine where this module answers.
 *
 *   bun run register            # or: PORT=7920 bun run register
 *
 * A separate program from `run.sh` on purpose. Registration writes into
 * somebody's home directory and says "frame this", which is a decision a person
 * makes once; a start script that did it quietly would be making that decision
 * on their behalf every time they pressed start. That argument is sharper here
 * than anywhere else in the workspace, because what gets framed is a terminal.
 *
 * ## The filename is the module id
 *
 * Not a field inside the file — the NAME. A host sweeps the directory and takes
 * the id from the filename, so `roadmap.terminal.json` is what makes this
 * `roadmap.terminal`. Two files naming the same port under different names are
 * two modules as far as a host is concerned.
 *
 * ## `dir` as well as `url`
 *
 * The host can start a module that is registered but not answering, by running
 * `run.sh` in the directory named here. Without `dir` it can only report that
 * the module is down and leave the person to find it. With it, the container offers
 * to start the thing it is meant to be showing.
 *
 * ## Where a host looks
 *
 * This line must say exactly what the host's own registry sweep says, and it is
 * copied rather than imported because this directory is meant to stand alone.
 * Writing to the wrong directory is the worst failure a module can have: the
 * host finds nothing, and finds it silently.
 */
const registryDir = process.env.ROADMAP_MODULES_DIR ?? join(homedir(), '.roadmap', 'modules')

const port = Number(process.env.PORT ?? 7920)
const origin = `http://127.0.0.1:${port}`
const dir = import.meta.dirname

mkdirSync(registryDir, { recursive: true })
const file = join(registryDir, `${ID}.json`)
writeFileSync(file, `${JSON.stringify({ url: origin, dir }, null, 2)}\n`)
console.log(`registered: ${file} -> ${origin}`)
console.log('Start the module with ./run.sh, then reload the host; it sweeps the directory on every read.')
