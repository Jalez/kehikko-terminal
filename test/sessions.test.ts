import { describe, expect, test } from 'bun:test'

import {
  MOST_KEPT,
  NOTHING_HELD,
  forget,
  label,
  restart,
  show,
  wanted,
  type Held,
} from '../src/view/sessions.ts'

/**
 * Which shell is shown, decided without a browser.
 *
 * `sessions.ts` is pure on purpose, so that the report — "the same terminal
 * session no matter what project or epic" — can be answered as four facts
 * that each get a test: two projects are two sessions; switching does not
 * close anything; a session opens in its project's folder; and an epic is not
 * a key. `shells.test.tsx` proves the same things against the rendered
 * component, and the socket-and-pty half is the thing the README says to
 * verify by typing into two shells.
 */

const A = '/Users/someone/Projects/a'
const B = '/Users/someone/Projects/b'

describe('what the canvas says, reduced to what a shell is about', () => {
  test('nothing is decided while the page has not heard whether it is framed', () => {
    expect(wanted('listening', null)).toBeNull()
    expect(wanted('listening', { projectPath: A })).toBeNull()
  })

  test('unframed means the home directory, once', () => {
    expect(wanted('unhosted', null)).toEqual({ at: null })
  })

  test('framed with a project means that project', () => {
    expect(wanted('hosted', { projectPath: A })).toEqual({ at: A })
  })

  test('framed with no project open means home, and that is a decision rather than a wait', () => {
    expect(wanted('hosted', { projectPath: null })).toEqual({ at: null })
  })

  test('the epic is not read: the same project with any epic is the same answer', () => {
    /* The negative the essay promises. A context object carrying an epic is
       handed in and the answer does not mention it, because `wanted` takes
       only `projectPath` — the type itself refuses to look. */
    const withEpic = { projectPath: A, epic: 'ship-it' }
    const withAnother = { projectPath: A, epic: 'something-else' }
    expect(wanted('hosted', withEpic)).toEqual(wanted('hosted', withAnother))
  })
})

describe('two projects, two sessions', () => {
  test('the first project opens a session and shows it', () => {
    const { held, evicted } = show(NOTHING_HELD, A, 1)
    expect(held.sessions.map((s) => s.at)).toEqual([A])
    expect(held.shown).toEqual({ at: A })
    expect(evicted).toEqual([])
  })

  test('the second project opens a second session and the first is still there', () => {
    const one = show(NOTHING_HELD, A, 1).held
    const two = show(one, B, 2).held
    expect(two.sessions.map((s) => s.at)).toEqual([A, B])
    expect(two.shown).toEqual({ at: B })
  })

  test('coming back shows the session that was already there rather than a new one', () => {
    const one = show(NOTHING_HELD, A, 1).held
    const two = show(one, B, 2).held
    const back = show(two, A, 3).held
    expect(back.sessions).toHaveLength(2)
    expect(back.shown).toEqual({ at: A })
    /* Same generation: the same component, the same socket, the same shell. */
    expect(back.sessions.find((s) => s.at === A)?.generation).toBe(1)
  })

  test('switching never removes a session, which is what keeps a running command alive', () => {
    let held: Held = NOTHING_HELD
    for (let n = 0; n < 20; n += 1) held = show(held, n % 2 ? B : A, n).held
    expect(held.sessions).toHaveLength(2)
  })

  test('home is a session like any other, keyed by null', () => {
    const home = show(NOTHING_HELD, null, 1).held
    const then = show(home, A, 2).held
    expect(then.sessions.map((s) => s.at)).toEqual([null, A])
  })
})

describe('a session label', () => {
  test('names the folder and the generation, so a restarted shell is a new key', () => {
    expect(label({ at: A, generation: 1 })).toBe(`${A}#1`)
    expect(label({ at: null, generation: 2 })).toBe('home#2')
  })

  test('cannot collide between home and a project, because a project path is absolute', () => {
    expect(label({ at: '/home', generation: 1 })).not.toBe(label({ at: null, generation: 1 }))
  })
})

describe('New shell', () => {
  test('bumps the generation of that session only', () => {
    const two = show(show(NOTHING_HELD, A, 1).held, B, 2).held
    const again = restart(two, A)
    expect(again.sessions.find((s) => s.at === A)?.generation).toBe(2)
    expect(again.sessions.find((s) => s.at === B)?.generation).toBe(1)
    expect(again.shown).toEqual(two.shown)
  })
})

describe('forgetting a dead session', () => {
  test('drops one that is not on screen', () => {
    const two = show(show(NOTHING_HELD, A, 1).held, B, 2).held
    expect(forget(two, A).sessions.map((s) => s.at)).toEqual([B])
  })

  test('refuses to drop the one on screen, because that is not bookkeeping', () => {
    const two = show(show(NOTHING_HELD, A, 1).held, B, 2).held
    expect(forget(two, B)).toBe(two)
  })
})

describe('the bound, which is what stops this being a leak', () => {
  const project = (n: number) => `/Users/someone/Projects/p${n}`

  test('up to MOST_KEPT sessions are simply held', () => {
    let held: Held = NOTHING_HELD
    for (let n = 0; n < MOST_KEPT; n += 1) held = show(held, project(n), n).held
    expect(held.sessions).toHaveLength(MOST_KEPT)
  })

  test('one more evicts the least recently shown, never the one on screen', () => {
    let held: Held = NOTHING_HELD
    for (let n = 0; n < MOST_KEPT; n += 1) held = show(held, project(n), n).held
    /* Look at the oldest again so it is no longer the oldest. */
    held = show(held, project(0), 100).held
    const { held: after, evicted } = show(held, project(MOST_KEPT), 101)
    expect(after.sessions).toHaveLength(MOST_KEPT)
    expect(evicted.map((s) => s.at)).toEqual([project(1)])
    expect(after.sessions.some((s) => s.at === project(0))).toBe(true)
    expect(after.shown).toEqual({ at: project(MOST_KEPT) })
  })

  test('what was evicted is returned, so it can be said out loud', () => {
    let held: Held = NOTHING_HELD
    for (let n = 0; n <= MOST_KEPT; n += 1) {
      const step = show(held, project(n), n)
      held = step.held
      if (n < MOST_KEPT) expect(step.evicted).toEqual([])
      else expect(step.evicted).toHaveLength(1)
    }
  })
})
