import { describe, expect, test } from 'bun:test'

import { readStanding } from '../trace.ts'
import { STANDING, dueToSpeak, note, seen, standingNow, watchThisPage } from '../src/view/trace.ts'

/**
 * The page's half, tested where it can be tested.
 *
 * There are exactly two things here that can break without anybody noticing
 * until the day somebody needs the report, and both of them get a test:
 *
 *   1. **The two files describing one wire format drifting apart.** The page
 *      builds a standing in `src/view/trace.ts`; the server reads it in
 *      `trace.ts`, by hand, field by field. Rename a field on one side and
 *      nothing fails — the reader substitutes a zero, and the report says "0
 *      frames landed" in the middle of a freeze, which is a lie told at the
 *      worst possible moment. So the round trip is asserted.
 *
 *   2. **A counter that only goes up.** Every `live` count here is a pair: one
 *      call on the way in, one on the way out. If a future edit adds the first
 *      and forgets the second, `live` climbs forever and the report accuses an
 *      innocent module of leaking — which is worse than saying nothing, because
 *      somebody will act on it.
 *
 * The rAF probe and the beacon timer are exercised against `happy-dom` rather
 * than a browser. What that can prove is that they run, request a frame, and
 * post; what it cannot prove is the thing they were built for, which is a
 * WKWebView that stops serving frames. `dev/frozen-while-backgrounded.js` is
 * the instrument for that, and it needs the desktop shell.
 */

describe('the page and the server agree about the wire', () => {
  test('a standing the page builds is one the server can read, field for field', () => {
    seen.viewMounted()
    seen.emulatorMade()
    seen.socketOpening()
    seen.observerMade()
    seen.message(120)
    seen.written()
    seen.rendered()
    seen.keystroke(3)

    const said = standingNow()
    const read = readStanding(said)
    expect(read).not.toBeNull()

    /* Every number that reached the reader is the number that left the page.
       A field renamed on one side shows up here as a zero. */
    expect(read?.views).toEqual(said.views)
    expect(read?.emulators).toEqual(said.emulators)
    expect(read?.sockets).toEqual(said.sockets)
    expect(read?.observers).toEqual(said.observers)
    expect(read?.received).toEqual(said.received)
    expect(read?.written).toEqual(said.written)
    expect(read?.renders).toBe(said.renders)
    expect(read?.keystrokes).toBe(said.keystrokes)
    expect(read?.waiting).toBe(said.waiting)
    /* One per project, and the number the live counts are judged against. A
       field lost on the wire would read as 1, and a page honestly holding two
       sessions would be reported as leaking one. */
    seen.holding(3)
    expect(readStanding(standingNow())?.held).toBe(3)
    seen.holding(1)
    expect(read?.visibility).toBe(said.visibility)
    /* The fields added for the frame that is owed. A missing one reads back as
       "never" or "not measured", which in a report would say the fallback had
       not run — on the day it was doing all the drawing. */
    expect(read?.driven).toBe(said.driven)
    expect(read?.onScreen).toBe(said.onScreen)
    expect(read?.focus).toBe(said.focus)
    expect(read?.size).toEqual(said.size)
  })

  test('and it survives JSON, which is what actually goes over the wire', () => {
    const said = standingNow()
    const read = readStanding(JSON.parse(JSON.stringify(said)))
    expect(read?.frames).toBe(said.frames)
    expect(read?.views.live).toBe(said.views.live)
  })
})

describe('the live counts come back down', () => {
  test('what is mounted and disposed leaves nothing behind', () => {
    const before = standingNow()
    seen.viewMounted()
    seen.emulatorMade()
    seen.observerMade()
    seen.socketOpening()
    expect(standingNow().views.live).toBe(before.views.live + 1)

    seen.socketClosed('done')
    seen.observerGone()
    seen.emulatorDisposed()
    seen.viewDisposed()

    const after = standingNow()
    expect(after.views.live).toBe(before.views.live)
    expect(after.emulators.live).toBe(before.emulators.live)
    expect(after.sockets.live).toBe(before.sockets.live)
    expect(after.observers.live).toBe(before.observers.live)
  })

  test('a count is never taken below zero, because a negative live count is a lie', () => {
    for (let n = 0; n < 5; n += 1) seen.viewDisposed()
    expect(standingNow().views.live).toBeGreaterThanOrEqual(0)
  })
})

