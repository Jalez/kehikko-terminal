/**
 * What this module was doing in the seconds before it stopped.
 *
 * ## Why this exists at all, rather than a fix
 *
 * "The terminal module still seems to freeze at times." Three rounds have been
 * spent on that sentence and two of them found something real: a WKWebView that
 * stops firing `requestAnimationFrame` the moment the app is not frontmost
 * (fixed in `kehikko-desktop`, see `rendering.rs`), and a keystroke buffer that
 * swallowed what you typed before the socket opened (fixed in
 * `terminal-view.tsx`). It still freezes.
 *
 * The problem with the next fix is that nobody can tell it from luck. The
 * symptom is intermittent, it is reported as getting worse "after the terminal
 * has been running for a while", and every candidate cause lives in a different
 * process from the one you are looking at. A change that makes it rarer is
 * indistinguishable from a change that did nothing, and both are indistinguishable
 * from a week where the person happened not to leave it open as long.
 *
 * So this file does not fix anything. It makes the freeze SAY WHICH LAYER
 * STOPPED, which is the thing that has been missing every time.
 *
 * ## The layers, and what distinguishes them
 *
 * There are five places the bytes a person is waiting for can stop, and the
 * whole design here is that each one leaves a different shape in the report:
 *
 *   1. **The pty.** A shell that is blocked, dead, or genuinely printing
 *      nothing. Shows as `pty->page` bytes not increasing, `last` growing.
 *   2. **The transport.** A WebSocket that is open at one end and dead at the
 *      other — the recurring failure shape in this workspace. Shows as bytes
 *      leaving the pty and being handed to `ws.send` while `bufferedAmount`
 *      climbs and never drains, or as sends continuing while the page's own
 *      count of bytes RECEIVED stops moving.
 *   3. **This server.** A stuck read, a blocked event loop. Shows as the
 *      heartbeat below going quiet: `ticks` stops rising between two reads of
 *      the report, or `worst lag` is enormous.
 *   4. **The page's render loop.** rAF stopped, or xterm's `RenderDebouncer`
 *      stalled behind it. Shows as page beacons still arriving — so the page's
 *      JavaScript is alive — carrying `frame outstanding for 22.0s`. This is
 *      the exact fingerprint of the WKWebView bug, so if it comes back it is
 *      identifiable rather than re-discoverable.
 *   5. **The page entirely.** Main thread wedged, frame torn out, document
 *      gone. Shows as the beacons THEMSELVES stopping: `last beacon 40s ago`.
 *
 * Note that 4 and 5 are only separable because the page reports periodically.
 * A page that only spoke when something happened would look identical, frozen
 * and idle, and that ambiguity is what has made this un-diagnosable so far.
 *
 * ## The report is on the server, on purpose
 *
 * A frozen page cannot draw its own diagnostics. Anything rendered inside the
 * module is a thing you can only read when you do not need it. So the page
 * ships a small standing to `/api/trace/page` every couple of seconds, the
 * server keeps it, and everything a person needs comes out of `curl` — from
 * another window, while the terminal in front of them is stuck.
 *
 * The corollary is that the page's own recent events have to be shipped BEFORE
 * the freeze or they are lost. They are: each beacon carries whatever the page
 * has noted since the last one, and they are appended to the ring here.
 *
 * ## What it costs when nothing is wrong
 *
 * Deliberately almost nothing, because instrumentation that is expensive is
 * instrumentation somebody turns off, and one that is turned off is one nobody
 * had on when it mattered. On the hot paths — a chunk out of the pty, a
 * keystroke in — this does two integer increments and one `Date.now()`. It
 * allocates nothing and formats nothing. Strings are built only when something
 * CHANGES state (a spawn, a close, a refusal) and once every ten seconds for
 * the heartbeat, and the report itself is rendered only when somebody asks for
 * it.
 *
 * The ring is bounded at {@link KEPT} entries and the per-shell records at
 * {@link SHELLS}, so the tracer cannot become the leak it was built to find.
 *
 * ## What it does NOT record
 *
 * The bytes. What comes out of somebody's shell is their session — their
 * passwords echoed by a program that should not have, their file names, their
 * work — and a diagnostic that keeps a rolling copy of it in memory and serves
 * it on an unauthenticated port would be a worse bug than the one it is
 * looking for. Sizes, counts and timings only.
 *
 * There is one opt-in: `TERMINAL_TRACE_BYTES=1` records a short prefix of each
 * pty chunk. It exists because a freeze that turns out to be an escape sequence
 * the emulator choked on cannot be diagnosed from a byte count, and that is a
 * real possibility here — a program that dies with mouse tracking still on
 * already has an essay in `terminal-view.tsx`. It is off unless somebody set
 * it, and the report says loudly when it is on.
 */

