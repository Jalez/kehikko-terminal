/**
 * Does the trace actually record a real shell, or only the parts that have
 * tests?
 *
 * The unit tests drive `trace.ts` directly, which proves the arithmetic and
 * proves nothing about the wiring — a counter that is never called from
 * `shell.ts` passes every one of them. This drives the real socket against a
 * running module: it forges nothing (a raw `ws` client can send handshakes a
 * browser refuses to produce, so the Origin and Host here are the honest ones),
 * opens a shell, types into it, and then reads `/api/trace` the way a person
 * would.
 *
 *     PORT=7929 ./run.sh &
 *     node dev/trace-probe.mjs 7929
 *
 * What it asserts is only that the numbers MOVED — bytes out of the pty, bytes
 * in, a pid, a live count of one. Whether they moved to the right numbers is
 * what the report is for, and it prints the report so a person can look.
 */
import { createRequire } from 'node:module'

const port = Number(process.argv[2] ?? 7920)
const require = createRequire(import.meta.url)
const WebSocket = require('ws')

const origin = `http://127.0.0.1:${port}`

const page = await fetch(`${origin}/app`).then((r) => r.text())
const ticket = JSON.parse(
  page.match(/id="terminal-ticket" type="application\/json">([^<]*)</)?.[1] ?? '""',
)
if (!ticket) throw new Error('no ticket in the page; is the module running on that port?')

const socket = new WebSocket(`ws://127.0.0.1:${port}/terminal`, {
  headers: { origin, host: `127.0.0.1:${port}` },
})

let bytes = 0
socket.on('message', (data) => {
  bytes += data.length
})

await new Promise((ready, fail) => {
  socket.on('open', ready)
  socket.on('error', fail)
})

socket.send(JSON.stringify({ ticket, cwd: process.cwd(), cols: 132, rows: 40 }))
await new Promise((r) => setTimeout(r, 900))
socket.send(JSON.stringify({ d: 'expr 6 \\* 7\n' }))
await new Promise((r) => setTimeout(r, 900))
socket.send(JSON.stringify({ r: { cols: 100, rows: 30 } }))
await new Promise((r) => setTimeout(r, 600))

const report = await fetch(`${origin}/api/trace`).then((r) => r.text())
console.log(report)

const said = await fetch(`${origin}/api/trace?json`).then((r) => r.json())
const mine = said.live.at(-1)

const checks = [
  ['a shell was spawned and its pid recorded', typeof mine.pid === 'number' && mine.pid > 0],
  ['the pty produced bytes and the trace counted them', mine.out.bytes > 0],
  ['every one of them was handed to the socket', mine.sent.bytes === mine.out.bytes && mine.dropped === 0],
  ['the page half of the count matches what arrived here', bytes === mine.sent.bytes],
  ['what was typed was counted going in', mine.in.bytes > 0],
  ['the resize reached the record', mine.cols === 100 && mine.rows === 30],
  ['the socket is reported open and drained', mine.socket === 'open' && mine.buffered === 0],
  ['one shell is live', said.shells.live === 1],
  ['this module attached to the server exactly once', said.attached === 1],
  ['the server heartbeat is turning', said.beat.ticks > 0 && Date.now() - said.beat.lastAt < 3000],
]

for (const [what, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`)

socket.close()
await new Promise((r) => setTimeout(r, 400))

const after = await fetch(`${origin}/api/trace?json`).then((r) => r.json())
console.log(
  `${after.shells.live === 0 && after.sockets.live === 0 ? 'PASS' : 'FAIL'}  the counts came back down when the socket closed`,
)
process.exit(0)
