import { framesDriven, requestRealFrame } from './frames.ts'
import { ticket } from './ticket.ts'

/**
 * The page's half of the trace, which exists because a frozen page cannot draw
 * its own diagnostics.
 *
 * ## The one thing this file has to get right
 *
 * A terminal that has stopped showing output looks identical from the outside
 * whether the page is dead, the page is alive but not painting, the socket is
 * open at one end only, or the shell is simply printing nothing. Everything
 * here is arranged to make those four distinguishable, and it does it by
 * SPEAKING PERIODICALLY rather than only when something happens.
 *
 * That is the whole trick. A page that reported only on events would go quiet
 * when it froze and go quiet when it was idle, and those two are the states
 * that have to be told apart. A page that says "still here, 0 frames drawn"
 * every two seconds distinguishes them in one line.
 *
 * ## Why it is posted to the server rather than kept here
 *
 * Whatever the page knows about the moments before a freeze is only useful if
 * it has already LEFT the page by the time the freeze happens. A ring buffer
 * that you have to open a devtools console to read is a ring buffer nobody
 * reads, and in the desktop shell there may not be a console to open. So the
 * buffer is shipped, in small pieces, continuously, and `curl` reads it off the
 * server. See the essay in `trace.ts` at the repository root.
 *
 * ## The frame probe, and why it is not a rAF loop
 *
 * The obvious way to measure whether the page is painting is a
 * `requestAnimationFrame` loop that counts frames. That measures it very well
 * and costs sixty wakeups a second forever, on a container that is usually
 * sitting still, which is exactly the per-tick work this workspace refuses
 * everywhere else — and instrumentation that drains a battery is instrumentation
 * somebody turns off.
 *
 * So: one frame is requested per second, from the timer that is already
 * running, and what is recorded is whether it LANDED. A frame that has been
 * outstanding for twenty seconds is the render loop being stopped, stated
 * exactly, at a cost of one animation frame per second. The number of frames
 * per second was never the question; whether any arrive was.
 *
 * ## What it costs when nothing is wrong
 *
 * One `setInterval` at 1Hz, one animation frame per second, and one `fetch` to
 * 127.0.0.1 every two seconds carrying about half a kilobyte. On the hot paths
 * — a message off the socket, a keystroke — it is two integer increments and no
 * allocation. Nothing here formats a string unless something changed.
 */

/** How often the page says it is still here. */
const BEACON = 2000

/** How many events one beacon may carry. */
const CARRIED = 20

/** How many are held if beacons are failing, before the oldest go. */
const KEPT = 100

const born = Date.now()

const counts = {
  frames: 0,
  worstFrameWait: 0,
  worstTimerLag: 0,
  views: { mounted: 0, disposed: 0, live: 0 },
  emulators: { made: 0, disposed: 0, live: 0 },
  sockets: { opened: 0, closed: 0, live: 0 },
  observers: { live: 0 },
  received: { chunks: 0, bytes: 0 },
  written: { chunks: 0 },
  renders: 0,
  keystrokes: 0,
  waiting: 0,
}

let lastFrameAt: number | null = null
let frameAskedAt: number | null = null
let lastRenderAt: number | null = null

/**
 * How much of this frame the browser itself says is on screen, 0 to 1, or -1
 * before it has said anything.
 *
 * From an `IntersectionObserver` against the top-level viewport, which is the
 * one thing a page inside a cross-origin iframe is allowed to know about where
 * it is. It is here because the freeze this file exists for turned out to be
 * WebKit treating a frame the person could see as "outside the viewport" (see
 * `frames.ts`). WebKit's observer and WebKit's throttling compute that from
 * different code, so the report can now print the two side by side: a frame
 * drawn once every ten seconds while this says 100% is the bug, stated in its
 * own numbers.
 */
let onScreen = -1

let noted: { at: number; what: string }[] = []

/**
 * Write one line into the page's ring.
 *
 * State changes only — a mount, a socket opening, a render stall beginning.
 * Never per byte and never per keystroke, so this cannot become the stall.
 */
export function note(what: string): void {
  noted.push({ at: Date.now(), what })
  if (noted.length > KEPT) noted.shift()
}

/* The counters, as functions rather than a mutable export, so that the one
   place they change is here and a caller cannot quietly invent a state. */