/** How many events are kept. A few minutes of a busy terminal. */
const KEPT = 400

/** How many shells are kept after they have closed. */
const SHELLS = 12

/** How much of a chunk is kept when `TERMINAL_TRACE_BYTES` is set. */
const PREFIX = 60

/** Whether the contents of the terminal are being recorded. Off unless asked. */
export const recordingBytes = process.env.TERMINAL_TRACE_BYTES === '1'

export interface Event {
  at: number
  /** Which layer this came from, so a reader can scan one column. */
  from: 'server' | 'pty' | 'socket' | 'page' | 'beat'
  what: string
}

export interface Flow {
  chunks: number
  bytes: number
  lastAt: number | null
}

export interface Shell {
  n: number
  openedAt: number
  spawnedAt: number | null
  pid: number | null
  cwd: string | null
  cols: number
  rows: number
  /** Whether the pty has been counted out. See {@link reaped}. */
  gone: boolean
  /** Bytes the pty produced, and when the last one arrived. */
  out: Flow
  /** Bytes typed into the pty. */
  in: Flow
  /** What was handed to `ws.send`, and what could not be. */
  sent: Flow
  dropped: number
  /** The largest `ws.bufferedAmount` ever seen. A transport that is not
      draining shows up here and nowhere else. */
  bufferedHigh: number
  /** Read at report time, not stored: `ws.readyState` in words. */
  socket: () => string
  /** Read at report time: `ws.bufferedAmount` now. */
  buffered: () => number
  closedAt: number | null
  why: string | null
}

/** What the page says about itself. Shape mirrored in `src/view/trace.ts`. */
export interface PageStanding {
  /** Milliseconds since the page loaded. */
  up: number
  /** How long a requested animation frame has been outstanding, or null when
      one is not pending. This is the render-loop stall, named. */
  frameWaiting: number | null
  /** Milliseconds since a requested frame last landed. */
  sinceFrame: number | null
  /** Frames that landed, total, and the worst wait ever seen. */
  frames: number
  worstFrameWait: number
  /** `document.visibilityState`, because a hidden page is ALLOWED to stop. */
  visibility: string
  /** How late the page's own 1s timer has been at worst. A blocked main thread
      shows here even when it recovers before anybody looks. */
  worstTimerLag: number
  /** The accumulation counters. `live` above 1 is a leak. */
  views: { mounted: number; disposed: number; live: number }
  emulators: { made: number; disposed: number; live: number }
  sockets: { opened: number; closed: number; live: number }
  observers: { live: number }
  /** What xterm actually drew, and what it was handed. */
  received: { chunks: number; bytes: number }
  written: { chunks: number }
  renders: number
  lastRenderAgo: number | null
  keystrokes: number
  waiting: number
  /** Events the page noted since its last beacon. */
  noted: { at: number; what: string }[]
}

const ring: Event[] = []

/** The counters. One object so the report is one read. */
const counted = {
  since: Date.now(),
  upgrades: { accepted: 0, refused: 0 },
  sockets: { opened: 0, closed: 0, live: 0 },
  shells: { spawned: 0, exited: 0, failed: 0, live: 0 },
  beat: { ticks: 0, lastAt: 0, worstLag: 0 },
  page: null as PageStanding | null,
  pageAt: 0,
  pageBeacons: 0,
  attached: 0,
}

/** This module installed its upgrade handler. Exactly once per process. */
export function attached(): void {
  counted.attached += 1
}

let opened = 0
const shells: Shell[] = []

/**
 * Write one line into the ring.
 *
 * Called on state changes and not on data, which is the whole reason this can
 * be left on: a terminal printing a megabyte does not touch it once.
 */
export function note(from: Event['from'], what: string): void {
  ring.push({ at: Date.now(), from, what })
  if (ring.length > KEPT) ring.shift()
}

export function refused(why: string): void {
  counted.upgrades.refused += 1
  note('socket', `an upgrade was refused — ${why}`)
}

export function accepted(): void {
  counted.upgrades.accepted += 1
  counted.sockets.opened += 1
  counted.sockets.live += 1
}

/**
 * A new connection, from before it has proved itself.
 *
 * Recorded at UPGRADE rather than at spawn, because a socket that opens and
 * never says anything is one of the states being looked for, and a record that
 * only appeared once a shell existed could not show it.
 */
