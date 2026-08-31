#!/usr/bin/env bun
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { originFor, registerAt } from 'roadmap-module-protocol/serve'

import { ID, PREFERRED_PORT } from './manifest.ts'

/**
 * Tell a host on this machine where this module answers.
 *
 *   bun run register            # or: PORT=7921 bun run register
 *
 * A separate program from `run.sh` on purpose. Registration writes into
 * somebody's home directory and says "frame this", which is a decision a person
 * makes once; a start script that did it quietly would be making that decision
 * on their behalf every time they pressed start. That argument is sharper here
 * than anywhere else in the workspace, because what gets framed is a terminal.
 *
 * ## The plugin writes this file too, and that argument survives it intact
 *
 * `serves()` in `vite.config.ts` rewrites this registration every time the
 * server starts, which reads like precisely what the paragraph above forbids.
 * It is not, and here of all places it is worth being exact about the
 * difference.
 *
 * ADOPTION is the decision a person makes once, and this program is it. Running
 * this is how a module nobody had put on their canvas gets onto it, shell and
 * all; deleting the file is how it comes off again. Nothing the plugin does can
 * put a terminal on a canvas that was not already offered one.
 *
 * The ADDRESS is not a decision anybody made. Nobody chose 7920 — they chose to
 * be framed, and 7920 is a fact about where this process happened to bind, one
 * that changes between one start and the next when something else has the port.
 * A registration still naming the old number is one the host sweeps to find
 * nothing: it reports this module as stopped while it runs one port over, and
 * offers a Start button that would open a SECOND set of shells beside the ones
 * somebody is typing in. Rewriting the address keeps the decision the person
 * made TRUE. It does not make one.
 *
 * ## `keep: true`, and why this program no longer builds the document itself
 *
 * This registration carries a field nothing in this repository writes: `keep`,
 * set by hand, which tells the host not to reap this module when it tidies up.
 * It is there because this process holds live shells — a reap here is somebody's
 * command dying mid-run, and there is no way to give that back.
 *
 * The old body of this file was `writeFileSync(file, JSON.stringify({ url, dir
 * }))`, which OVERWROTE. Running it, or any start that wrote the same way, would
 * have taken `keep` off silently and left a terminal that looks registered and
 * is one sweep from being killed. `registerAt` merges: it reads what is there,
 * changes the url and the dir, and puts everything else back. That behaviour is
 * the reason this file is allowed to be rewritten on every start at all.
 *
 * ## `dir` as well as `url`
 *
 * The host can start a module that is registered but not answering, by running
 * `run.sh` in the directory named here. Without `dir` it can only report that
 * the module is down and leave the person to find it. With it, the container
 * offers to start the thing it is meant to be showing.
 *
 * It comes from this file's own location rather than from `process.cwd()`, so
 * `bun run register` works from anywhere and records where the program actually
 * is instead of where somebody happened to be standing. That is the one thing
 * the package cannot work out for itself, which is why it is still spelled here.
 *
 * ## Where a host looks is no longer copied into this file
 *
 * The registry directory, the rule that the FILENAME carries the id — a host
 * sweeps the directory and reads the id off the name, so
 * `roadmap.terminal.json` is what makes this `roadmap.terminal` — and the shape
 * of the document are all in `roadmap-module-protocol/serve` now. This file used
 * to say the path itself, with a note explaining that the copy was deliberate so
 * the directory could stand alone; fourteen deliberate copies of one path are
 * fourteen chances to disagree by a character, and writing to the wrong
 * directory is the worst failure a module can have, because the host finds
 * nothing and finds it silently.
 */
const port = Number(process.env.PORT ?? PREFERRED_PORT)
const written = registerAt({
  id: ID,
  origin: originFor(port),
  dir: dirname(fileURLToPath(import.meta.url)),
})

console.log(`registered: ${written.file} -> ${written.url} (${written.dir})`)
if (written.was) console.log(`  (was ${written.was.url} in ${written.was.dir})`)
console.log('Start the module with ./run.sh, then reload the host; it sweeps the directory on every read.')
console.log(`If ${port} is taken, ./run.sh moves to the next free port and rewrites this file to match.`)
