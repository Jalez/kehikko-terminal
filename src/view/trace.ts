import { framesDriven, requestRealFrame } from './frames.ts'
import { ask, subscribe, ticket } from 'kehikot-module-protocol/client'

/**
 * The page's half of the trace, which exists because a frozen page cannot draw
 * its own diagnostics.
 *
 * ## The one thing this file has to get right
 *
 * A terminal that has stopped showing output looks identical from the outside
 * whether the page is dead, the page is alive but not painting, the socket is
 * open at one end only, or the shell is simply printing nothing. Everything
 * here is arranged to make those four distinguishable.
 *
 * It used to do that by SPEAKING PERIODICALLY, every two seconds, whether or
 * not anything had happened, because a page that reported only on events would
 * go quiet when it froze and go quiet when it was idle. Most of that is now
 * said without a clock: the page's presence is a held stream whose close the
 * server records, a frame that will not land is noted as an event by the page's
 * own (local) timer, and notes are posted when there are notes. The one case an
 * event cannot carry, a wedged main thread, which runs nothing, keeps a slow
 * standing, and only while it could matter. See "The one beacon that is still
 * on a clock" below.
 *
 * ## Why it is posted to the server rather than kept here
 *
 * Whatever the page knows about the moments before a freeze is only useful if
 * it has already LEFT the page by the time the freeze happens. A ring buffer
 * that you have to open a devtools console to read is a ring buffer nobody
 * reads, and in the desktop shell there may not be a console to open. So the
 * buffer is shipped, in small pieces, as soon as it has something in it, and
 * `curl` reads it off the server. See the essay in `trace.ts` at the repository root.
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
 * One `setInterval` at 1Hz and one animation frame per second, both local: no
 * request. The page's PRESENCE is one held stream (`/api/trace/page/events`):
 * open is the page being here, its close is the page leaving, being hidden or
 * losing its server, and the server writes both into its ring. What the page
 * noted is posted when it has noted something, never on a clock. On the hot
 * paths — a message off the socket, a keystroke — it is two integer increments
 * and no allocation. Nothing here formats a string unless something changed.
 *
 * ## The one beacon that is still on a clock, and why
 *
 * Layers 4 and 5 of the essay in `trace.ts` — the render loop stopped while
 * JavaScript runs, and the main thread wedged — have to be told apart from a
 * page that is merely idle. Layer 4 is now said as an event: the 1Hz timer
 * notes a frame that has been outstanding for {@link FRAME_OVERDUE} ms, and
 * that note is posted like any other. Layer 5 cannot be: a wedged main thread
 * runs nothing, and a held stream stays open from the browser's network side
 * while the page's JavaScript is stuck, so the stream cannot say it either.
 * Only the page speaking on a clock, and then going quiet, says it. So a
 * standing still goes every {@link STANDING} ms — but only while the page is
 * shown AND holds a live terminal socket, the only time a freeze is something
 * a person is waiting on. Hidden, or with no shell open, nothing goes out on a
 * clock at all.
 */

/**
 * How often a shown page holding a live terminal socket says its standing when
 * it has noted nothing: the one clock left, for a wedged main thread. See above.
 */
export const STANDING = 15_000

/** A frame outstanding this long is noted: the render loop has stopped while this page's JavaScript runs. */
export const FRAME_OVERDUE = 5000

/** After a post that did not land, how long before the next try, doubling to {@link RETRY_MOST}. */
const RETRY_FIRST = 2000
const RETRY_MOST = 30_000

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
  /* How many sessions the page is holding ON PURPOSE — one per project the
     canvas has named, see `sessions.ts`. The `live` counts above are read
     against this rather than against one: two live views with two sessions
     held is the design, two with one held is the leak. */
  held: 1,
}

let lastFrameAt: number | null = null
let frameAskedAt: number | null = null
/** Whether the frame outstanding now has already been noted as overdue: once per frame, not once a second. */
let overdueNoted = false
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
  /** How many sessions `Shells` is keeping, said whenever it changes. */
  holding(sessions: number): void {
    counts.held = Math.max(1, sessions)
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
    held: counts.held,
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
    overdueNoted = false
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

/**
 * Whether this tick says something: whenever there is something noted, and
 * otherwise only the one clock — shown, holding a live terminal socket, and
 * quiet for {@link STANDING}. Hidden, or with no shell open, never on a clock.
 */
export function dueToSpeak(now: { noted: number; visible: boolean; liveSockets: number; quietFor: number }): boolean {
  if (now.noted > 0) return true
  return now.visible && now.liveSockets > 0 && now.quietFor >= STANDING
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
  let lastPost = Date.now()
  let posting = false
  let retryAt = 0
  let retryWait = RETRY_FIRST

  /*
   * The page's presence: one held stream. Its close is the page leaving or
   * being hidden, which the server writes into its ring; from this side,
   * `probe` asks the health check when it drops, which is how the cover in
   * `app.tsx` learns the server has gone or is no longer the process that
   * served this page. The ticket rides the query: an `EventSource` sends no
   * header.
   */
  subscribe('/api/trace/page/events', () => {}, { query: { ticket: ticket() }, probe: true })

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
    /* Layer 4, said as an event: this timer runs, so JavaScript does, and the
       window has not served the frame asked for. Once per outstanding frame. */
    if (frameAskedAt !== null && !overdueNoted && now - frameAskedAt >= FRAME_OVERDUE) {
      overdueNoted = true
      note(
        `an animation frame has been outstanding for ${((now - frameAskedAt) / 1000).toFixed(1)}s while the page's timer runs; the page was ${document.visibilityState}`,
      )
    }

    if (posting || now < retryAt) return
    /* Something to say goes now. With nothing to say, only the one clock above:
       shown, holding a live terminal socket, and quiet for STANDING. */
    if (!dueToSpeak({ noted: noted.length, visible: document.visibilityState === 'visible', liveSockets: counts.sockets.live, quietFor: now - lastPost })) return

    const said = standingNow()
    posting = true
    lastPost = now
    /*
     * `keepalive` so a beacon sent as the page is being torn down still goes.
     * The protocol's `ask` carries the ticket in the header every module uses
     * and never throws: the server may be restarting, the module may have been
     * unframed, and a diagnostic that throws into somebody's console when it
     * cannot reach home is a diagnostic that looks like the bug.
     *
     * A post that did not land is tried again after a pause that doubles, so a
     * page whose server is gone does not knock every second with its notes.
     */
    void ask('/api/trace/page', { body: { standing: said }, keepalive: true })
      .then((answer) => {
        /* Only what was actually delivered is forgotten. A beacon that failed
           leaves its lines in the ring for the next one, which is the point of
           shipping them at all. */
        if (answer.ok) {
          noted = noted.slice(said.noted.length)
          retryAt = 0
          retryWait = RETRY_FIRST
        } else {
          retryAt = Date.now() + retryWait
          retryWait = Math.min(retryWait * 2, RETRY_MOST)
        }
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