export function connected(socket: () => string, buffered: () => number): Shell {
  opened += 1
  const shell: Shell = {
    n: opened,
    openedAt: Date.now(),
    spawnedAt: null,
    pid: null,
    cwd: null,
    cols: 0,
    rows: 0,
    gone: false,
    out: { chunks: 0, bytes: 0, lastAt: null },
    in: { chunks: 0, bytes: 0, lastAt: null },
    sent: { chunks: 0, bytes: 0, lastAt: null },
    dropped: 0,
    bufferedHigh: 0,
    socket,
    buffered,
    closedAt: null,
    why: null,
  }
  shells.push(shell)
  /* Only the CLOSED ones are dropped. A live shell is never evicted, however
     many have been opened, because the live ones are what somebody staring at
     a frozen terminal is asking about. */
  while (shells.length > SHELLS && shells.some((s) => s.closedAt !== null)) {
    const at = shells.findIndex((s) => s.closedAt !== null)
    if (at < 0) break
    shells.splice(at, 1)
  }
  return shell
}

export function spawned(shell: Shell, pid: number, cwd: string, cols: number, rows: number): void {
  shell.spawnedAt = Date.now()
  shell.pid = pid
  shell.cwd = cwd
  shell.cols = cols
  shell.rows = rows
  counted.shells.spawned += 1
  counted.shells.live += 1
  note('pty', `#${shell.n} a shell started, pid ${pid}, ${cols}x${rows}, in ${cwd}`)
}

export function wouldNotStart(shell: Shell, why: string): void {
  counted.shells.failed += 1
  note('pty', `#${shell.n} no shell could be started — ${why}`)
}

/**
 * A chunk out of the pty. The hot path, and it is three assignments.
 *
 * `buffered` is read here rather than sampled on a timer because this is the
 * only moment it can grow, and a high-water mark that is only ever sampled
 * misses the spike that matters.
 */
export function fromPty(shell: Shell, bytes: number, buffered: number, delivered: boolean, chunk?: string): void {
  const now = Date.now()
  shell.out.chunks += 1
  shell.out.bytes += bytes
  shell.out.lastAt = now
  if (delivered) {
    shell.sent.chunks += 1
    shell.sent.bytes += bytes
    shell.sent.lastAt = now
    if (buffered > shell.bufferedHigh) shell.bufferedHigh = buffered
  } else {
    shell.dropped += 1
  }
  if (recordingBytes && chunk !== undefined) {
    note('pty', `#${shell.n} out ${bytes}B ${JSON.stringify(chunk.slice(0, PREFIX))}`)
  }
}

/** A keystroke frame in. Same shape, same cost. */
export function toPty(shell: Shell, bytes: number): void {
  shell.in.chunks += 1
  shell.in.bytes += bytes
  shell.in.lastAt = Date.now()
}

export function resized(shell: Shell, cols: number, rows: number): void {
  shell.cols = cols
  shell.rows = rows
}

export function exited(shell: Shell, code: number): void {
  counted.shells.exited += 1
  reaped(shell)
  note('pty', `#${shell.n} the shell exited (${code})`)
}

export function closed(shell: Shell, why: string): void {
  if (shell.closedAt !== null) return
  shell.closedAt = Date.now()
  shell.why = why
  counted.sockets.closed += 1
  if (counted.sockets.live > 0) counted.sockets.live -= 1
  note('socket', `#${shell.n} closed — ${why}`)
}

/**
 * The pty is gone, whichever end went first.
 *
 * Separate from {@link closed} and from {@link exited} because the two orders
 * are both ordinary — a shell that exits closes the socket, and a container
 * that is closed kills the shell — and a live count that only decremented on
 * one of them would drift upwards forever. A drifting `live` count would be
 * indistinguishable from the leak this is here to detect, which is the worst
 * thing a counter can be.
 */
export function reaped(shell: Shell): void {
  if (shell.spawnedAt === null || shell.gone) return
  shell.gone = true
  if (counted.shells.live > 0) counted.shells.live -= 1
}

