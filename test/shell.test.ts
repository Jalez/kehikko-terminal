import { describe, expect, test } from 'bun:test'
import { command, fenced, openable, opening, sayable } from '../shell.ts'

/**
 * The fence, tested without a socket.
 *
 * Everything here is a pure function on purpose: `shell.ts` keeps the DECIDING
 * apart from the plumbing precisely so that the decisions can be tested without
 * a server, a browser, or a pty. What is left in the plumbing is `on`, `send`
 * and `close`, which is the part that is hard to test and decides nothing.
 */

const PORT = 7920
const OK = { origin: `http://127.0.0.1:${PORT}`, host: `127.0.0.1:${PORT}` }

describe('who may open a terminal', () => {
  test('this module’s own page, on either spelling of loopback', () => {
    expect(fenced(OK, PORT).ok).toBe(true)
    expect(fenced({ origin: `http://localhost:${PORT}`, host: `localhost:${PORT}` }, PORT).ok).toBe(true)
  })

  test('another origin is refused, and told which check it was', () => {
    const said = fenced({ origin: 'https://evil.example', host: `127.0.0.1:${PORT}` }, PORT)
    expect(said.ok).toBe(false)
    expect(said.why).toContain('evil.example')
  })

  test('a missing Origin is refused, because a browser always sends one', () => {
    expect(fenced({ host: `127.0.0.1:${PORT}` }, PORT).ok).toBe(false)
  })

  test('a rebound Host is refused even with a perfect Origin', () => {
    /* DNS rebinding: a name that resolves to 127.0.0.1 would otherwise carry a
       page's own origin straight through the check above. */
    const said = fenced({ origin: `http://127.0.0.1:${PORT}`, host: 'evil.example' }, PORT)
    expect(said.ok).toBe(false)
    expect(said.why).toContain('evil.example')
  })

  test('another port on this same machine is still another origin', () => {
    expect(fenced({ origin: 'http://127.0.0.1:7860', host: `127.0.0.1:${PORT}` }, PORT).ok).toBe(false)
  })
})

describe('the opening frame', () => {
  const TICKET = 'a-ticket'
  const good = { ticket: TICKET, cwd: '/tmp', resume: null, cols: 80, rows: 24 }

  test('a good frame is read', () => {
    const said = opening(JSON.stringify(good), TICKET)
    expect(typeof said).not.toBe('string')
    expect((said as { cwd: string }).cwd).toBe('/tmp')
  })

  test('a wrong ticket is refused', () => {
    expect(typeof opening(JSON.stringify({ ...good, ticket: 'nope' }), TICKET)).toBe('string')
  })

  test('a missing ticket is refused, and so is a prefix of one', () => {
    expect(typeof opening(JSON.stringify({ cwd: '/tmp' }), TICKET)).toBe('string')
    expect(typeof opening(JSON.stringify({ ...good, ticket: 'a-tick' }), TICKET)).toBe('string')
  })

  test('anything that is not a JSON object is refused', () => {
    expect(typeof opening('not json', TICKET)).toBe('string')
    expect(typeof opening('[]', TICKET)).toBe('string')
    expect(typeof opening('"a string"', TICKET)).toBe('string')
    expect(typeof opening(42, TICKET)).toBe('string')
  })

  test('a size is clamped rather than trusted', () => {
    /* A pty told it is one column wide wraps every character onto its own line;
       told it is a million, programs allocate for it. */
    const huge = opening(JSON.stringify({ ...good, cols: 999999, rows: -4 }), TICKET)
    expect(huge).toMatchObject({ cols: 500, rows: 5 })
    const missing = opening(JSON.stringify({ ticket: TICKET }), TICKET)
    expect(missing).toMatchObject({ cols: 80, rows: 24 })
  })
})

describe('the close reason, which used to crash the server', () => {
  test('a short reason is left alone', () => {
    expect(sayable('nothing was said')).toBe('nothing was said')
  })

  test('a long reason is clipped to the 123 bytes the protocol allows', () => {
    /* `ws` THROWS on a longer one, inside a message handler, where nothing
       catches it — so the whole process died. A wrong ticket was a crash. */
    const long = 'x'.repeat(400)
    expect(Buffer.from(sayable(long), 'utf8').length).toBeLessThanOrEqual(123)
  })

  test('it clips by bytes, not characters, and stays valid UTF-8', () => {
    /* The real refusal sentences contain — and ’, three bytes each. A character
       count would pass its own check and still throw. */
    const wide = '—'.repeat(200)
    const cut = sayable(wide)
    expect(Buffer.from(cut, 'utf8').length).toBeLessThanOrEqual(123)
    expect(cut).not.toContain('�')
    expect([...cut].every((ch) => ch === '—')).toBe(true)
  })

  test('the real refusal sentence is now sendable', () => {
    const real =
      'That did not carry this module’s ticket. The ticket is printed into the page this module serves, and only that page has it.'
    expect(Buffer.from(real, 'utf8').length).toBeGreaterThan(123)
    expect(Buffer.from(sayable(real), 'utf8').length).toBeLessThanOrEqual(123)
  })
})

describe('what gets run', () => {
  test('a login shell, interactive', () => {
    expect(command('/bin/zsh')).toEqual({ file: '/bin/zsh', args: ['-i'] })
  })

})

describe('where a shell opens', () => {
  /*
   * The page asks for the open project's folder, so a terminal beside a project
   * does not begin with the same `cd` every time. What arrives here is still a
   * string off a socket, and spawning into a directory that is not there fails
   * from inside the fork: the socket closes with a message about a file, the
   * container says the shell would not start, and nothing names the path as the
   * thing that was wrong.
   */
  test('the project folder is used when it is a real directory', () => {
    expect(openable(process.cwd(), '/tmp')).toBe(process.cwd())
  })

  test('nothing asked for means the fallback', () => {
    expect(openable(null, '/tmp')).toBe('/tmp')
  })

  /* The old behaviour, reached rather than crashed into: every shell opened at
     home before any of this existed, so the fallback is not a new failure. */
  test('a directory that is not there falls back rather than throwing', () => {
    expect(openable('/no/such/place/at/all', '/tmp')).toBe('/tmp')
  })

  test('a file is not a directory', () => {
    expect(openable(`${process.cwd()}/package.json`, '/tmp')).toBe('/tmp')
  })

  test('an empty string is treated as nothing asked for', () => {
    expect(openable('', '/tmp')).toBe('/tmp')
  })
})