export const seen = {
  viewMounted(): void {
    counts.views.mounted += 1
    counts.views.live += 1
    note(`a terminal view mounted (${counts.views.live} live)`)
  },
  viewDisposed(): void {
    counts.views.disposed += 1
    if (counts.views.live > 0) counts.views.live -= 1
    note(`a terminal view was disposed (${counts.views.live} live)`)
  },
  emulatorMade(): void {
    counts.emulators.made += 1
    counts.emulators.live += 1
  },
  emulatorDisposed(): void {
    counts.emulators.disposed += 1
    if (counts.emulators.live > 0) counts.emulators.live -= 1
  },
  observerMade(): void {
    counts.observers.live += 1
  },
  observerGone(): void {
    if (counts.observers.live > 0) counts.observers.live -= 1
  },
  socketOpening(): void {
    counts.sockets.opened += 1
    counts.sockets.live += 1
    note(`a socket was opened (${counts.sockets.live} live)`)
  },
  socketClosed(why: string): void {
    counts.sockets.closed += 1
    if (counts.sockets.live > 0) counts.sockets.live -= 1
    note(`a socket closed — ${why} (${counts.sockets.live} live)`)
  },
  /** The hot path in. Two increments, no allocation. */
  message(bytes: number): void {
    counts.received.chunks += 1
    counts.received.bytes += bytes
  },
  written(): void {
    counts.written.chunks += 1
  },
  /** xterm actually put rows on the screen. Fires only when it renders. */
  rendered(): void {
    counts.renders += 1
    lastRenderAt = Date.now()
  },
  keystroke(waiting: number): void {
    counts.keystrokes += 1
    counts.waiting = waiting
  },
}

/**
 * Everything this page knows about itself, as one object.
 *
 * Exported so that a test can assert the thing most likely to break silently:
 * that this shape and `readStanding` at the repository root still agree. Two
 * files describing one wire format is exactly where a field gets renamed on one
 * side, and the symptom would be a zero in the middle of a freeze report — a
 * lie told at the worst possible moment.
 */
export function standingNow() {
  const now = Date.now()
  return {
    up: now - born,
    frameWaiting: frameAskedAt === null ? null : now - frameAskedAt,
    sinceFrame: lastFrameAt === null ? null : now - lastFrameAt,
    frames: counts.frames,
    worstFrameWait: counts.worstFrameWait,
    visibility: typeof document === 'undefined' ? 'unknown' : document.visibilityState,
    worstTimerLag: counts.worstTimerLag,
    views: { ...counts.views },
    emulators: { ...counts.emulators },
    sockets: { ...counts.sockets },
    observers: { ...counts.observers },
    received: { ...counts.received },
    written: { ...counts.written },
    renders: counts.renders,
    lastRenderAgo: lastRenderAt === null ? null : now - lastRenderAt,
    keystrokes: counts.keystrokes,
    waiting: counts.waiting,
    /* The frame that was owed: how many draws the window did not do, how much
       of this frame the browser says is on screen, and the two facts about the
       window a person switching apps changes. See `frames.ts`. */
    driven: framesDriven(),
    onScreen,
    focus: typeof document === 'undefined' ? false : document.hasFocus(),
    size: (typeof window === 'undefined' ? [0, 0] : [window.innerWidth, window.innerHeight]) as [number, number],
    noted: noted.slice(0, CARRIED),
  }
}

/**
 * Ask for one frame and record whether it comes.
 *
 * `frameAskedAt` is only cleared when the frame LANDS, so a request that is
 * never served leaves the timestamp standing and the report can say how long it
 * has been waiting. A second request is not made while one is outstanding —
 * queueing frames at a page that is not drawing would be piling work on the
 * exact thing that is stuck, and the first one answers the question anyway.
 *
 * Asked of the window's REAL `requestAnimationFrame`, not the one `frames.ts`
 * puts in its place. The replacement answers from a timer when the window
 * will not, which is right for xterm and wrong for a probe whose only job is
 * to say whether the window will.
 */