/**
 * The server's own pulse.
 *
 * One timer at 1Hz. Its value is not what it records but that it STOPS: two
 * reads of the report thirty seconds apart with the same `ticks` mean this
 * process's event loop is not turning, which rules the server in and everything
 * else out in a way no error message would have.
 *
 * A heartbeat is written into the ring only every tenth tick, so that the
 * timeline has visible gaps where the process stalled without the ring being
 * nothing but heartbeats. A tick that arrives more than 250ms late is noted
 * immediately, because that is a stall that recovered and would otherwise
 * leave no trace at all.
 *
 * `unref` so this never keeps the process alive on its own. It is a diagnostic;
 * it does not get a vote on when the module exits.
 */
export function beat(): () => void {
  let due = Date.now() + 1000
  const timer = setInterval(() => {
    const now = Date.now()
    const lag = now - due
    due = now + 1000
    counted.beat.ticks += 1
    counted.beat.lastAt = now
    if (lag > counted.beat.worstLag) counted.beat.worstLag = lag
    if (lag > 250) note('beat', `the server loop was ${lag}ms late`)
    else if (counted.beat.ticks % 10 === 0) note('beat', 'server alive')
  }, 1000)
  timer.unref?.()
  counted.beat.lastAt = Date.now()
  return () => clearInterval(timer)
}

/**
 * The page said something about itself.
 *
 * Its own recent events are folded into this ring rather than kept apart, so
 * that one timeline shows a pty chunk, the send, and the page's failure to draw
 * it in the order they happened. That ordering is the entire diagnostic.
 */
export function fromPage(standing: PageStanding): void {
  counted.page = standing
  counted.pageAt = Date.now()
  counted.pageBeacons += 1
  for (const one of standing.noted.slice(0, 20)) {
    ring.push({ at: one.at, from: 'page', what: one.what })
  }
  while (ring.length > KEPT) ring.shift()
  /* Kept sorted, because the page's clock and this one agree closely enough
     for a timeline but its events arrive in batches. */
  ring.sort((a, b) => a.at - b.at)
}

export interface Standing {
  now: number
  since: number
  upgrades: { accepted: number; refused: number }
  sockets: { opened: number; closed: number; live: number }
  shells: { spawned: number; exited: number; failed: number; live: number }
  beat: { ticks: number; lastAt: number; worstLag: number }
  page: PageStanding | null
  pageAt: number
  pageBeacons: number
  recordingBytes: boolean
  rss: number
  /**
   * How many times THIS module has attached itself to the HTTP server, and how
   * many `upgrade` listeners that server carries in total.
   *
   * The second number is not one and never was: Vite's own HMR socket lives on
   * the same server and holds a listener of its own, which is why this module
   * leaves unfamiliar upgrades alone rather than refusing them. So the raw
   * count is context, and `attached` is the signal — above one means something
   * installed a second terminal handler on one server, which an HMR reload of
   * the plugin would do, and which is exactly the "it degrades after a while"
   * shape.
   */
  attached: number
  upgradeListeners: number
  live: {
    n: number
    pid: number | null
    cwd: string | null
    cols: number
    rows: number
    openedAt: number
    spawnedAt: number | null
    closedAt: number | null
    why: string | null
    out: Flow
    in: Flow
    sent: Flow
    dropped: number
    bufferedHigh: number
    buffered: number
    socket: string
  }[]
  events: Event[]
}

/** How many `upgrade` listeners the HTTP server is carrying, if it will say. */
let listeners: () => number = () => 0
export function watchListeners(count: () => number): void {
  listeners = count
}

export function standing(): Standing {
  return {
    now: Date.now(),
    since: counted.since,
    upgrades: { ...counted.upgrades },
    sockets: { ...counted.sockets },
    shells: { ...counted.shells },
    beat: { ...counted.beat },
    page: counted.page,
    pageAt: counted.pageAt,
    pageBeacons: counted.pageBeacons,
    recordingBytes,
    rss: process.memoryUsage?.().rss ?? 0,
    attached: counted.attached,
    upgradeListeners: listeners(),
    live: shells.map((s) => ({
      n: s.n,
      pid: s.pid,
      cwd: s.cwd,
      cols: s.cols,
      rows: s.rows,
      openedAt: s.openedAt,
      spawnedAt: s.spawnedAt,
      closedAt: s.closedAt,
      why: s.why,
      out: { ...s.out },
      in: { ...s.in },
      sent: { ...s.sent },
      dropped: s.dropped,
      bufferedHigh: s.bufferedHigh,
      buffered: s.closedAt === null ? s.buffered() : 0,
      socket: s.socket(),
    })),
    events: [...ring],
  }
}

/* ------------------------------------------------------------------ */
/* Rendering it for a person, which is the point of the whole file.    */
/* ------------------------------------------------------------------ */

