import { describe, expect, test } from 'bun:test'

import { readStanding } from '../trace.ts'
import { note, seen, standingNow, watchThisPage } from '../src/view/trace.ts'

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
    expect(read?.visibility).toBe(said.visibility)
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
  test('is sent on a timer, carries the ticket, and is a standing the server accepts', async () => {
    const sent: { url: string; body: unknown }[] = []
    const was = globalThis.fetch
    globalThis.fetch = ((url: string, init?: { body?: string }) => {
      sent.push({ url, body: init?.body === undefined ? null : JSON.parse(init.body) })
      return Promise.resolve({ ok: true } as Response)
    }) as typeof fetch

    try {
      watchThisPage()
      /* Slower than any other test here, and deliberately not faked: the value
         of this one is that a real `setInterval` really fires, because the
         whole diagnostic rests on the page speaking when nothing has happened.
         A fake clock would prove the arithmetic and not the heartbeat. */
      await new Promise((done) => setTimeout(done, 2400))

      expect(sent.length).toBeGreaterThan(0)
      const one = sent[0]
      expect(one?.url).toBe('/api/trace/page')
      const held = one?.body as { ticket?: unknown; standing?: unknown }
      expect(typeof held.ticket).toBe('string')
      expect(readStanding(held.standing)).not.toBeNull()
    } finally {
      globalThis.fetch = was
    }
  }, 6000)
})
