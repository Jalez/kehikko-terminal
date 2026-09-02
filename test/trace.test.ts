import { describe, expect, test } from 'bun:test'

import { answer, TICKET } from '../doors.ts'
import {
  closed,
  connected,
  exited,
  fromPage,
  fromPty,
  readStanding,
  report,
  spawned,
  standing,
  toPty,
} from '../trace.ts'

/**
 * The trace, tested for the one property that matters.
 *
 * It is not "does it record things" — anything records things. It is: **does
 * the report distinguish the layer that stopped from the layers that did not.**
 * A tracer that logs every layer and reads the same whichever one froze is a
 * tracer that costs something and settles nothing, and that is the failure mode
 * worth a test rather than a hope.
 *
 * So most of what is below sets up one specific freeze and asserts that the
 * report names it. The counters and the bounds get their own tests because a
 * counter that can drift is worse than no counter at all: a `live` count that
 * only ever rises is indistinguishable from the leak this was built to find.
 *
 * The module keeps process-wide state on purpose — one ring, one set of
 * counters, for the life of the server — so these tests read the report rather
 * than asserting on absolute totals, which would make them depend on each
 * other's order.
 */

/** A connection whose socket is open and draining, unless said otherwise. */
function socket(state = 'open', buffered = 0) {
  return connected(
    () => state,
    () => buffered,
  )
}

describe('the report names the layer that stopped', () => {
  test('a shell that is producing nothing shows as an old pty, with everything above it fresh', () => {
    const held = socket()
    spawned(held, 4242, '/tmp/project', 120, 40)
    fromPty(held, 512, 0, true)

    const now = Date.now() + 30_000
    const said = report(now)

    expect(said).toContain('pid 4242')
    expect(said).toContain('/tmp/project')
    /* 30 seconds since the last byte, and it says so in seconds rather than
       leaving somebody to subtract two timestamps under pressure. */
    expect(said).toMatch(/pty -> page\s+512 B in 1 chunks, last 30\.0s ago/)
    closed(held, 'done')
  })

  test('a transport that is open and not draining is called out by name', () => {
    const held = socket('open', 8 * 1024 * 1024)
    spawned(held, 1, '/tmp', 80, 24)
    fromPty(held, 4096, 8 * 1024 * 1024, true)

    const said = report()
    expect(said).toContain('The socket is open here and not reading at the other end.')
    closed(held, 'done')
  })

  test('a page that is running and not drawing is separated from a page that is gone', () => {
    fromPage(
      base({
        frameWaiting: 22_000,
        sinceFrame: 22_000,
        visibility: 'visible',
      }),
    )
    const alive = report()
    expect(alive).toContain('outstanding for 22.0s')
    expect(alive).toContain('The window is not serving this frame')
    /* And it says what a visible frame on a ten-second schedule IS, and what to
       read next, because the last three people to read this line each spent an
       afternoon guessing. */
    expect(alive).toContain('outside the viewport')
    expect(alive).toContain('drawn without waiting')

    /* And the OTHER freeze, which is the page saying nothing at all. That one
       is not in the beacon; it is the age of the beacon, which is why the page
       has to speak on a timer rather than on events. */
    const later = report(Date.now() + 60_000)
    expect(later).toMatch(/page\s+last said something 60\.0s ago/)
  })

  test('a hidden page is not accused of anything, because a hidden page may stop', () => {
    fromPage(base({ frameWaiting: 22_000, sinceFrame: 22_000, visibility: 'hidden' }))
    const said = report()
    expect(said).toContain('a hidden page is allowed to stop')
  })

  test('more live than the page says it holds is called a leak in those words', () => {
    fromPage(base({ views: { mounted: 4, disposed: 2, live: 2 } }))
    expect(report()).toContain('more of something is live than the 1 session the page says it holds')
  })

  test('two live views with two sessions held is one shell per project, not a leak', () => {
    /* The page keeps a session per project the canvas has named, and each of
       them is a live view, emulator, socket and observer by design. A report
       that called that a leak would send somebody hunting for a remount that
       never happened. */
    fromPage(
      base({
        held: 2,
        views: { mounted: 2, disposed: 0, live: 2 },
        emulators: { made: 2, disposed: 0, live: 2 },
        sockets: { opened: 2, closed: 0, live: 2 },
        observers: { live: 2 },
      }),
    )
    const said = report()
    expect(said).toContain('holding 2 sessions on purpose')
    expect(said).not.toContain('A remount left the old one behind')
  })

  test('a page from before sessions existed reads as holding one', () => {
    /* Read through `readStanding`, the way a real beacon is, with the field
       absent: that is what an older page's JSON looks like, and it must land
       as the one session such a page did hold. */
    const { held: _dropped, ...older } = base()
    const read = readStanding(older)
    if (!read) throw new Error('an older standing did not read')
    fromPage(read)
    expect(report()).toContain('holding 1 session on purpose')
  })
})