function ago(then: number | null, now: number): string {
  if (then === null || then === 0) return 'never'
  return `${((now - then) / 1000).toFixed(1)}s ago`
}

function span(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}s`
  return `${Math.floor(ms / 3_600_000)}h${String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0')}m`
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function clock(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
    d.getSeconds(),
  ).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

/**
 * The report, as a person reads it.
 *
 * Plain text and not JSON, because the whole design goal is ONE command that
 * answers the question without a second tool to pipe it through. `?json` is
 * there for anything that wants to graph it.
 *
 * The first block is written so that the layer that stopped is the line whose
 * "last" is old while the line above it is fresh. That is deliberate: you read
 * down until the freshness stops, and the freeze is between those two lines.
 */
export function report(now: number = Date.now(), s: Standing = standing()): string {
  const out: string[] = []
  const say = (line: string) => out.push(line)

  say(`terminal — trace at ${new Date(now).toISOString()}, this process up ${span(now - s.since)}`)
  say('')
  say('the layers, newest first. read down until the freshness stops.')

  const p = s.page
  say(
    `  page       ${
      s.pageBeacons === 0
        ? 'has never reported. Either no container is open, or it froze before it could.'
        : `last said something ${ago(s.pageAt, now)} (${s.pageBeacons} times)`
    }`,
  )
  if (p) {
    say(
      `             frames: ${p.frames} landed, last ${
        p.sinceFrame === null ? 'never' : `${(p.sinceFrame / 1000).toFixed(1)}s ago`
      }, worst wait ${span(p.worstFrameWait)}`,
    )
    if (p.frameWaiting !== null && p.frameWaiting > 1500) {
      say(
        `             *** a requested animation frame has been outstanding for ${span(
          p.frameWaiting,
        )}. The page is running and NOT drawing.`,
      )
      say(
        `                 document.visibilityState is "${p.visibility}"${
          p.visibility === 'hidden'
            ? ' — a hidden page is allowed to stop, so this may be the window, not a bug.'
            : ' — a visible page that will not draw is the WKWebView case; see rendering.rs in kehikko-desktop.'
        }`,
      )
    }
    say(`             worst timer lag ${span(p.worstTimerLag)}, visibility ${p.visibility}, up ${span(p.up)}`)
    say(
      `             xterm: ${p.written.chunks} writes, ${p.renders} renders, last render ${
        p.lastRenderAgo === null ? 'never' : `${(p.lastRenderAgo / 1000).toFixed(1)}s ago`
      }`,
    )
    say(`             received ${size(p.received.bytes)} in ${p.received.chunks} messages, ${p.keystrokes} keystrokes, ${p.waiting} buffered`)
    say(
      `             live now: ${p.views.live} view, ${p.emulators.live} emulator, ${p.sockets.live} socket, ${p.observers.live} observer` +
        `  (ever: ${p.views.mounted}/${p.views.disposed} views, ${p.emulators.made}/${p.emulators.disposed} emulators, ${p.sockets.opened}/${p.sockets.closed} sockets)`,
    )
    const leaking =
      p.views.live > 1 || p.emulators.live > 1 || p.sockets.live > 1 || p.observers.live > 1
    if (leaking) {
      say('             *** more than one of something is live. A remount left the old one behind, and that accumulates.')
    }
  }

  say(
    `  transport  ${s.sockets.live} open, ${s.sockets.opened} opened, ${s.sockets.closed} closed, ${s.upgrades.refused} refused`,
  )
  say(
    `             this module has attached ${s.attached} time${s.attached === 1 ? '' : 's'}; the server carries ${
      s.upgradeListeners
    } upgrade listener${s.upgradeListeners === 1 ? '' : 's'} in all (Vite's HMR socket is one of them)`,
  )
  if (s.attached > 1) {
    say('             *** this module attached to the server more than once. Two handlers are racing for one handshake.')
  }
  say(
    `  server     ticked ${s.beat.ticks} times, last ${ago(s.beat.lastAt, now)}, worst lag ${span(s.beat.worstLag)}, rss ${size(
      s.rss,
    )}`,
  )
  if (now - s.beat.lastAt > 3000) {
    say('             *** the heartbeat is stale. This process is not turning its event loop.')
  }
  say(`  shells     ${s.shells.live} live, ${s.shells.spawned} spawned, ${s.shells.exited} exited, ${s.shells.failed} would not start`)
  say('')

  say('every shell this process has held, newest first')
  const held = [...s.live].reverse()
  if (held.length === 0) say('  (none — nothing has ever connected)')
  for (const one of held) {
    const state =
      one.closedAt !== null
        ? `closed ${ago(one.closedAt, now)} — ${one.why ?? 'no reason given'}`
        : one.spawnedAt === null
          ? `connected ${ago(one.openedAt, now)}, no shell yet`
          : `live for ${span(now - one.spawnedAt)}`
    say(`  #${one.n}  pid ${one.pid ?? '—'}  ${one.cols}x${one.rows}  ${state}`)
    if (one.cwd) say(`      in ${one.cwd}`)
    say(
      `      pty -> page   ${size(one.out.bytes)} in ${one.out.chunks} chunks, last ${ago(one.out.lastAt, now)}`,
    )
    say(
      `      page -> pty   ${size(one.in.bytes)} in ${one.in.chunks} frames, last ${ago(one.in.lastAt, now)}`,
    )
    say(
      `      socket        ${one.socket}, buffered ${size(one.buffered)} (high ${size(one.bufferedHigh)}), ${
        one.sent.chunks
      } sends, ${one.dropped} dropped`,
    )
    if (one.buffered > 1024 * 1024) {
      say('      *** the send buffer is not draining. The socket is open here and not reading at the other end.')
    }
  }
  say('')

  say(`the last ${s.events.length} things that happened, oldest first`)
  for (const e of s.events) say(`  ${clock(e.at)}  ${e.from.padEnd(7)} ${e.what}`)

  if (s.recordingBytes) {
    say('')
    say('TERMINAL_TRACE_BYTES=1 is set: the lines above contain the first 60 bytes of what')
    say('the shell printed. That is somebody’s session. Unset it when you are done.')
  }

  return out.join('\n') + '\n'
}

/* ------------------------------------------------------------------ */
/* Reading what the page says, which is a thing off a socket.          */
/* ------------------------------------------------------------------ */

/**
 * The page's beacon, checked rather than believed.
 *
 * It arrives over HTTP from a document, which makes it exactly as trustworthy
 * as the keystroke frames in `shell.ts` — the ticket says who sent it and
 * nothing says the shape is right. A missing field would put `NaN` and
 * `undefined` into a report a person is reading in order to diagnose a freeze,
 * which is the one moment a diagnostic must not itself be confusing.
 *
 * Written by hand rather than with a schema library because it runs every two
 * seconds per open container, and a validator that allocates a parse tree each
 * time is the kind of cost that turns a tracer into a cause.
 */
export function readStanding(raw: unknown): PageStanding | null {
  if (typeof raw !== 'object' || raw === null) return null
  const it = raw as Record<string, unknown>
  const num = (v: unknown, fallback = 0): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback
  const maybe = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null
  const at = (v: unknown): Record<string, unknown> =>
    typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}

  const notedRaw = Array.isArray(it.noted) ? it.noted : []
  const noted: { at: number; what: string }[] = []
  for (const one of notedRaw.slice(0, 20)) {
    const o = at(one)
    if (typeof o.what !== 'string') continue
    /* Clipped. A page could otherwise put a megabyte a line into a ring this
       process keeps, which would be a memory hole opened by a diagnostic. */
    noted.push({ at: num(o.at, Date.now()), what: o.what.slice(0, 300) })
  }

  const views = at(it.views)
  const emulators = at(it.emulators)
  const sockets = at(it.sockets)
  const received = at(it.received)

  return {
    up: num(it.up),
    frameWaiting: maybe(it.frameWaiting),
    sinceFrame: maybe(it.sinceFrame),
    frames: num(it.frames),
    worstFrameWait: num(it.worstFrameWait),
    visibility: typeof it.visibility === 'string' ? it.visibility.slice(0, 20) : 'unknown',
    worstTimerLag: num(it.worstTimerLag),
    views: { mounted: num(views.mounted), disposed: num(views.disposed), live: num(views.live) },
    emulators: { made: num(emulators.made), disposed: num(emulators.disposed), live: num(emulators.live) },
    sockets: { opened: num(sockets.opened), closed: num(sockets.closed), live: num(sockets.live) },
    observers: { live: num(at(it.observers).live) },
    received: { chunks: num(received.chunks), bytes: num(received.bytes) },
    written: { chunks: num(at(it.written).chunks) },
    renders: num(it.renders),
    lastRenderAgo: maybe(it.lastRenderAgo),
    keystrokes: num(it.keystrokes),
    waiting: num(it.waiting),
    noted,
  }
}