describe('the page’s own ring is bounded', () => {
  test('a page that notes forever does not hold forever', () => {
    for (let n = 0; n < 500; n += 1) note(`line ${n}`)
    /* And only a bounded slice of it is ever carried on one beacon, so a page
       that has been offline for an hour does not post a megabyte on reconnect. */
    expect(standingNow().noted.length).toBeLessThanOrEqual(20)
  })
})

describe('the beacon', () => {
  test('presence is one held stream; notes go when there are notes and carry the ticket; nothing goes on a clock while no shell is open', async () => {
    const sent: { url: string; body: unknown; headers: Record<string, string>; keepalive: boolean }[] = []
    const was = globalThis.fetch
    const wasSource = (globalThis as { EventSource?: unknown }).EventSource
    const opened: string[] = []
    /* The page's EventSource, kept: the stream is opened once, with the ticket in its query. */
    ;(globalThis as { EventSource?: unknown }).EventSource = class {
      readyState = 1
      onmessage: unknown = null
      onerror: unknown = null
      onopen: unknown = null
      constructor(url: string) {
        opened.push(url)
      }
      addEventListener() {}
      close() {}
    }
    /* The ticket this process printed into the page, where the protocol's `ask` reads it. */
    const island = document.createElement('script')
    island.id = 'ticket'
    island.type = 'application/json'
    island.textContent = JSON.stringify('a-ticket')
    document.body.appendChild(island)
    globalThis.fetch = ((url: string, init?: { body?: string; headers?: Record<string, string>; keepalive?: boolean }) => {
      sent.push({
        url,
        body: init?.body === undefined ? null : JSON.parse(init.body),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        keepalive: init?.keepalive === true,
      })
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }))
    }) as typeof fetch

    try {
      watchThisPage()
      expect(opened).toHaveLength(1)
      expect(opened[0]).toStartWith('/api/trace/page/events?')
      expect(new URL(opened[0]!, 'http://x').searchParams.get('ticket')).toBe('a-ticket')

      /* Real timers, deliberately: the value is that a real `setInterval` really
         decides. What the cases above noted goes first, twenty lines a tick,
         until the page has said everything; "the page loaded" is among it. */
      const posts = () => sent.filter((one) => one.url === '/api/trace/page')
      const carried = (i: number) => (posts()[i]?.body as { standing: { noted: { what: string }[] } }).standing.noted
      for (let waited = 0; waited < 9000; waited += 200) {
        if (posts().length && carried(posts().length - 1).length < 20) break
        await new Promise((done) => setTimeout(done, 200))
      }
      expect(posts().length).toBeGreaterThan(0)
      const one = posts()[0]
      const held = one?.body as { ticket?: unknown; standing?: unknown }
      /* In the header every module uses, not in the body. */
      expect(one?.headers['x-module-ticket']).toBe('a-ticket')
      expect(held.ticket).toBeUndefined()
      /* So one sent as the page is torn down still goes. */
      expect(one?.keepalive).toBe(true)
      expect(readStanding(held.standing)).not.toBeNull()
      expect(posts().some((_, i) => carried(i).some((line) => line.what === 'the page loaded'))).toBe(true)

      /* Nothing more noted, no shell open: nothing goes out, however long it is left. */
      const said = posts().length
      await new Promise((done) => setTimeout(done, 2400))
      expect(posts()).toHaveLength(said)

      /* Something happened: it goes at the next tick, and only it. */
      note('something changed')
      await new Promise((done) => setTimeout(done, 1200))
      expect(posts()).toHaveLength(said + 1)
      expect(carried(said).map((line) => line.what)).toEqual(['something changed'])
    } finally {
      island.remove()
      globalThis.fetch = was
      ;(globalThis as { EventSource?: unknown }).EventSource = wasSource
    }
  }, 16000)
})

describe('when the page speaks', () => {
  test('notes go at once; with none, only a shown page holding a live shell speaks, every STANDING', () => {
    const quiet = { noted: 0, visible: true, liveSockets: 1, quietFor: 0 }
    expect(dueToSpeak({ ...quiet, noted: 3 })).toBe(true)
    expect(dueToSpeak({ ...quiet, noted: 3, visible: false, liveSockets: 0 })).toBe(true)
    expect(dueToSpeak(quiet)).toBe(false)
    expect(dueToSpeak({ ...quiet, quietFor: STANDING })).toBe(true)
    /* Hidden, or no shell open: never on a clock, however long it has been quiet. */
    expect(dueToSpeak({ ...quiet, quietFor: 3_600_000, visible: false })).toBe(false)
    expect(dueToSpeak({ ...quiet, quietFor: 3_600_000, liveSockets: 0 })).toBe(false)
  })
})