describe('the counters cannot drift, which is the whole reason to have them', () => {
  test('a shell that exits and then has its socket closed is only counted out once', () => {
    const before = standing().shells.live
    const held = socket()
    spawned(held, 7, '/tmp', 80, 24)
    expect(standing().shells.live).toBe(before + 1)
    exited(held, 0)
    closed(held, 'the shell exited (0)')
    expect(standing().shells.live).toBe(before)
  })

  test('a socket closed twice is only closed once', () => {
    const before = standing().sockets
    const held = socket()
    closed(held, 'first')
    closed(held, 'second')
    const after = standing().sockets
    expect(after.closed).toBe(before.closed + 1)
    expect(after.live).toBe(before.live)
  })

  test('bytes in and out are counted apart, because they fail apart', () => {
    const held = socket()
    spawned(held, 9, '/tmp', 80, 24)
    toPty(held, 3)
    fromPty(held, 100, 0, true)
    /* A chunk the pty produced that could NOT be handed to the socket is output
       nobody will ever see, and it is the one number that used to leave no
       trace at all. */
    fromPty(held, 50, 0, false)
    const mine = standing().live.find((one) => one.n === held.n)
    expect(mine?.in.bytes).toBe(3)
    expect(mine?.out.bytes).toBe(150)
    expect(mine?.sent.bytes).toBe(100)
    expect(mine?.dropped).toBe(1)
    closed(held, 'done')
  })
})

describe('the tracer cannot become the leak it is looking for', () => {
  test('the event ring is bounded however much is written into it', () => {
    for (let n = 0; n < 2000; n += 1) fromPage(base({ noted: [{ at: Date.now(), what: `line ${n}` }] }))
    expect(standing().events.length).toBeLessThanOrEqual(400)
  })

  test('closed shells are dropped and live ones never are', () => {
    const live = socket()
    spawned(live, 1234, '/tmp/kept', 80, 24)
    for (let n = 0; n < 40; n += 1) closed(socket(), 'churn')
    const held = standing().live
    expect(held.length).toBeLessThanOrEqual(41)
    expect(held.some((one) => one.n === live.n)).toBe(true)
    closed(live, 'done')
  })
})

describe('what the page says is checked rather than believed', () => {
  test('anything that is not an object is refused', () => {
    expect(readStanding(null)).toBeNull()
    expect(readStanding('a string')).toBeNull()
    expect(readStanding(42)).toBeNull()
  })

  test('missing numbers become zero rather than NaN in somebody’s report', () => {
    const said = readStanding({})
    expect(said?.frames).toBe(0)
    expect(said?.visibility).toBe('unknown')
    expect(said?.frameWaiting).toBeNull()
    expect(Number.isNaN(said?.up)).toBe(false)
  })

  test('a page cannot put an unbounded string into this process', () => {
    const said = readStanding({ noted: [{ at: 1, what: 'x'.repeat(10_000) }] })
    expect(said?.noted[0]?.what.length).toBe(300)
  })

  test('a page cannot put an unbounded NUMBER of lines in either', () => {
    const many = Array.from({ length: 500 }, (_, n) => ({ at: n, what: 'x' }))
    expect(readStanding({ noted: many })?.noted.length).toBe(20)
  })
})

describe('the doors', () => {
  test('the trace answers GET as text, so one command is one command', () => {
    const said = answer('GET', '/api/trace')
    expect(said?.status).toBe(200)
    expect(said?.type).toBe('text')
    expect(String(said?.body)).toContain('read down until the freshness stops')
  })

  test('and as JSON for anything that would rather graph it', () => {
    const said = answer('GET', '/api/trace', { json: true })
    expect(said?.type).toBe('json')
    expect(said?.body).toHaveProperty('beat')
  })

  test('the trace is not written to', () => {
    expect(answer('POST', '/api/trace')?.status).toBe(405)
  })

  test('a beacon without this module’s ticket is refused', () => {
    expect(answer('POST', '/api/trace/page', { body: {}, ticket: 'nope' })?.status).toBe(403)
    expect(answer('POST', '/api/trace/page', { body: {} })?.status).toBe(403)
  })

  test('a beacon with the ticket is taken, and one that is not a standing is not', () => {
    expect(answer('POST', '/api/trace/page', { body: base({}), ticket: TICKET })?.status).toBe(200)
    expect(answer('POST', '/api/trace/page', { body: 'nonsense', ticket: TICKET })?.status).toBe(400)
  })

  test('everything else is still left to Vite rather than 404d', () => {
    expect(answer('GET', '/src/main.tsx')).toBeNull()
  })
})

/** A page standing with nothing wrong with it, overridden where a test cares. */
function base(over: Partial<ReturnType<typeof plain>> = {}) {
  return { ...plain(), ...over }
}

function plain() {
  return {
    up: 1000,
    frameWaiting: null as number | null,
    sinceFrame: 16,
    frames: 60,
    worstFrameWait: 20,
    visibility: 'visible',
    worstTimerLag: 4,
    views: { mounted: 1, disposed: 0, live: 1 },
    emulators: { made: 1, disposed: 0, live: 1 },
    sockets: { opened: 1, closed: 0, live: 1 },
    observers: { live: 1 },
    received: { chunks: 3, bytes: 400 },
    written: { chunks: 3 },
    renders: 3,
    lastRenderAgo: 20 as number | null,
    keystrokes: 5,
    waiting: 0,
    held: 1,
    driven: 0,
    onScreen: 1,
    focus: true,
    size: [1180, 620] as [number, number],
    noted: [] as { at: number; what: string }[],
  }
}