function askForAFrame(): void {
  if (frameAskedAt !== null) return
  const asked = Date.now()
  const id = requestRealFrame(() => {
    const waited = Date.now() - asked
    frameAskedAt = null
    lastFrameAt = Date.now()
    counts.frames += 1
    if (waited > counts.worstFrameWait) counts.worstFrameWait = waited
    /* Noted only when it was long enough to be the bug. A frame that lands in
       16ms is not news, and a ring full of good news holds no bad news. */
    if (waited > 2000) {
      note(
        `an animation frame took ${(waited / 1000).toFixed(1)}s to arrive; the page was ${document.visibilityState} for it`,
      )
    }
  })
  /* Only counted as outstanding once it was actually asked for. Where there is
     no window to ask, nothing is pending and nothing is accused. */
  if (id !== null) frameAskedAt = asked
}

let running = false

/**
 * Start reporting. Called once, from the entry, so it survives every remount of
 * the view — which matters, because "clicking New shell does not fix it" means
 * the thing that stopped is not the view and a tracer that restarted with the
 * view would have thrown away the evidence.
 */
export function watchThisPage(): void {
  if (running) return
  running = true
  if (typeof window === 'undefined') return

  note('the page loaded')

  let due = Date.now() + 1000
  let sinceBeacon = 0
  let posting = false

  setInterval(() => {
    const now = Date.now()
    const lag = now - due
    due = now + 1000
    if (lag > counts.worstTimerLag) counts.worstTimerLag = lag
    /* A timer that is late by a second or more is the main thread being held,
       which is a different freeze from a render that will not run. Recorded
       even though it has already recovered by the time this line runs — that is
       the only trace such a stall ever leaves. */
    if (lag > 1000) note(`the page's own timer was ${(lag / 1000).toFixed(1)}s late; something held the main thread`)

    askForAFrame()

    sinceBeacon += 1000
    if (sinceBeacon < BEACON || posting) return
    sinceBeacon = 0

    const said = standingNow()
    posting = true
    /*
     * `keepalive` so a beacon sent as the page is being torn down still goes.
     * Failures are swallowed: the server may be restarting, the module may have
     * been unframed, and a diagnostic that throws into somebody's console when
     * it cannot reach home is a diagnostic that looks like the bug.
     */
    void fetch('/api/trace/page', {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket: ticket(), standing: said }),
    })
      .then((answer) => {
        /* Only what was actually delivered is forgotten. A beacon that failed
           leaves its lines in the ring for the next one, which is the point of
           shipping them at all. */
        if (answer.ok) noted = noted.slice(said.noted.length)
      })
      .catch(() => {
        /* Nothing to say and nowhere to say it. */
      })
      .finally(() => {
        posting = false
      })
  }, 1000)

  document.addEventListener('visibilitychange', () => {
    note(`the document became ${document.visibilityState}`)
  })

  /*
   * The window-level events an app switch produces, noted as they happen.
   *
   * "It shows what I wrote whenever I swap to another app" is a sentence about
   * one of these, and which one matters: a `blur` with no `visibilitychange`
   * is a window that lost focus but stayed visible; a `pagehide` is the frame
   * being torn out. Event-driven, so they cost nothing while nothing happens.
   */
  window.addEventListener('focus', () => note('the window gained focus'))
  window.addEventListener('blur', () => note('the window lost focus'))
  window.addEventListener('pageshow', () => note('pageshow: the page was shown'))
  window.addEventListener('pagehide', () => note('pagehide: the page is going away'))

  /*
   * Whether the browser thinks this frame is on screen, kept current.
   *
   * Cross-origin, a frame cannot read its own position in the host; this is
   * the one channel that answers anyway, and it fires only when the answer
   * changes. The ratio goes on every beacon; a line goes in the ring when the
   * frame leaves the screen or comes back, so the moment can be lined up
   * against the frame waits around it.
   */
  if (typeof IntersectionObserver === 'function' && document.documentElement) {
    const seeing = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1]
        if (!last) return
        const ratio = last.isIntersecting ? last.intersectionRatio : 0
        const was = onScreen
        onScreen = ratio
        if (was === -1 || was <= 0 !== ratio <= 0) {
          note(
            ratio > 0
              ? `the browser says ${Math.round(ratio * 100)}% of this frame is on screen`
              : 'the browser says this frame is off screen',
          )
        }
      },
      { threshold: [0, 0.01, 0.5, 1] },
    )
    seeing.observe(document.documentElement)
  }
}
